// New Azure Function: dashboard-api/index.js
// This handles all the dashboard API endpoints

const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Dashboard API request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    try {
        const method = req.method;
        const segments = req.url.split('/').filter(Boolean);
        
        // Route: /api/organization/{orgId}/overview
        if (method === 'GET' && segments.includes('organization') && segments.includes('overview')) {
            const orgId = getOrgIdFromUrl(segments);
            await handleGetOrganizationOverview(context, orgId);
        }
        // Route: /api/organization/{orgId}/users/{userId} - PUT
        else if (method === 'PUT' && segments.includes('organization') && segments.includes('users')) {
            const orgId = getOrgIdFromUrl(segments);
            const userId = getUserIdFromUrl(segments);
            await handleUpdateUser(context, orgId, userId, req.body);
        }
        // Route: /api/organization/{orgId}/users/{userId} - DELETE
        else if (method === 'DELETE' && segments.includes('organization') && segments.includes('users')) {
            const orgId = getOrgIdFromUrl(segments);
            const userId = getUserIdFromUrl(segments);
            await handleDeleteUser(context, orgId, userId);
        }
        // Route: /api/organization/{orgId}/invite - POST
        else if (method === 'POST' && segments.includes('organization') && segments.includes('invite')) {
            const orgId = getOrgIdFromUrl(segments);
            await handleInviteUser(context, orgId, req.body);
        }
        // Route: /api/organizations - GET (list organizations)
        else if (method === 'GET' && segments.length === 2 && segments[1] === 'organizations') {
            await handleListOrganizations(context);
        }
        else {
            context.res.status = 404;
            context.res.body = { error: 'Endpoint not found' };
        }

    } catch (error) {
        context.log.error('Dashboard API error:', error);
        context.res.status = 500;
        context.res.body = { error: error.message || 'Internal server error' };
    }
};

// Helper functions to extract IDs from URL
function getOrgIdFromUrl(segments) {
    const orgIndex = segments.indexOf('organization');
    return orgIndex !== -1 && segments[orgIndex + 1] ? segments[orgIndex + 1] : null;
}

function getUserIdFromUrl(segments) {
    const usersIndex = segments.indexOf('users');
    return usersIndex !== -1 && segments[usersIndex + 1] ? segments[usersIndex + 1] : null;
}

// Get organization overview with users and usage
async function handleGetOrganizationOverview(context, orgId) {
    try {
        if (!orgId) {
            context.res.status = 400;
            context.res.body = { error: 'Organization ID required' };
            return;
        }

        // Get organization details
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: orgId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
        }
        
        const organization = organizations[0];
        
        // Get all users for this organization
        const usersQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt DESC",
            parameters: [{ name: "@orgId", value: orgId }]
        };
        
        const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();
        
        // Calculate usage stats
        const activeUsers = users.filter(u => u.status === 'active').length;
        const usage = {
            total: organization.licenseCount,
            used: activeUsers,
            available: organization.licenseCount - activeUsers,
            percentage: Math.round((activeUsers / organization.licenseCount) * 100)
        };
        
        context.res.status = 200;
        context.res.body = {
            organization,
            users,
            usage
        };
        
        context.log('Organization overview retrieved for:', orgId);
    } catch (error) {
        context.log.error('Error getting organization overview:', error);
        throw error;
    }
}

// Update user (status, role, etc.)
async function handleUpdateUser(context, orgId, userId, updateData) {
    try {
        if (!orgId || !userId) {
            context.res.status = 400;
            context.res.body = { error: 'Organization ID and User ID required' };
            return;
        }

        context.log('Updating user:', userId, 'in org:', orgId, 'with data:', updateData);

        // Get user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
            parameters: [
                { name: "@userId", value: userId },
                { name: "@orgId", value: orgId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.log('User not found. Searching all users for debugging...');
            
            // Debug: Search for any user with this ID
            const debugQuery = {
                query: "SELECT c.id, c.email, c.organizationId FROM c WHERE c.id = @userId",
                parameters: [{ name: "@userId", value: userId }]
            };
            const { resources: debugUsers } = await usersContainer.items.query(debugQuery).fetchAll();
            
            context.log('Debug search results:', debugUsers);
            
            context.res.status = 404;
            context.res.body = { 
                error: 'User not found',
                debug: {
                    searchedUserId: userId,
                    searchedOrgId: orgId,
                    foundUsers: debugUsers
                }
            };
            return;
        }
        
        const user = users[0];
        context.log('Found user:', { id: user.id, email: user.email, currentStatus: user.status });
        const { role, status } = updateData;
        
        // If deactivating, check admin constraints
        if (status === 'deactivated' && user.role === 'admin') {
            const adminQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: orgId }]
            };
            
            const { resources: adminCount } = await usersContainer.items.query(adminQuery).fetchAll();
            
            if (adminCount[0] <= 1) {
                context.res.status = 400;
                context.res.body = { error: 'Cannot deactivate the only admin user' };
                return;
            }
        }
        
        // If reactivating, check license availability
        if (status === 'active' && user.status !== 'active') {
            const usage = await getOrganizationUsage(orgId);
            if (usage.available <= 0) {
                context.res.status = 400;
                context.res.body = { error: 'No available licenses. Please upgrade your plan.' };
                return;
            }
        }
        
        // Update user
        const updatedUser = {
            ...user,
            role: role || user.role,
            status: status || user.status,
            lastUpdated: new Date().toISOString()
        };
        
        if (status === 'deactivated') {
            updatedUser.deactivatedAt = new Date().toISOString();
        } else if (status === 'active' && user.status !== 'active') {
            updatedUser.reactivatedAt = new Date().toISOString();
            delete updatedUser.deactivatedAt;
        }
        
        context.log('Attempting to replace user document with:', { 
            id: updatedUser.id, 
            status: updatedUser.status,
            partitionKey: updatedUser.id
        });
        
        // Use the correct partition key (the user's ID)
        await usersContainer.item(user.id, user.id).replace(updatedUser);
        
        context.res.status = 200;
        context.res.body = {
            message: 'User updated successfully',
            user: updatedUser
        };
        
        context.log('User updated successfully:', userId, 'new status:', status);
    } catch (error) {
        context.log.error('Error updating user:', error);
        context.log.error('Error details:', {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode
        });
        throw error;
    }
}

// Delete user permanently
async function handleDeleteUser(context, orgId, userId) {
    try {
        if (!orgId || !userId) {
            context.res.status = 400;
            context.res.body = { error: 'Organization ID and User ID required' };
            return;
        }

        // Get user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
            parameters: [
                { name: "@userId", value: userId },
                { name: "@orgId", value: orgId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res.status = 404;
            context.res.body = { error: 'User not found' };
            return;
        }
        
        const user = users[0];
        
        // Check admin constraints
        if (user.role === 'admin') {
            const adminQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: orgId }]
            };
            
            const { resources: adminCount } = await usersContainer.items.query(adminQuery).fetchAll();
            
            if (adminCount[0] <= 1) {
                context.res.status = 400;
                context.res.body = { error: 'Cannot remove the only admin user' };
                return;
            }
        }
        
        // Delete user
        await usersContainer.item(user.id, user.id).delete();
        
        context.res.status = 200;
        context.res.body = { message: 'User removed successfully' };
        
        context.log('User deleted:', userId);
    } catch (error) {
        context.log.error('Error deleting user:', error);
        throw error;
    }
}

// Invite new user (simplified version)
async function handleInviteUser(context, orgId, inviteData) {
    try {
        if (!orgId) {
            context.res.status = 400;
            context.res.body = { error: 'Organization ID required' };
            return;
        }

        const { email, role = 'user' } = inviteData;
        
        if (!email) {
            context.res.status = 400;
            context.res.body = { error: 'Email required' };
            return;
        }

        // Check license availability
        const usage = await getOrganizationUsage(orgId);
        if (usage.available <= 0) {
            context.res.status = 400;
            context.res.body = { error: 'No available licenses. Please upgrade your plan.' };
            return;
        }
        
        // Check if user already exists
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };
        
        const { resources: existingUsers } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (existingUsers.length > 0) {
            context.res.status = 400;
            context.res.body = { error: 'User already exists with this email' };
            return;
        }
        
        // For demo purposes, we'll create the user directly
        // In production, you'd create an invitation and send an email
        const userId = uuidv4();
        const firstName = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
        
        const newUser = {
            id: userId,
            email: email,
            firstName: firstName,
            lastName: 'User',
            phone: null,
            organizationId: orgId,
            role: role,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            invitedUser: true
        };
        
        await usersContainer.items.create(newUser);
        
        context.res.status = 200;
        context.res.body = {
            message: 'User created successfully (demo mode)',
            user: {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: 'User',
                role: role
            }
        };
        
        context.log('User invited/created:', email);
    } catch (error) {
        context.log.error('Error inviting user:', error);
        throw error;
    }
}

// List organizations (for finding test orgs)
async function handleListOrganizations(context) {
    try {
        const orgQuery = {
            query: "SELECT c.id, c.name, c.adminEmail, c.licenseCount, c.status, c.createdAt FROM c ORDER BY c.createdAt DESC"
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        context.res.status = 200;
        context.res.body = { organizations };
        
        context.log('Organizations listed:', organizations.length);
    } catch (error) {
        context.log.error('Error listing organizations:', error);
        throw error;
    }
}

// Helper function to get organization usage
async function getOrganizationUsage(organizationId) {
    const orgQuery = {
        query: "SELECT * FROM c WHERE c.id = @orgId",
        parameters: [{ name: "@orgId", value: organizationId }]
    };
    
    const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
    
    if (organizations.length === 0) {
        throw new Error('Organization not found');
    }
    
    const organization = organizations[0];
    
    const userCountQuery = {
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
        parameters: [{ name: "@orgId", value: organizationId }]
    };
    
    const { resources: userCountResult } = await usersContainer.items.query(userCountQuery).fetchAll();
    const activeUsers = userCountResult[0] || 0;
    
    return {
        total: organization.licenseCount,
        used: activeUsers,
        available: organization.licenseCount - activeUsers,
        percentage: Math.round((activeUsers / organization.licenseCount) * 100)
    };
}