// SECURE Fixed version of your update-subscription API with Stripe Checkout
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

        // 🔒 SECURE: Handle upgrades with Stripe Checkout for transparency
        if (isUpgrade) {
            if (!stripeSubscriptionId) {
                context.res.status = 400;
                context.res.body = { error: 'No subscription found to upgrade' };
                return;
            }

            try {
                // Get the current subscription to understand billing cycle and calculate costs
                const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                
                if (!subscription || subscription.items.data.length === 0) {
                    throw new Error('Invalid subscription structure');
                }

                const additionalLicenses = newLicenseCount - currentLicenseCount;
                
                // Calculate prorated cost for transparency
                const currentPeriodStart = subscription.current_period_start;
                const currentPeriodEnd = subscription.current_period_end;
                const now = Math.floor(Date.now() / 1000);
                const totalPeriodDuration = currentPeriodEnd - currentPeriodStart;
                const remainingPeriodDuration = currentPeriodEnd - now;
                const proratedFraction = remainingPeriodDuration / totalPeriodDuration;
                
                // Get price per license based on subscription interval
                const priceData = subscription.items.data[0].price;
                const isAnnual = priceData.recurring.interval === 'year';
                const pricePerLicense = isAnnual ? 550 : 50; // £550 annual, £50 monthly
                
                // Calculate immediate charge (prorated for current period)
                const proratedChargePerLicense = Math.round(pricePerLicense * proratedFraction);
                const totalImmediateCharge = proratedChargePerLicense * additionalLicenses;

                // Get the base URL for redirects
                const origin = req.headers.origin || req.headers.referer || 'https://kind-mud-048fffa03.6.azurestaticapps.net';
                
                // Create Stripe Checkout session for transparent payment
                const session = await stripe.checkout.sessions.create({
                    customer: stripeCustomerId,
                    payment_method_types: ['card'],
                    mode: 'payment',
                    allow_promotion_codes: true,
                    billing_address_collection: 'required',
                    tax_id_collection: {
                        enabled: true
                    },
                    customer_update: {
                        address: 'auto',
                        name: 'auto'
                    },
                    invoice_creation: {
                        enabled: true,
                        invoice_data: {
                            description: `TIA License Upgrade - Add ${additionalLicenses} license${additionalLicenses > 1 ? 's' : ''} (prorated)`,
                            metadata: {
                                organizationId: organizationId,
                                upgradeType: 'license_upgrade',
                                currentLicenseCount: currentLicenseCount.toString(),
                                newLicenseCount: newLicenseCount.toString(),
                                stripeSubscriptionId: stripeSubscriptionId,
                                billingInterval: isAnnual ? 'annual' : 'monthly'
                            },
                            footer: `After payment, your subscription will be updated to ${newLicenseCount} licenses at £${newLicenseCount * pricePerLicense}/${isAnnual ? 'year' : 'month'}.`
                        }
                    },
                    line_items: [
                        {
                            price_data: {
                                currency: 'gbp',
                                product_data: {
                                    name: `TIA License Upgrade`,
                                    description: `Add ${additionalLicenses} license${additionalLicenses > 1 ? 's' : ''} to your subscription (prorated for remaining ${Math.round(proratedFraction * 100)}% of billing period)`,
                                    metadata: {
                                        organizationId: organizationId,
                                        upgradeType: 'license_upgrade'
                                    }
                                },
                                unit_amount: Math.round(proratedChargePerLicense * 100), // Prorated price per license in pence
                                tax_behavior: 'exclusive'
                            },
                            quantity: additionalLicenses
                        }
                    ],
                    metadata: {
                        type: 'license_upgrade',
                        organizationId: organizationId,
                        currentLicenseCount: currentLicenseCount.toString(),
                        newLicenseCount: newLicenseCount.toString(),
                        stripeSubscriptionId: stripeSubscriptionId,
                        userEmail: userEmail,
                        billingInterval: isAnnual ? 'annual' : 'monthly',
                        // 🔒 CRITICAL: Flag that this requires subscription update after payment
                        requiresSubscriptionUpdate: 'true'
                    },
                    automatic_tax: {
                        enabled: true,
                    },
                    success_url: `${origin}/dashboard.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${origin}/dashboard.html?upgrade=cancelled`,
                    consent_collection: {
                        terms_of_service: 'required'
                    }
                });

                context.res.status = 200;
                context.res.body = { 
                    requiresPayment: true,
                    checkoutUrl: session.url,
                    sessionId: session.id,
                    billingInterval: isAnnual ? 'annual' : 'monthly',
                    proratedCharge: totalImmediateCharge,
                    newMonthlyAmount: newLicenseCount * pricePerLicense,
                    message: `Upgrade requires payment of £${totalImmediateCharge} (prorated) for ${additionalLicenses} additional license${additionalLicenses > 1 ? 's' : ''}. You will be redirected to Stripe to confirm payment.`
                };
                return;

            } catch (stripeError) {
                context.log.error('Stripe checkout creation error:', stripeError);
                context.res.status = 500;
                context.res.body = { error: 'Failed to create checkout session: ' + stripeError.message };
                return;
            }
        }
        else if (isDowngrade) {
            // For downgrades, actually update the subscription quantity for next billing cycle
            if (stripeSubscriptionId) {
                try {
                    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                    const subscriptionItem = subscription.items.data[0];
                    
                    // 🔧 FIXED: Actually update the subscription quantity in Stripe
                    // This will take effect at the next billing cycle with no proration
                    await stripe.subscriptions.update(stripeSubscriptionId, {
                        items: [{
                            id: subscriptionItem.id,
                            quantity: newLicenseCount,
                        }],
                        proration_behavior: 'none', // No proration for downgrades - change happens at next billing cycle
                        billing_cycle_anchor: 'unchanged', // Keep current billing cycle date
                        metadata: {
                            ...subscription.metadata,
                            lastDowngradeDate: new Date().toISOString(),
                            downgradeBy: userEmail,
                            previousLicenseCount: currentLicenseCount.toString()
                        }
                    });

                    // Update organization record - remove pending flags since change is now scheduled in Stripe
                    const updatedOrg = {
                        ...organization,
                        licenseCount: newLicenseCount, // Update to new count since it's now scheduled in Stripe
                        lastModified: new Date().toISOString(),
                        lastDowngradeDate: new Date().toISOString(),
                        downgradeScheduledBy: userEmail,
                        // Clear pending flags since it's now properly scheduled in Stripe
                        pendingDowngrade: false,
                        pendingLicenseCount: null,
                        downgradeScheduledAt: null
                    };

                    await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

                    const nextBillingDate = new Date(subscription.current_period_end * 1000);
                    const newMonthlyAmount = newLicenseCount * 50;

                    context.res.status = 200;
                    context.res.body = { 
                        success: true,
                        isDowngrade: true,
                        message: `Downgrade successful! Your license count will change from ${currentLicenseCount} to ${newLicenseCount} at your next billing cycle on ${nextBillingDate.toLocaleDateString('en-GB')}. Your new monthly cost will be £${newMonthlyAmount}.`,
                        nextBillingDate: nextBillingDate.toISOString(),
                        newLicenseCount: newLicenseCount,
                        newMonthlyAmount: newMonthlyAmount,
                        currentLicenseCount: currentLicenseCount,
                        effectiveDate: nextBillingDate.toISOString()
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