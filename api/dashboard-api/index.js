// New Azure Function: dashboard-api/index.js
// This handles all the dashboard API endpoints

const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');
const { validateAdminAccess } = require('../utils/auth');

// Initialize Cosmos DB client (with error handling)
let cosmosClient, database, organizationsContainer, usersContainer;

try {
    if (process.env.COSMOS_DB_CONNECTION_STRING) {
        cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
        database = cosmosClient.database('fdi-chatbot');
        organizationsContainer = database.container('organizations');
        usersContainer = database.container('users');
    } else {
        console.warn('COSMOS_DB_CONNECTION_STRING not found. Database operations will be disabled.');
    }
} catch (error) {
    console.error('Failed to initialize Cosmos DB client:', error.message);
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    'https://kind-mud-048fffa03.6.azurestaticapps.net',
    'https://localhost:3000',
    'http://localhost:3000',
    'http://localhost:4280',
    'https://localhost:4280'
];

module.exports = async function (context, req) {
    try {
        context.log('=== DASHBOARD API START ===');
        context.log('Method:', req.method);
        context.log('URL:', req.url);
        context.log('Params:', req.params);
        context.log('Body:', req.body);

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
            await handleInviteUser(context, orgId, req.body, adminUser);
        }
        else {
            context.log('=== NO ROUTE MATCHED ===');
            context.log('Method:', method);
            context.log('OrgId:', orgId);
            context.log('Segments:', segments);
            
            context.res.status = 404;
            context.res.body = { error: 'Endpoint not found' };
        }

    } catch (error) {
        context.log.error('=== DASHBOARD API ERROR ===');
        context.log.error('Error message:', error.message);
        context.log.error('Error stack:', error.stack);
        context.log.error('Error name:', error.name);
        context.log.error('Request method:', req.method);
        context.log.error('Request URL:', req.url);
        context.log.error('Request params:', req.params);
        
        // Ensure headers are set for CORS even in error case
        if (!context.res.headers) {
            const origin = req.headers.origin;
            const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
            context.res = {
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin,
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Allow-Credentials': 'true'
                }
            };
        }
        
        if (error.message.includes('Access denied') || error.message.includes('Invalid token')) {
            context.res.status = 403;
            context.res.body = { error: 'Access denied' };
        } else {
            context.res.status = 500;
            context.res.body = { 
                error: 'Internal server error', 
                message: error.message
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

// Invite new user
async function handleInviteUser(context, orgId, inviteData, adminUser) {
    try {
        context.log('=== HANDLE INVITE USER START ===');
        context.log('OrgId:', orgId);
        context.log('InviteData:', inviteData);
        
        const { firstName, lastName, email, role = 'user' } = inviteData;
        
        if (!email || !firstName || !lastName) {
            context.res.status = 400;
            context.res.body = { error: 'First name, last name, and email are required' };
            return;
        }

        // Check if database is available
        if (!usersContainer || !organizationsContainer) {
            context.log('Database not available, returning demo response');
            const userId = uuidv4();
            context.res.status = 200;
            context.res.body = {
                message: 'User invited successfully (demo mode - database not available)',
                user: {
                    id: userId,
                    email: email,
                    firstName: firstName,
                    lastName: lastName,
                    role: role
                }
            };
            return;
        }

        // Check if user already exists
        const existingUserQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId",
            parameters: [
                { name: "@email", value: email },
                { name: "@orgId", value: orgId }
            ]
        };
        
        const { resources: existingUsers } = await usersContainer.items.query(existingUserQuery).fetchAll();
        
        if (existingUsers.length > 0) {
            context.res.status = 400;
            context.res.body = { error: 'User with this email already exists in the organization' };
            return;
        }

        // Check license availability
        const usage = await getOrganizationUsage(orgId);
        if (usage.available <= 0) {
            context.res.status = 400;
            context.res.body = { error: 'No available licenses. Please upgrade your plan.' };
            return;
        }
        
        // Create new user
        const userId = uuidv4();
        const newUser = {
            id: userId,
            email: email,
            firstName: firstName,
            lastName: lastName,
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
            message: 'User invited successfully',
            user: {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: lastName,
                role: role
            }
        };
        
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