const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    try {
        const { organizationId, userEmail } = req.body;
        
        if (!organizationId || !userEmail) {
            context.res = { 
                status: 400, 
                body: { error: 'Organization ID and user email required' } 
            };
            return;
        }

        // Use case-insensitive email search
        const userQuery = {
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@userEmail)",
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

        // Get organization
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

        // Get payment method from subscription or customer
        let paymentMethod = null;
        if (customer.invoice_settings?.default_payment_method) {
            paymentMethod = await stripe.paymentMethods.retrieve(
                customer.invoice_settings.default_payment_method
            );
        } else if (subscriptions.data[0]?.default_payment_method) {
            // Check subscription's payment method
            paymentMethod = await stripe.paymentMethods.retrieve(
                subscriptions.data[0].default_payment_method
            );
        } else if (customer.default_source) {
            // Fallback to older card sources
            const source = await stripe.customers.retrieveSource(customerId, customer.default_source);
            paymentMethod = {
                card: {
                    brand: source.brand,
                    last4: source.last4,
                    exp_month: source.exp_month,
                    exp_year: source.exp_year
                },
                billing_details: { name: source.name }
            };
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
            body: { error: 'Service temporarily unavailable' }
        };
    }
};