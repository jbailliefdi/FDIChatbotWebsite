// SECURE Fixed version of your update-subscription API
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

        // 🔒 SECURE: Handle upgrades with immediate payment + subscription update
        if (isUpgrade) {
            if (!stripeSubscriptionId) {
                context.res.status = 400;
                context.res.body = { error: 'No subscription found to upgrade' };
                return;
            }

            try {
                // Get the current subscription to understand billing cycle
                const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                
                if (!subscription || subscription.items.data.length === 0) {
                    throw new Error('Invalid subscription structure');
                }

                const subscriptionItem = subscription.items.data[0];
                const additionalLicenses = newLicenseCount - currentLicenseCount;
                
                // Get price per license based on subscription interval for messaging
                const priceData = subscription.items.data[0].price;
                const isAnnual = priceData.recurring.interval === 'year';
                const pricePerLicense = isAnnual ? 550 : 50; // £550 annual, £50 monthly
                
                // 🔒 SECURE APPROACH: Use subscription update with immediate proration
                // This automatically creates prorated charges and updates the subscription correctly
                const updatedSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
                    items: [{
                        id: subscriptionItem.id,
                        quantity: newLicenseCount,
                    }],
                    proration_behavior: 'always_invoice', // Creates immediate invoice for proration
                    payment_behavior: 'error_if_incomplete' // Fail if payment doesn't work
                });

                // Update organization record in database
                const updatedOrg = {
                    ...organization,
                    licenseCount: newLicenseCount,
                    lastModified: new Date().toISOString(),
                    // Clear any pending downgrade info
                    pendingDowngrade: false,
                    pendingLicenseCount: null,
                    downgradeScheduledAt: null,
                    downgradeScheduledBy: null
                };

                await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

                const newMonthlyAmount = newLicenseCount * pricePerLicense;
                
                context.res.status = 200;
                context.res.body = { 
                    success: true,
                    requiresPayment: false, // Payment already processed via proration
                    message: `Upgrade successful! You now have ${newLicenseCount} licenses. You'll see a prorated charge for the ${additionalLicenses} additional license${additionalLicenses > 1 ? 's' : ''} on your next invoice. Your future bills will be £${newMonthlyAmount}/${isAnnual ? 'year' : 'month'}.`,
                    newLicenseCount: newLicenseCount,
                    newMonthlyAmount: newMonthlyAmount,
                    isUpgrade: true,
                    subscriptionId: updatedSubscription.id
                };
                return;

            } catch (stripeError) {
                context.log.error('Stripe subscription update error:', stripeError);
                
                // If payment fails, don't update anything
                if (stripeError.code === 'card_declined' || stripeError.type === 'card_error') {
                    context.res.status = 402;
                    context.res.body = { error: 'Payment failed: ' + stripeError.message };
                } else {
                    context.res.status = 500;
                    context.res.body = { error: 'Failed to process upgrade: ' + stripeError.message };
                }
                return;
            }
        }
        else if (isDowngrade) {
            // For downgrades, schedule the change for next billing cycle (no immediate payment)
            if (stripeSubscriptionId) {
                try {
                    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                    
                    // Update the subscription metadata to track pending downgrade
                    await stripe.subscriptions.update(stripeSubscriptionId, {
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