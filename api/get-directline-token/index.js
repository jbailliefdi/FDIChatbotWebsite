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
        // Validate authentication token
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            context.res = { status: 401, body: { message: 'Authorization header required' } };
            return;
        }

        const decoded = await validateToken(authHeader);
        const userEmail = decoded.preferred_username || decoded.email || decoded.unique_name;
        
        if (!userEmail) {
            context.res = { status: 401, body: { message: 'Invalid token - no email found' } };
            return;
        }

        // Verify user exists and has active subscription
        const userQuery = {
            query: "SELECT u.*, o.status as orgStatus FROM users u JOIN organizations o ON u.organizationId = o.id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'active' AND o.status IN ('active', 'trialing')",
            parameters: [{ name: "@email", value: userEmail.toLowerCase() }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            context.res = { status: 403, body: { message: 'Access denied - no active subscription found' } };
            return;
        }

        // Return the DirectLine token only for authenticated users
        context.res = {
            status: 200,
            body: {
                token: process.env.DIRECT_LINE_TOKEN,
                userId: users[0].id,
                organizationId: users[0].organizationId
            }
        };

    } catch (error) {
        context.log.error('Error validating user for bot access:', error);
        context.res = {
            status: 401,
            body: { message: 'Authentication failed' }
        };
    }
};