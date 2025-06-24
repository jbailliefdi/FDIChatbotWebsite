// api/get-checkout-session/index.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Getting Stripe checkout session details');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            context.res = { 
                status: 400, 
                body: { message: 'Missing sessionId' } 
            };
            return;
        }

        // Retrieve the checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'customer']
        });

        // Get line items to calculate totals
        const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
        
        // Calculate license count from line items
        const licenseCount = lineItems.data.reduce((total, item) => total + item.quantity, 0);
        
        // Format amount
        // Determine billing period based on plan type
const planType = metadata.planType || 'monthly';
const billingPeriod = planType === 'annual' ? '/year' : '/month';

const totalAmount = session.amount_total ? 
    `£${(session.amount_total / 100).toFixed(2)}${billingPeriod} (inc. VAT)` : 
    'Amount not available';

        // Extract customer email
        let customerEmail = null;
        if (session.customer && typeof session.customer === 'object') {
            customerEmail = session.customer.email;
        } else if (session.customer_details && session.customer_details.email) {
            customerEmail = session.customer_details.email;
        }

        // Get metadata if available
        const metadata = session.metadata || {};

        context.log('Session retrieved successfully:', {
            sessionId: session.id,
            licenseCount: licenseCount,
            totalAmount: totalAmount,
            customerEmail: customerEmail
        });

        context.res = {
            status: 200,
            body: {
                sessionId: session.id,
                licenseCount: licenseCount,
                totalAmount: totalAmount,
                customerEmail: customerEmail,
                customerId: session.customer.id || session.customer,
                paymentStatus: session.payment_status,
                subscriptionId: session.subscription,
                companyName: metadata.companyName,
                firstName: metadata.firstName,
                lastName: metadata.lastName,
                planType: metadata.planType,
                trialEndDate: null
            }
        };

        // Get organizationId from user record
        let organizationId = null;
        if (customerEmail) {
            try {
                const userQuery = {
                    query: "SELECT c.organizationId FROM c WHERE LOWER(c.email) = LOWER(@email)",
                    parameters: [{ name: "@email", value: customerEmail }]
                };
                const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
                if (users.length > 0) {
                    organizationId = users[0].organizationId;
                    context.res.body.organizationId = organizationId;
                }
            } catch (dbError) {
                context.log.warn('Could not retrieve organizationId:', dbError);
            }
        }

        // If this is a trial, get the trial end date from the subscription
        if (session.subscription && metadata.planType === 'trial') {
            try {
                const subscription = await stripe.subscriptions.retrieve(session.subscription);
                if (subscription.trial_end) {
                    context.res.body.trialEndDate = new Date(subscription.trial_end * 1000).toISOString();
                }
            } catch (subError) {
                context.log.warn('Could not retrieve subscription trial info:', subError);
            }
        }

    } catch (error) {
        context.log.error('Error retrieving checkout session:', error);
        
        // Don't expose internal error details to client
        if (error.type === 'StripeInvalidRequestError') {
            context.res = {
                status: 400,
                body: { message: 'Invalid session ID' }
            };
        } else {
            context.res = {
                status: 500,
                body: { message: 'Unable to retrieve session details' }
            };
        }
    }
};