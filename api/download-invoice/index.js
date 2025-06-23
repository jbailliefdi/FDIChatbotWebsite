const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    try {
        const { invoiceId, userEmail, organizationId } = req.body;
        
        if (!invoiceId || !userEmail || !organizationId) {
            context.res = { status: 400, body: { error: 'Invoice ID, user email, and organization ID required' } };
            return;
        }

        // Verify user is admin
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @userEmail",
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

        // Get organization's Stripe customer ID
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization) {
            context.res = { status: 404, body: { error: 'Organization not found' } };
            return;
        }

        // Get invoice and verify it belongs to this organization
        const invoice = await stripe.invoices.retrieve(invoiceId);
        
        if (invoice.customer !== organization.stripeCustomerId) {
            context.res = { status: 403, body: { error: 'Invoice does not belong to your organization' } };
            return;
        }
        
        if (!invoice.invoice_pdf) {
            context.res = { status: 404, body: { error: 'PDF not available' } };
            return;
        }

        context.res = {
            status: 200,
            body: {
                downloadUrl: invoice.invoice_pdf,
                filename: `invoice-${invoiceId}.pdf`
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