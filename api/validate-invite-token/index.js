const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
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

        // Find organization with matching invite token
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
                expiresAt: inviteLink.expiresAt
            }
        };

    } catch (error) {
        context.log.error('Error validating invite token:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};