// api/get-checkout-session/index.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function (context, req) {
    context.log('Getting Stripe checkout session details');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            context.res = { 
                status: 400, 
                body: { message: 'Missing sessionId' } 
            };
            return;
        }

        // Retrieve the checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'customer']
        });

        // Get line items to calculate totals
        const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
        
        // Calculate license count from line items
        const licenseCount = lineItems.data.reduce((total, item) => total + item.quantity, 0);
        
        // Format amount
        const totalAmount = session.amount_total ? 
            `£${(session.amount_total / 100).toFixed(2)}/month (inc. VAT)` : 
            'Amount not available';

        // Extract customer email
        let customerEmail = null;
        if (session.customer && typeof session.customer === 'object') {
            customerEmail = session.customer.email;
        } else if (session.customer_details && session.customer_details.email) {
            customerEmail = session.customer_details.email;
        }

        // Get metadata if available
        const metadata = session.metadata || {};

        context.log('Session retrieved successfully:', {
            sessionId: session.id,
            licenseCount: licenseCount,
            totalAmount: totalAmount,
            customerEmail: customerEmail
        });

        context.res = {
            status: 200,
            body: {
                sessionId: session.id,
                licenseCount: licenseCount,
                totalAmount: totalAmount,
                customerEmail: customerEmail,
                paymentStatus: session.payment_status,
                subscriptionId: session.subscription,
                companyName: metadata.companyName,
                firstName: metadata.firstName,
                lastName: metadata.lastName
            }
        };

    } catch (error) {
        context.log.error('Error retrieving checkout session:', error);
        
        // Don't expose internal error details to client
        if (error.type === 'StripeInvalidRequestError') {
            context.res = {
                status: 400,
                body: { message: 'Invalid session ID' }
            };
        } else {
            context.res = {
                status: 500,
                body: { message: 'Unable to retrieve session details' }
            };
        }
    }
};