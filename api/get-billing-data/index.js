const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

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

        // First, verify the user exists and is admin
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @userEmail",
            parameters: [
                { name: "@userEmail", value: userEmail }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery, {
            partitionKey: organizationId
        }).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 403, body: { error: 'User not found in organization' } };
            return;
        }

        const currentUser = users[0];
        
        if (currentUser.role !== 'admin') {
            context.res = { status: 403, body: { error: 'Admin access required' } };
            return;
        }

        // Now get the organization to find the Stripe customer ID
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization) {
            context.res = { status: 404, body: { error: 'Organization not found' } };
            return;
        }
        
        if (!organization.stripeCustomerId) {
            context.res = { 
                status: 404, 
                body: { error: 'No billing setup found for this organization' } 
            };
            return;
        }

        // Get Stripe data
        const customerId = organization.stripeCustomerId;
        
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
