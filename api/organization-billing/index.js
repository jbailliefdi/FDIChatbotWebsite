const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Billing API request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://your-domain.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    // Get orgId from query parameter
    const orgId = req.query.orgId;
    
    if (!orgId) {
        context.res.status = 400;
        context.res.body = { error: 'Organization ID required' };
        return;
    }

    context.log('Fetching billing for org:', orgId);

    try {
        // Get organization details
        const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
        
        if (!organization) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
        }

        // Prepare response structure
        const billingData = {
            organization: {
                id: organization.id,
                name: organization.name,
                status: organization.status || 'trialing',
                licenseCount: organization.licenseCount || 1,
                trialEndDate: organization.trialEndDate,
                stripeCustomerId: organization.stripeCustomerId
            }
        };

        // If organization has a Stripe customer ID, fetch real billing data
        if (organization.stripeCustomerId) {
            try {
                // Get customer data
                const customer = await stripe.customers.retrieve(organization.stripeCustomerId);
                
                // Get subscription details
                if (organization.stripeSubscriptionId) {
                    try {
                        const subscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
                        
                        // Detect billing interval and calculate correct pricing
const priceData = subscription.items.data[0].price;
const isAnnual = priceData.recurring.interval === 'year';
const pricePerLicense = isAnnual ? 550 : 50;
const totalAmount = organization.licenseCount * pricePerLicense;
const billingPeriod = isAnnual ? 'year' : 'month';

billingData.subscription = {
    id: subscription.id,
    status: subscription.status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    pricePerLicense: pricePerLicense,
    totalAmount: totalAmount,
    billingInterval: billingPeriod,
    cancelAtPeriodEnd: subscription.cancel_at_period_end
};
                    } catch (err) {
                        context.log.warn('Could not fetch subscription:', err);
                    }
                } else {
                    // Fallback to listing if no subscription ID stored
                    const subscriptions = await stripe.subscriptions.list({
                        customer: organization.stripeCustomerId,
                        status: 'active',
                        limit: 1
                    });
                    
                    if (subscriptions.data.length > 0) {
                        const sub = subscriptions.data[0];
                        billingData.subscription = {
                            id: sub.id,
                            status: sub.status,
                            currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
                            pricePerLicense: 50,
                            totalMonthly: organization.licenseCount * 50
                        };
                    }
                }

                // Get payment methods
                const paymentMethods = await stripe.paymentMethods.list({
                    customer: organization.stripeCustomerId,
                    type: 'card',
                    limit: 1
                });

                // Get recent invoices
                const invoices = await stripe.invoices.list({
                    customer: organization.stripeCustomerId,
                    limit: 10
                });

                // Add payment method data
                if (paymentMethods.data.length > 0) {
                    const pm = paymentMethods.data[0];
                    billingData.paymentMethod = {
                        type: 'card',
                        brand: pm.card.brand,
                        last4: pm.card.last4,
                        expiryMonth: pm.card.exp_month,
                        expiryYear: pm.card.exp_year
                    };
                }

                // Add invoice data
                billingData.invoices = invoices.data.map(inv => ({
                    id: inv.id,
                    date: new Date(inv.created * 1000).toISOString(),
                    amount: inv.amount_paid / 100,
                    currency: inv.currency,
                    status: inv.status,
                    invoicePdf: inv.invoice_pdf,
                    description: inv.description || `TIA Professional - Initial Purchase`
                }));

            } catch (stripeError) {
                context.log.warn('Stripe data fetch error:', stripeError);
                // Continue with basic data even if Stripe fails
            }
        }

        context.res.status = 200;
        context.res.body = billingData;
        
    } catch (error) {
        context.log.error('Error fetching billing data:', error);
        context.res.status = 500;
        context.res.body = { error: 'Internal server error' };
    }
};