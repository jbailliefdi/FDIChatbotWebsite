const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    try {
        const { customerId, returnUrl, userEmail, organizationId } = req.body;

        if (!customerId || !userEmail || !organizationId) {
            context.res = { 
                status: 400, 
                body: { error: 'Customer ID, user email, and organization ID required' } 
            };
            return;
        }

        // Verify user is admin in the organization
        const userQuery = {
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@userEmail)",
            parameters: [
                { name: "@userEmail", value: userEmail }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery, {
            partitionKey: organizationId
        }).fetchAll();
        
        if (users.length === 0 || users[0].role !== 'admin') {
            context.res = { status: 403, body: { error: 'Access denied' } };
            return;
        }

        // Verify the customer ID belongs to this organization
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization || organization.stripeCustomerId !== customerId) {
            context.res = { status: 403, body: { error: 'Unauthorized billing access' } };
            return;
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || 'https://kind-mud-048fffa03.6.azurestaticapps.net/dashboard.html',
        });

        context.res = {
            status: 200,
            body: { url: session.url }
        };

    } catch (error) {
        context.log.error('Error:', error);
        context.res = {
            status: 500,
            body: { error: error.message }
        };
    }
};