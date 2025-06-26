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
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://your-domain.azurestaticapps.net',
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
        const orgQuery = {
            query: "SELECT c.id, c.name, c.adminEmail, c.licenseCount, c.status, c.createdAt FROM c ORDER BY c.createdAt DESC"
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