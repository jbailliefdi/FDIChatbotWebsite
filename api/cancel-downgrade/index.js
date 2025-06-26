const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Cancel downgrade request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://your-domain.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    const { organizationId, stripeSubscriptionId, userEmail } = req.body;

    if (!organizationId || !userEmail) {
        context.res.status = 400;
        context.res.body = { error: 'Missing required fields' };
        return;
    }

    try {
        // Verify user is admin
        const userQuery = {
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@userEmail) AND c.organizationId = @orgId",
            parameters: [
                { name: "@userEmail", value: userEmail },
                { name: "@orgId", value: organizationId }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0 || users[0].role !== 'admin') {
            context.res.status = 403;
            context.res.body = { error: 'Access denied. Only admins can cancel downgrades.' };
            return;
        }

        // Get organization
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
        }

        // Check if there's a pending downgrade
        if (!organization.pendingDowngrade) {
            context.res.status = 400;
            context.res.body = { error: 'No pending downgrade found' };
            return;
        }

        // Remove pending downgrade from Stripe subscription metadata
        if (stripeSubscriptionId) {
            try {
                const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                
                // Remove downgrade-related metadata
                const updatedMetadata = { ...subscription.metadata };
                delete updatedMetadata.pendingDowngrade;
                delete updatedMetadata.pendingLicenseCount;
                delete updatedMetadata.downgradeScheduledBy;
                delete updatedMetadata.downgradeScheduledAt;
                
                await stripe.subscriptions.update(stripeSubscriptionId, {
                    metadata: updatedMetadata
                });

            } catch (stripeError) {
                context.log.warn('Could not update Stripe subscription metadata:', stripeError);
                // Continue anyway, the organization update is more important
            }
        }

        // Update organization record to remove pending downgrade
        const updatedOrg = {
            ...organization,
            pendingDowngrade: false,
            pendingLicenseCount: null,
            downgradeScheduledAt: null,
            downgradeScheduledBy: null,
            lastModified: new Date().toISOString()
        };

        await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

        context.res.status = 200;
        context.res.body = { 
            success: true,
            message: 'Pending downgrade cancelled successfully. Your license count will remain unchanged.'
        };

    } catch (error) {
        context.log.error('Error cancelling downgrade:', error);
        context.res.status = 500;
        context.res.body = { error: 'Internal server error' };
    }
};