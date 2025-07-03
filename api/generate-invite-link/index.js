const { CosmosClient } = require('@azure/cosmos');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY,
});

const database = cosmosClient.database('TIA');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');
const inviteLinksContainer = database.container('inviteLinks');

module.exports = async function (context, req) {
    context.log('Generate invite link function processed a request.');

    try {
        const { organizationId, userEmail } = req.body;

        if (!organizationId || !userEmail) {
            context.res = {
                status: 400,
                body: { error: 'Organization ID and user email are required' }
            };
            return;
        }

        // Verify user is admin of the organization
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
            parameters: [
                { name: "@email", value: userEmail },
                { name: "@orgId", value: organizationId }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = {
                status: 403,
                body: { error: 'Unauthorized - Admin access required' }
            };
            return;
        }

        // Get organization details
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [
                { name: "@orgId", value: organizationId }
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

        // Generate unique token
        const token = crypto.randomBytes(32).toString('hex');
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30); // 30 days expiration

        // Check if an existing invite link exists for this organization
        const existingLinkQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @orgId AND c.active = true",
            parameters: [
                { name: "@orgId", value: organizationId }
            ]
        };

        const { resources: existingLinks } = await inviteLinksContainer.items.query(existingLinkQuery).fetchAll();
        
        // Deactivate existing links
        for (const link of existingLinks) {
            await inviteLinksContainer.item(link.id, link.organizationId).patch([
                { op: 'replace', path: '/active', value: false }
            ]);
        }

        // Create new invite link record
        const inviteLink = {
            id: token,
            organizationId: organizationId,
            organizationName: organization.name,
            token: token,
            createdBy: userEmail,
            createdAt: new Date().toISOString(),
            expiresAt: expirationDate.toISOString(),
            active: true,
            usageCount: 0
        };

        await inviteLinksContainer.items.create(inviteLink);

        context.res = {
            status: 200,
            body: {
                token: token,
                expiresAt: expirationDate.toISOString(),
                organizationName: organization.name
            }
        };

    } catch (error) {
        context.log.error('Error generating invite link:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};