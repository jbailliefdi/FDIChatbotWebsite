// New Azure Function: dashboard-api/index.js
// This handles all the dashboard API endpoints

const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');
const { validateAdminAccess } = require('../utils/auth');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    'https://kind-mud-048fffa03.6.azurestaticapps.net',
    'https://localhost:3000',
    'http://localhost:3000',
    'http://localhost:4280',
    'https://localhost:4280'
];

module.exports = async function (context, req) {
    context.log('Dashboard API request received:', req.method, req.url);

    // Get origin from request
    const origin = req.headers.origin;
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // Enable CORS with proper origin validation
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
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
        
        // Temporary: Skip auth validation while debugging dashboard
        // TODO: Re-enable proper JWT validation once dashboard auth is working
        const adminUser = {
            id: 'temp-admin',
            organizationId: orgId,
            email: 'j.baillie@fdintelligence.co.uk'
        };
        
        // Route: /api/organization/{orgId}/overview
        if (method === 'GET' && segments.includes('overview')) {
            await handleGetOrganizationOverview(context, orgId, adminUser);
        }
        // Route: /api/organization/{orgId}/users/{userId} - PUT
        else if (method === 'PUT' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            await handleUpdateUser(context, orgId, userId, req.body, adminUser);
        }
        // Route: /api/organization/{orgId}/users/{userId} - DELETE
        else if (method === 'DELETE' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            await handleDeleteUser(context, orgId, userId, adminUser);
        }
        // Route: /api/organization/{orgId}/invite - POST
        else if (method === 'POST' && segments.includes('invite')) {
            context.log('Invite route matched, calling handleInviteUser');
            try {
                await handleInviteUser(context, orgId, req.body, adminUser);
            } catch (inviteError) {
                context.log.error('Error in handleInviteUser:', inviteError);
                context.res.status = 500;
                context.res.body = { error: 'Invite failed: ' + inviteError.message };
            }
        }
        else {
            context.res.status = 404;
            context.res.body = { error: 'Endpoint not found' };
        }

    } catch (error) {
        context.log.error('Dashboard API error:', error);
        context.log.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        if (error.message.includes('Access denied') || error.message.includes('Invalid token')) {
            context.res.status = 403;
            context.res.body = { error: 'Access denied' };
        } else {
            context.res.status = 500;
            context.res.body = { 
                error: 'Internal server error', 
                details: error.message,
                method: req.method,
                orgId: req.params.orgId,
                segments: req.params.segments
            };
        }
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
async function handleGetOrganizationOverview(context, orgId, adminUser) {
    try {
        if (!orgId) {
            context.res.status = 400;
            context.res.body = { error: 'Organization ID required' };
            return;
        }

        // Get organization details (already validated by auth)
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
            query: "SELECT c.id, c.email, c.firstName, c.lastName, c.role, c.status, c.createdAt, c.lastLogin FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt DESC",
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
        
        // Remove sensitive fields from organization response
        const sanitizedOrg = {
            id: organization.id,
            name: organization.name,
            licenseCount: organization.licenseCount,
            status: organization.status,
            createdAt: organization.createdAt
        };
        
        context.res.status = 200;
        context.res.body = {
            organization: sanitizedOrg,
            users,
            usage
        };
        
    } catch (error) {
        context.log.error('Error getting organization overview:', error.message);
        throw error;
    }
}

// Update user (status, role, etc.)
async function handleUpdateUser(context, orgId, userId, updateData, adminUser) {
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
        
        
        // Use organizationId as partition key for the replace operation
        await usersContainer.item(user.id, partitionKeyValue).replace(updatedUser);
        
        context.res.status = 200;
        context.res.body = {
            message: 'User updated successfully',
            user: updatedUser
        };
        
    } catch (error) {
        context.log.error('Error updating user:', error.message);
        throw error;
    }
}

// Delete user permanently
async function handleDeleteUser(context, orgId, userId, adminUser) {
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
        
    } catch (error) {
        context.log.error('Error deleting user:', error.message);
        throw error;
    }
}

// Invite new user - simplified for debugging
async function handleInviteUser(context, orgId, inviteData, adminUser) {
    try {
        context.log('handleInviteUser called with:', { orgId, inviteData, adminUser });
        
        // Simple validation
        const { firstName, lastName, email, role = 'user' } = inviteData;
        
        if (!email || !firstName || !lastName) {
            context.res.status = 400;
            context.res.body = { error: 'First name, last name, and email are required' };
            return;
        }

        context.log('Basic validation passed, creating success response');
        
        // Skip all database operations for now and just return success
        const userId = uuidv4();
        
        context.res.status = 200;
        context.res.body = {
            message: 'User invitation sent successfully (demo mode)',
            user: {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: lastName,
                role: role
            }
        };
        
        context.log('Success response created');
        
    } catch (error) {
        context.log.error('Error in handleInviteUser:', error);
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