// Modified version of your existing update-subscription API
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

    const { organizationId, stripeCustomerId, stripeSubscriptionId, newLicenseCount, userEmail, action } = req.body;

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

        const currentLicenseCount = organization.licenseCount || 1;
        const isUpgrade = newLicenseCount > currentLicenseCount;
        const isDowngrade = newLicenseCount < currentLicenseCount;

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

        // SECURITY FIX: Handle upgrades and downgrades differently
        if (isUpgrade) {
            // For upgrades, create a Stripe checkout session instead of immediate update
            const additionalLicenses = newLicenseCount - currentLicenseCount;
            const immediateCharge = additionalLicenses * 50; // £50 per license
            
            try {
                const session = await stripe.checkout.sessions.create({
                    customer: stripeCustomerId,
                    payment_method_types: ['card'],
                    mode: 'payment',
                    line_items: [
                        {
                            price_data: {
                                currency: 'gbp',
                                product_data: {
                                    name: `TIA License Upgrade`,
                                    description: `Add ${additionalLicenses} license${additionalLicenses > 1 ? 's' : ''} (pro-rated for current billing period)`
                                },
                                unit_amount: 5000 // £50 in pence
                            },
                            quantity: additionalLicenses
                        }
                    ],
                    metadata: {
                        type: 'license_upgrade',
                        organizationId: organizationId,
                        currentLicenseCount: currentLicenseCount.toString(),
                        newLicenseCount: newLicenseCount.toString(),
                        stripeSubscriptionId: stripeSubscriptionId || '',
                        userEmail: userEmail
                    },
                    success_url: `${req.headers.referer || 'https://kind-mud-048fffa03.6.azurestaticapps.net'}payment-success`,
                    cancel_url: req.headers.referer || 'https://google.com'
                });

                context.res.status = 200;
                context.res.body = { 
                    requiresPayment: true,
                    checkoutUrl: session.url,
                    sessionId: session.id,
                    message: `Upgrade requires payment of £${immediateCharge}. You will be redirected to Stripe.`
                };
                return;

            } catch (stripeError) {
                context.log.error('Stripe checkout creation error:', stripeError);
                context.res.status = 500;
                context.res.body = { error: 'Failed to create checkout session: ' + stripeError.message };
                return;
            }

        } else if (isDowngrade) {
            // For downgrades, schedule the change for next billing cycle
            if (stripeSubscriptionId) {
                try {
                    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                    const subscriptionItem = subscription.items.data[0];
                    
                    // Schedule the subscription modification for the next billing cycle
                    const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
                        items: [{
                            id: subscriptionItem.id,
                            price: subscriptionItem.price.id,
                            quantity: newLicenseCount
                        }],
                        proration_behavior: 'none', // Don't prorate, wait until next billing cycle
                        metadata: {
                            ...subscription.metadata,
                            pendingDowngrade: 'true',
                            pendingLicenseCount: newLicenseCount.toString(),
                            downgradeScheduledBy: userEmail,
                            downgradeScheduledAt: new Date().toISOString()
                        }
                    });

                    // Update organization record with pending downgrade info
                    const updatedOrg = {
                        ...organization,
                        pendingLicenseCount: newLicenseCount,
                        pendingDowngrade: true,
                        downgradeScheduledAt: new Date().toISOString(),
                        downgradeScheduledBy: userEmail,
                        lastModified: new Date().toISOString()
                    };

                    await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

                    const nextBillingDate = new Date(subscription.current_period_end * 1000);

                    context.res.status = 200;
                    context.res.body = { 
                        success: true,
                        isDowngrade: true,
                        message: `Downgrade scheduled! Your license count will change from ${currentLicenseCount} to ${newLicenseCount} on ${nextBillingDate.toLocaleDateString('en-GB')}.`,
                        nextBillingDate: nextBillingDate.toISOString(),
                        newLicenseCount: newLicenseCount,
                        newMonthlyAmount: newLicenseCount * 50,
                        pendingDowngrade: true
                    };
                    return;

                } catch (stripeError) {
                    context.log.error('Stripe downgrade scheduling error:', stripeError);
                    context.res.status = 500;
                    context.res.body = { error: 'Failed to schedule downgrade: ' + stripeError.message };
                    return;
                }
            }

        } else {
            // No change in license count
            context.res.status = 200;
            context.res.body = { 
                success: true,
                message: 'No changes needed - license count is the same.',
                newLicenseCount: currentLicenseCount
            };
            return;
        }

        // This should not be reached, but keeping as fallback
        context.res.status = 400;
        context.res.body = { error: 'Invalid operation' };

    } catch (error) {
        context.log.error('Error updating subscription:', error);
        context.res.status = 500;
        context.res.body = { error: 'Internal server error' };
    }
};