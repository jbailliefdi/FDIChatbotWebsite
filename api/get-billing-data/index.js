const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

// Use the same connection setup as your other APIs
const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot'); // Replace with your actual database name
const container = database.container('users'); // Replace with your actual container name

module.exports = async function (context, req) {
    context.log('Getting organization billing data');

    try {
        const { organizationId, userEmail } = req.body;
        
        if (!organizationId || !userEmail) {
            context.res = { 
                status: 400, 
                body: { error: 'Organization ID and user email required' } 
            };
            return;
        }

        // Query for the user - same pattern as your other APIs
        const userQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @organizationId AND c.email = @userEmail",
            parameters: [
                { name: "@organizationId", value: organizationId },
                { name: "@userEmail", value: userEmail }
            ]
        };

        const { resources: users } = await container.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 403, body: { error: 'User not found' } };
            return;
        }

        const currentUser = users[0];
        
        if (currentUser.role !== 'admin') {
            context.res = { status: 403, body: { error: 'Admin access required' } };
            return;
        }

        if (!currentUser.stripeCustomerId) {
            context.res = { 
                status: 404, 
                body: { error: 'No billing setup found' } 
            };
            return;
        }

        // Get Stripe data
        const customerId = currentUser.stripeCustomerId;
        
        const [customer, subscriptions, invoices] = await Promise.all([
            stripe.customers.retrieve(customerId),
            stripe.subscriptions.list({ customer: customerId, limit: 1 }),
            stripe.invoices.list({ customer: customerId, limit: 12 })
        ]);

        // Get payment method
        let paymentMethod = null;
        if (customer.invoice_settings?.default_payment_method) {
            paymentMethod = await stripe.paymentMethods.retrieve(
                customer.invoice_settings.default_payment_method
            );
        }

        context.res = {
            status: 200,
            body: {
                customer: {
                    id: customer.id,
                    email: customer.email,
                    name: customer.name
                },
                paymentMethod: paymentMethod,
                subscription: subscriptions.data[0] || null,
                invoices: invoices.data
            }
        };

    } catch (error) {
        context.log.error('Error:', error);
        context.res = {
            status: 500,
            body: { error: error.message }
        };
    }
};