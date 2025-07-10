const { CosmosClient } = require('@azure/cosmos');
const { getRateLimitStatus } = require('../utils/rateLimit');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { email } = req.body;
        
        if (!email) {
            context.res = { status: 400, body: { message: 'Email required in request body' } };
            return;
        }

        // Clean and validate email
        const cleanEmail = email.toLowerCase().trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            context.res = { status: 400, body: { message: 'Valid email required' } };
            return;
        }

        // Find user by email
        const userQuery = {
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email) AND c.status = 'active'",
            parameters: [{ name: "@email", value: cleanEmail }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 404, body: { message: 'User not found' } };
            return;
        }

        const user = users[0];
        const rateLimitStatus = await getRateLimitStatus(user.id);

        context.res = {
            status: 200,
            body: {
                questionsAsked: rateLimitStatus.questionsAsked,
                limit: rateLimitStatus.limit,
                remaining: rateLimitStatus.remaining,
                resetDate: rateLimitStatus.resetDate
            }
        };

    } catch (error) {
        context.log.error('Error getting rate limit status:', error.message);
        context.res = {
            status: 500,
            body: { message: 'Service temporarily unavailable' }
        };
    }
};