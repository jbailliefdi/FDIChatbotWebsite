const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

// Initialize Cosmos DB client
let cosmosClient, database, organizationsContainer, usersContainer;

try {
    if (process.env.COSMOS_DB_CONNECTION_STRING) {
        cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
        database = cosmosClient.database('fdi-chatbot');
        organizationsContainer = database.container('organizations');
        usersContainer = database.container('users');
        console.log('Cosmos DB initialized successfully');
    } else {
        console.warn('COSMOS_DB_CONNECTION_STRING not found. Database operations will be disabled.');
    }
} catch (error) {
    console.error('Failed to initialize Cosmos DB client:', error.message);
}

module.exports = async function (context, req) {
    context.log('=== DASHBOARD API CALLED ===');
    context.log('Method:', req.method);
    context.log('URL:', req.url);
    context.log('Params:', req.params);
    context.log('Body:', req.body);

    // CORS headers
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': 'https://kind-mud-048fffa03.6.azurestaticapps.net',
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
        
        context.log('Parsed - Method:', method, 'OrgId:', orgId, 'Segments:', segments);

        // Route: /api/organization/{orgId}/invite - POST
        if (method === 'POST' && segments.includes('invite')) {
            context.log('INVITE ROUTE MATCHED!');
            
            const { firstName, lastName, email, role = 'user' } = req.body || {};
            
            if (!email || !firstName || !lastName) {
                context.res.status = 400;
                context.res.body = { error: 'First name, last name, and email are required' };
                return;
            }

            // Check if database is available
            if (!usersContainer || !organizationsContainer) {
                context.log('Database not available, returning demo response');
                context.res.status = 200;
                context.res.body = {
                    message: 'User invited successfully (demo mode - database not available)',
                    user: {
                        id: 'demo-' + Date.now(),
                        email: email,
                        firstName: firstName,
                        lastName: lastName,
                        role: role
                    }
                };
                return;
            }

            try {
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
                
                context.log('Creating user:', newUser);
                await usersContainer.items.create(newUser);
                context.log('User created successfully');
                
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
                
            } catch (dbError) {
                context.log.error('Database error:', dbError);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to create user',
                    message: dbError.message
                };
            }
            return;
        }
        
        // Route: /api/organization/{orgId}/overview - GET
        if (method === 'GET' && segments.includes('overview')) {
            context.log('OVERVIEW ROUTE MATCHED!');
            
            // Check if database is available
            if (!usersContainer || !organizationsContainer) {
                context.log('Database not available, returning demo response');
                context.res.status = 200;
                context.res.body = {
                    organization: { id: orgId, name: 'Demo Organization' },
                    users: [],
                    usage: { total: 2, used: 0, available: 2, percentage: 0 }
                };
                return;
            }

            try {
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
                    query: "SELECT c.id, c.email, c.firstName, c.lastName, c.role, c.status, c.createdAt, c.lastLogin FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt DESC",
                    parameters: [{ name: "@orgId", value: orgId }]
                };
                
                const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();
                
                // Calculate usage stats
                const activeUsers = users.filter(u => u.status === 'active').length;
                const usage = {
                    total: organization.licenseCount || 2,
                    used: activeUsers,
                    available: (organization.licenseCount || 2) - activeUsers,
                    percentage: Math.round((activeUsers / (organization.licenseCount || 2)) * 100)
                };
                
                context.res.status = 200;
                context.res.body = {
                    organization: {
                        id: organization.id,
                        name: organization.name,
                        licenseCount: organization.licenseCount,
                        status: organization.status,
                        createdAt: organization.createdAt
                    },
                    users,
                    usage
                };
                
            } catch (dbError) {
                context.log.error('Database error:', dbError);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to get organization overview',
                    message: dbError.message
                };
            }
            return;
        }
        
        // Default response
        context.res.status = 200;
        context.res.body = {
            message: 'Dashboard API endpoint reached',
            method: method,
            orgId: orgId,
            segments: segments,
            url: req.url
        };
        
    } catch (error) {
        context.log.error('Error:', error);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: error.message
        };
    }
};