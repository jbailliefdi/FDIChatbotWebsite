const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { email } = req.body;
        
        context.log('Bot token request received for email:', email);
        
        if (!email) {
            context.log.error('No email provided in bot token request');
            context.res = { status: 400, body: { message: 'Email required in request body' } };
            return;
        }

        // Handle various email formats that might come from MSAL
        let cleanEmail = email;
        if (typeof email === 'string') {
            cleanEmail = email.toLowerCase().trim();
        } else {
            context.log.error('Email is not a string:', typeof email, email);
            context.res = { status: 400, body: { message: 'Email must be a string' } };
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            context.log.error('Invalid email format:', cleanEmail);
            context.res = { status: 400, body: { message: 'Valid email required' } };
            return;
        }

        // Verify user exists and has active subscription in CosmosDB
        let user;
        try {
            const userQuery = {
                query: "SELECT u.*, o.status as orgStatus FROM users u JOIN organizations o ON u.organizationId = o.id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'active' AND o.status IN ('active', 'trialing')",
                parameters: [{ name: "@email", value: cleanEmail }]
            };

            context.log('Executing user query for email:', cleanEmail);
            const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
            context.log('Query completed. Found users:', users.length);

            if (users.length === 0) {
                context.log.error('No active user found for email:', cleanEmail);
                context.res = { status: 403, body: { message: 'Access denied - no active subscription found' } };
                return;
            }

            user = users[0];
            context.log('Active user found:', user.id, 'Organization:', user.organizationId);
        } catch (dbError) {
            context.log.error('Database query failed:', dbError);
            context.res = { 
                status: 503, 
                body: { message: 'Service temporarily unavailable - database connection failed' } 
            };
            return;
        }

        // Update last login timestamp
        try {
            await usersContainer.item(user.id, user.organizationId).patch([
                { op: 'replace', path: '/lastLogin', value: new Date().toISOString() }
            ]);
        } catch (patchError) {
            context.log.warn('Could not update last login:', patchError.message);
            // Don't fail the request for this
        }

        // Return the DirectLine token only for authenticated users with active subscriptions
        context.res = {
            status: 200,
            body: {
                token: process.env.DIRECT_LINE_TOKEN,
                userId: user.id,
                organizationId: user.organizationId
            }
        };

        context.log('DirectLine token returned for user:', user.id);

    } catch (error) {
        context.log.error('Error getting bot token:', error);
        context.log.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        
        // Provide more specific error messages for debugging
        let errorMessage = 'Failed to get token';
        if (error.message.includes('CosmosDB') || error.code === 'ENOTFOUND') {
            errorMessage = 'Database connection error';
        } else if (error.message.includes('query')) {
            errorMessage = 'Database query error';
        } else {
            errorMessage = `Failed to get token: ${error.message}`;
        }
        
        context.res = {
            status: 500,
            body: { message: errorMessage }
        };
    }
};