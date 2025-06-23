const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY
});

const database = client.database(process.env.COSMOS_DB_DATABASE_NAME);
const container = database.container(process.env.COSMOS_DB_CONTAINER_NAME);

module.exports = async function (context, req) {
    context.log('Getting organization billing data');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { error: 'Method not allowed' } };
        return;
    }

    try {
        const { organizationId, userEmail } = req.body;
        
        if (!organizationId || !userEmail) {
            context.res = { 
                status: 400, 
                body: { error: 'Organization ID and user email required' } 
            };
            return;
        }

        // Verify user has access to this organization and is admin
        const userQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @organizationId AND c.email = @userEmail",
            parameters: [
                { name: "@organizationId", value: organizationId },
                { name: "@userEmail", value: userEmail }
            ]
        };

        const { resources: users } = await container.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 403, body: { error: 'Access denied - user not found in organization' } };
            return;
        }

        const currentUser = users[0];
        
        if (currentUser.role !== 'admin') {
            context.res = { status: 403, body: { error: 'Access denied - admin privileges required' } };
            return;
        }

        if (!currentUser.stripeCustomerId) {
            context.res = { 
                status: 404, 
                body: { error: 'No billing setup found for this organization' } 
            };
            return;
        }

        const customerId = currentUser.stripeCustomerId;

        // Get customer data from Stripe
        const customer = await stripe.customers.retrieve(customerId);

        // Get default payment method
        let paymentMethod = null;
        if (customer.invoice_settings?.default_payment_method) {
            paymentMethod = await stripe.paymentMethods.retrieve(
                customer.invoice_settings.default_payment_method
            );
        } else if (customer.default_source) {
            // Handle older card sources
            const source = await stripe.customers.retrieveSource(customerId, customer.default_source);
            paymentMethod = {
                card: {
                    brand: source.brand,
                    last4: source.last4,
                    exp_month: source.exp_month,
                    exp_year: source.exp_year
                },
                billing_details: {
                    name: source.name
                }
            };
        }

        // Get active subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 1
        });

        const subscription = subscriptions.data.length > 0 ? subscriptions.data[0] : null;

        // Get recent invoices
        const invoices = await stripe.invoices.list({
            customer: customerId,
            limit: 12,
            expand: ['data.subscription']
        });

        context.res = {
            status: 200,
            body: {
                customer: {
                    id: customer.id,
                    email: customer.email,
                    name: customer.name
                },
                paymentMethod: paymentMethod,
                subscription: subscription,
                invoices: invoices.data
            }
        };

    } catch (error) {
        context.log.error('Error retrieving billing data:', error);
        
        if (error.type === 'StripeInvalidRequestError') {
            context.res = {
                status: 400,
                body: { error: 'Invalid request to billing system' }
            };
        } else if (error.code === 'NotFound') {
            context.res = {
                status: 404,
                body: { error: 'Customer not found in billing system' }
            };
        } else {
            context.res = {
                status: 500,
                body: { error: 'Unable to retrieve billing information' }
            };
        }
    }
};