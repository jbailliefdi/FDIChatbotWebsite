// organizations/index.js - Simple function to list organizations

const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Organizations API request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': process.env.SITE_DOMAIN || 'https://kind-mud-048fffa03.6.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    if (req.method !== 'GET') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    try {
        // SECURITY: Check Azure Static Web Apps authentication
        const clientPrincipal = req.headers['x-ms-client-principal'];
        if (!clientPrincipal) {
            context.res.status = 401;
            context.res.body = { error: 'Authentication required' };
            return;
        }

        // Parse authenticated user info
        const user = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString());
        if (!user || !user.userDetails) {
            context.res.status = 401;
            context.res.body = { error: 'Invalid authentication' };
            return;
        }

        const authenticatedEmail = user.userDetails;
        
        // SECURITY: Only return organizations where the user is a member
        // Find user's organization
        const usersContainer = database.container('users');
        
        const userQuery = {
            query: "SELECT c.organizationId FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: authenticatedEmail }]
        };
        
        const { resources: userRecords } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (userRecords.length === 0) {
            context.res.status = 403;
            context.res.body = { error: 'User not found in any organization' };
            return;
        }
        
        const userOrgId = userRecords[0].organizationId;
        
        // Only return the user's organization
        const orgQuery = {
            query: "SELECT c.id, c.name, c.adminEmail, c.licenseCount, c.status, c.createdAt FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: userOrgId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        context.res.status = 200;
        context.res.body = { organizations };
        
        context.log('Organizations listed:', organizations.length);
    } catch (error) {
        context.log.error('Error listing organizations:', error);
        context.res.status = 500;
        context.res.body = { error: error.message || 'Internal server error' };
    }
};