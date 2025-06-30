const { validateToken } = require('../utils/auth');
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        // Temporary: Allow access during trial/demo period with basic email validation
        // TODO: Implement full Microsoft authentication flow in frontend
        const { email } = req.body;
        
        if (!email) {
            context.res = { status: 400, body: { message: 'Email required' } };
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            context.res = { status: 400, body: { message: 'Valid email required' } };
            return;
        }

        // Return the DirectLine token for demo access
        // In production, this should require full authentication
        context.res = {
            status: 200,
            body: {
                token: process.env.DIRECT_LINE_TOKEN,
                userId: 'demo-user',
                organizationId: 'demo-org'
            }
        };

    } catch (error) {
        context.log.error('Error getting bot token:', error);
        context.res = {
            status: 500,
            body: { message: 'Failed to get token' }
        };
    }
};