const { CosmosClient } = require('@azure/cosmos');
const { withRateLimitWrapper } = require('../utils/rateLimitMiddleware');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

async function validateInviteTokenHandler(context, req) {
    context.log('Validate invite token function processed a request.');

    try {
        const { token } = req.body;

        if (!token) {
            context.res = {
                status: 400,
                body: { error: 'Token is required' }
            };
            return;
        }

        // First, check if this is a user-specific invitation token
        const userQuery = {
            query: "SELECT * FROM c WHERE c.inviteToken = @token AND c.status = 'pending'",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length > 0) {
            const user = users[0];
            
            // Check if user invite token is expired
            const now = new Date();
            const expirationDate = new Date(user.inviteExpires);
            
            if (now > expirationDate) {
                context.res = {
                    status: 404,
                    body: { error: 'User invitation has expired' }
                };
                return;
            }
            
            // Get organization details
            const orgQuery = {
                query: "SELECT * FROM c WHERE c.id = @orgId",
                parameters: [
                    { name: "@orgId", value: user.organizationId }
                ]
            };

            const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
            
            if (organizations.length === 0) {
                context.res = {
                    status: 404,
                    body: { error: 'Organization not found' }
                };
                return;
            }

            const organization = organizations[0];
            
            context.res = {
                status: 200,
                body: {
                    organizationId: organization.id,
                    organizationName: organization.name,
                    expiresAt: user.inviteExpires,
                    inviteType: 'user',
                    userEmail: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName
                }
            };
            return;
        }

        // If not a user token, check for organization invite link
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.inviteLink.token = @token AND c.inviteLink.active = true",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Invalid or expired invitation link' }
            };
            return;
        }

        const organization = organizations[0];
        const inviteLink = organization.inviteLink;

        // Check if token is expired
        const now = new Date();
        const expirationDate = new Date(inviteLink.expiresAt);
        
        if (now > expirationDate) {
            // Deactivate expired link
            await organizationsContainer.item(organization.id, organization.id).patch([
                { op: 'replace', path: '/inviteLink/active', value: false }
            ]);

            context.res = {
                status: 404,
                body: { error: 'Invitation link has expired' }
            };
            return;
        }

        context.res = {
            status: 200,
            body: {
                organizationId: organization.id,
                organizationName: organization.name,
                expiresAt: inviteLink.expiresAt,
                inviteType: 'organization'
            }
        };

    } catch (error) {
        context.log.error('Error validating invite token:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
}

// Export with rate limiting protection
module.exports = withRateLimitWrapper(validateInviteTokenHandler, {
    limitType: 'auth' // 50 requests per hour per IP
});