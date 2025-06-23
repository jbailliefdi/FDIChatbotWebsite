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
    context.log('Dashboard API request received:', req.method, req.url);

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
        const orgId = req.params.orgId;
        const segments = req.params.segments ? req.params.segments.split('/') : [];
        
        context.log('Organization ID:', orgId);
        context.log('Segments:', segments);
        
        // Route: /api/organization/{orgId}/overview
        if (method === 'GET' && segments.includes('overview')) {
            context.log('Getting overview for org:', orgId);
            await handleGetOrganizationOverview(context, orgId);
        }
        // Route: /api/organization/{orgId}/users/{userId} - PUT
        else if (method === 'PUT' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            context.log('Updating user:', userId, 'in org:', orgId);
            await handleUpdateUser(context, orgId, userId, req.body);
        }
        // Route: /api/organization/{orgId}/users/{userId} - DELETE
        else if (method === 'DELETE' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            context.log('Deleting user:', userId, 'in org:', orgId);
            await handleDeleteUser(context, orgId, userId);
        }
        // Route: /api/organization/{orgId}/invite - POST
        else if (method === 'POST' && segments.includes('invite')) {
            context.log('Inviting user to org:', orgId);
            await handleInviteUser(context, orgId, req.body);
        }
        else {
            context.log('No matching route found for:', method, 'orgId:', orgId, 'segments:', segments);
            context.res.status = 404;
            context.res.body = { 
                error: 'Endpoint not found',
                debug: {
                    method: method,
                    orgId: orgId,
                    segments: segments
                }
            };
        }

    } catch (error) {
        context.log.error('Dashboard API error:', error);
        context.res.status = 500;
        context.res.body = { error: error.message || 'Internal server error' };
    }
};

// Helper functions to extract IDs from segments (simplified now)
function getOrgIdFromUrl(segments) {
    // No longer needed with new routing
    return null;
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
        context.log('Found user:', { 
            id: user.id, 
            email: user.email, 
            currentStatus: user.status,
            organizationId: user.organizationId
        });
        
        // Your container uses /organizationId as partition key
        const partitionKeyValue = user.organizationId;
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
            partitionKey: updatedUser.id,
            allFields: Object.keys(updatedUser)
        });
        
        // Log the original user for comparison
        context.log('Original user document:', {
            id: user.id,
            _rid: user._rid,
            _etag: user._etag,
            allFields: Object.keys(user)
        });
        
        // Try to read the document first to make sure it exists
        try {
            const readResult = await usersContainer.item(user.id, partitionKeyValue).read();
            context.log('Document read successfully before update:', {
                id: readResult.resource.id,
                status: readResult.resource.status
            });
        } catch (readError) {
            context.log.error('Error reading document before update:', readError);
            throw new Error(`Cannot read user document: ${readError.message}`);
        }
        
        // Use organizationId as partition key for the replace operation
        const replaceResult = await usersContainer.item(user.id, partitionKeyValue).replace(updatedUser);
        context.log('Replace operation successful:', {
            statusCode: replaceResult.statusCode,
            activityId: replaceResult.activityId
        });
        
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
        
        // Delete user using organizationId as partition key
        await usersContainer.item(user.id, user.organizationId).delete();
        
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