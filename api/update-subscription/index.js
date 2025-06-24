const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Update subscription request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    const { organizationId, stripeCustomerId, stripeSubscriptionId, newLicenseCount, userEmail } = req.body;

    if (!organizationId || !stripeCustomerId || !newLicenseCount || !userEmail) {
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
            context.res.body = { error: 'Access denied. Only admins can update subscriptions.' };
            return;
        }

        // Get organization
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
        }

        // Verify ownership
        if (organization.stripeCustomerId !== stripeCustomerId) {
            context.res.status = 403;
            context.res.body = { error: 'Unauthorized' };
            return;
        }

        // Check active users don't exceed new license count
        const activeUsersQuery = {
            query: "SELECT COUNT(1) as count FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organizationId }]
        };
        
        const { resources: countResult } = await usersContainer.items.query(activeUsersQuery).fetchAll();
        const activeUserCount = countResult[0]?.count || 0;

        if (newLicenseCount < activeUserCount) {
            context.res.status = 400;
            context.res.body = { 
                error: `Cannot reduce licenses below active user count. You have ${activeUserCount} active users.`,
                activeUsers: activeUserCount,
                requestedLicenses: newLicenseCount
            };
            return;
        }

        let updatedSubscription = null;

        // Update Stripe subscription if exists
        if (stripeSubscriptionId) {
            try {
                // Get current subscription
                const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                
                // Find the subscription item (assumes single item)
                const subscriptionItem = subscription.items.data[0];
                
                if (subscriptionItem) {
                    // Update the quantity
                    updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
                        items: [{
                            id: subscriptionItem.id,
                            quantity: newLicenseCount
                        }],
                        proration_behavior: 'create_prorations'
                    });

                    context.log('Stripe subscription updated:', updatedSubscription.id);
                }
            } catch (stripeError) {
                context.log.error('Stripe update error:', stripeError);
                context.res.status = 500;
                context.res.body = { error: 'Failed to update Stripe subscription: ' + stripeError.message };
                return;
            }
        }

        // Update organization in Cosmos DB
        organization.licenseCount = newLicenseCount;
        organization.lastModified = new Date().toISOString();
        
        await organizationsContainer.item(organizationId, organizationId).replace(organization);

        context.log('Organization updated with new license count:', newLicenseCount);

        context.res.status = 200;
        context.res.body = { 
            success: true,
            newLicenseCount: newLicenseCount,
            previousLicenseCount: organization.licenseCount,
            subscription: updatedSubscription ? {
                id: updatedSubscription.id,
                status: updatedSubscription.status,
                currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000).toISOString()
            } : null
        };

    } catch (error) {
        context.log.error('Error updating subscription:', error);
        context.res.status = 500;
        context.res.body = { error: 'Internal server error' };
    }
};