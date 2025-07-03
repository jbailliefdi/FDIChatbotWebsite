const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY,
});

const database = cosmosClient.database('TIA');
const inviteLinksContainer = database.container('inviteLinks');

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

        // Find invite link by token
        const linkQuery = {
            query: "SELECT * FROM c WHERE c.token = @token AND c.active = true",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: inviteLinks } = await inviteLinksContainer.items.query(linkQuery).fetchAll();
        
        if (inviteLinks.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Invalid or expired invitation link' }
            };
            return;
        }

        const inviteLink = inviteLinks[0];

        // Check if token is expired
        const now = new Date();
        const expirationDate = new Date(inviteLink.expiresAt);
        
        if (now > expirationDate) {
            // Deactivate expired link
            await inviteLinksContainer.item(inviteLink.id, inviteLink.organizationId).patch([
                { op: 'replace', path: '/active', value: false }
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
                organizationId: inviteLink.organizationId,
                organizationName: inviteLink.organizationName,
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