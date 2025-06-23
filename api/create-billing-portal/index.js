const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function (context, req) {
    try {
        const { customerId, returnUrl } = req.body;

        if (!customerId) {
            context.res = { status: 400, body: { error: 'Customer ID required' } };
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