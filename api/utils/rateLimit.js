const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');

const MONTHLY_QUERY_LIMIT = 50;

async function checkAndUpdateRateLimit(userId) {
    try {
        // Get user document
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.status = 'active'",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        // Check if we need to reset the counter (new month)
        let resetDate = new Date(user.questionsResetDate || user.createdAt);
        let questionsAsked = user.questionsAsked || 0;
        
        // If user doesn't have rate limiting fields, initialize them
        if (user.questionsAsked === undefined || user.questionsResetDate === undefined) {
            console.log(`Initializing rate limit fields for user: ${user.email || user.id}`);
            const currentDate = new Date();
            await usersContainer.item(user.id, user.organizationId).patch([
                { op: 'add', path: '/questionsAsked', value: 0 },
                { op: 'add', path: '/questionsResetDate', value: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString() }
            ]);
        }
        
        // If it's a new month, reset the counter
        if (resetDate.getMonth() !== currentMonth || resetDate.getFullYear() !== currentYear) {
            questionsAsked = 0;
            resetDate = new Date(currentYear, currentMonth, 1);
        }

        // Check if user has exceeded the limit
        if (questionsAsked >= MONTHLY_QUERY_LIMIT) {
            return {
                allowed: false,
                questionsAsked: questionsAsked,
                limit: MONTHLY_QUERY_LIMIT,
                resetDate: new Date(currentYear, currentMonth + 1, 1).toISOString()
            };
        }

        // Increment the counter
        const newQuestionsAsked = questionsAsked + 1;
        
        // Update user document
        await usersContainer.item(user.id, user.organizationId).patch([
            { op: 'replace', path: '/questionsAsked', value: newQuestionsAsked },
            { op: 'replace', path: '/questionsResetDate', value: resetDate.toISOString() }
        ]);

        return {
            allowed: true,
            questionsAsked: newQuestionsAsked,
            limit: MONTHLY_QUERY_LIMIT,
            resetDate: new Date(currentYear, currentMonth + 1, 1).toISOString()
        };

    } catch (error) {
        console.error('Rate limit check failed:', error);
        throw error;
    }
}

async function getRateLimitStatus(userId) {
    try {
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.status = 'active'",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        let resetDate = new Date(user.questionsResetDate || user.createdAt);
        let questionsAsked = user.questionsAsked || 0;
        
        // If it's a new month, the counter would be reset
        if (resetDate.getMonth() !== currentMonth || resetDate.getFullYear() !== currentYear) {
            questionsAsked = 0;
        }

        return {
            questionsAsked: questionsAsked,
            limit: MONTHLY_QUERY_LIMIT,
            remaining: MONTHLY_QUERY_LIMIT - questionsAsked,
            resetDate: new Date(currentYear, currentMonth + 1, 1).toISOString()
        };

    } catch (error) {
        console.error('Get rate limit status failed:', error);
        throw error;
    }
}

module.exports = {
    checkAndUpdateRateLimit,
    getRateLimitStatus,
    MONTHLY_QUERY_LIMIT
};