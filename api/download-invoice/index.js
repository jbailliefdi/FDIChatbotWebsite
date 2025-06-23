const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function (context, req) {
    try {
        const { invoiceId } = req.body;
        
        if (!invoiceId) {
            context.res = { status: 400, body: { error: 'Invoice ID required' } };
            return;
        }

        const invoice = await stripe.invoices.retrieve(invoiceId);
        
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