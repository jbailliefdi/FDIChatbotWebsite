const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY
});

const database = client.database(process.env.COSMOS_DB_DATABASE_NAME);
const container = database.container(process.env.COSMOS_DB_CONTAINER_NAME);

module.exports = async function (context, req) {
    context.log('Downloading invoice');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { error: 'Method not allowed' } };
        return;
    }

    try {
        const { invoiceId, userEmail, organizationId } = req.body;
        
        if (!invoiceId || !userEmail || !organizationId) {
            context.res = { 
                status: 400, 
                body: { error: 'Invoice ID, user email, and organization ID required' } 
            };
            return;
        }

        // Get user and verify access
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
            context.res = { status: 404, body: { error: 'No billing setup found' } };
            return;
        }

        // Get invoice from Stripe and verify it belongs to this customer
        const invoice = await stripe.invoices.retrieve(invoiceId);
        
        if (invoice.customer !== currentUser.stripeCustomerId) {
            context.res = { status: 403, body: { error: 'Access denied - invoice does not belong to your organization' } };
            return;
        }
        
        if (!invoice.invoice_pdf) {
            context.res = { 
                status: 404, 
                body: { error: 'Invoice PDF not available' } 
            };
            return;
        }

        // Return the PDF URL for download
        context.res = {
            status: 200,
            body: {
                downloadUrl: invoice.invoice_pdf,
                filename: `invoice-${invoiceId}.pdf`
            }
        };

    } catch (error) {
        context.log.error('Error accessing invoice:', error);
        
        if (error.type === 'StripeInvalidRequestError') {
            context.res = {
                status: 404,
                body: { error: 'Invoice not found' }
            };
        } else {
            context.res = {
                status: 500,
                body: { error: 'Unable to access invoice' }
            };
        }
    }
};