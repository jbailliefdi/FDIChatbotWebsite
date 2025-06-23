const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY
});

const database = client.database(process.env.COSMOS_DB_DATABASE_NAME);
const container = database.container(process.env.COSMOS_DB_CONTAINER_NAME);

module.exports = async function (context, req) {
    context.log('Creating Stripe billing portal session');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { error: 'Method not allowed' } };
        return;
    }

    try {
        const { customerId, returnUrl, userEmail, organizationId } = req.body;

        if (!customerId || !userEmail || !organizationId) {
            context.res = { 
                status: 400, 
                body: { error: 'Customer ID, user email, and organization ID required' } 
            };
            return;
        }

        // Verify user has access to this customer
        const userQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @organizationId AND c.email = @userEmail AND c.stripeCustomerId = @customerId",
            parameters: [
                { name: "@organizationId", value: organizationId },
                { name: "@userEmail", value: userEmail },
                { name: "@customerId", value: customerId }
            ]
        };

        const { resources: users } = await container.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 403, body: { error: 'Access denied - unauthorized billing access' } };
            return;
        }

        const currentUser = users[0];
        
        if (currentUser.role !== 'admin') {
            context.res = { status: 403, body: { error: 'Access denied - admin privileges required' } };
            return;
        }

        // Verify customer exists in Stripe
        const customer = await stripe.customers.retrieve(customerId);
        
        // Create billing portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || 'https://kind-mud-048fffa03.6.azurestaticapps.net/dashboard.html',
        });

        context.res = {
            status: 200,
            body: {
                url: session.url
            }
        };

    } catch (error) {
        context.log.error('Error creating billing portal session:', error);
        
        if (error.type === 'StripeInvalidRequestError') {
            context.res = {
                status: 400,
                body: { error: 'Invalid customer or request' }
            };
        } else {
            context.res = {
                status: 500,
                body: { error: 'Unable to create billing portal session' }
            };
        }
    }
};
