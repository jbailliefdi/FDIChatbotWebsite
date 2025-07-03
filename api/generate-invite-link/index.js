const { CosmosClient } = require('@azure/cosmos');
const crypto = require('crypto');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Generate invite link function processed a request.');

    try {
        const { organizationId, userEmail } = req.body;

        context.log('Request data:', { organizationId, userEmail });

        if (!organizationId || !userEmail) {
            context.res = {
                status: 400,
                body: { error: 'Organization ID and user email are required' }
            };
            return;
        }

        // Verify user is admin of the organization
        const userQuery = {
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email) AND c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
            parameters: [
                { name: "@email", value: userEmail.toLowerCase() },
                { name: "@orgId", value: organizationId }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        context.log('User query result:', users.length, 'users found');
        
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
        
        context.log('Organization query result:', organizations.length, 'organizations found');
        
        if (organizations.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Organization not found' }
            };
            return;
        }

        const organization = organizations[0];
        context.log('Found organization:', organization.name);

        // Generate unique token
        const token = crypto.randomBytes(32).toString('hex');
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30); // 30 days expiration

        // Store invite link data in the organization document
        const inviteLinkData = {
            token: token,
            createdBy: userEmail,
            createdAt: new Date().toISOString(),
            expiresAt: expirationDate.toISOString(),
            active: true,
            usageCount: 0
        };

        // Update organization with new invite link
        try {
            await organizationsContainer.item(organizationId, organizationId).patch([
                { op: 'replace', path: '/inviteLink', value: inviteLinkData }
            ]);
        } catch (patchError) {
            // If replace fails (property doesn't exist), try add instead
            context.log('Replace failed, trying add operation:', patchError.message);
            await organizationsContainer.item(organizationId, organizationId).patch([
                { op: 'add', path: '/inviteLink', value: inviteLinkData }
            ]);
        }

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