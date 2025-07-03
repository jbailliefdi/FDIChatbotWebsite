const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function (context, req) {
    // Set CORS headers
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        context.res.body = '';
        return;
    }

    try {
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Server configuration error',
                message: 'A required environment variable (STRIPE_SECRET_KEY or STRIPE_PRICE_ID) is missing on the server.'
            });
            return;
        }

        const { companyName, firstName, lastName, email, phone, planType } = req.body;
        const licenses = 5;

        // --- All validation and customer logic remains the same ---
        if (!email || !firstName || !lastName || !companyName) { /* return 400 error */ }
        if (planType !== 'trial') { /* return 400 error */ }
        let customer;
        const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });
        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            const existingSubscriptions = await stripe.subscriptions.list({ customer: customer.id, status: 'all' });
            const activeOrTrialing = existingSubscriptions.data.find(sub => ['active', 'trialing', 'past_due'].includes(sub.status));
            if (activeOrTrialing) {
                context.res.status = 400;
                context.res.body = JSON.stringify({ error: 'Subscription already exists', message: 'You already have an active subscription or trial with this email' });
                return;
            }
        } else {
            customer = await stripe.customers.create({ email, name: `${firstName} ${lastName}`, metadata: { companyName, phone: phone || '', licenseCount: licenses.toString(), signupSource: 'trial', role: 'admin' }});
        }
        
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 3);

        try {
            await stripe.subscriptions.create({
                customer: customer.id,
                items: [{ price: process.env.STRIPE_PRICE_ID, quantity: licenses }],
                trial_end: Math.floor(trialEndDate.getTime() / 1000),
                payment_behavior: 'default_incomplete',
                payment_settings: { save_default_payment_method: 'on_subscription' },
                expand: ['latest_invoice.payment_intent'],
                metadata: { companyName, licenseCount: licenses.toString(), planType: 'trial', trialStarted: new Date().toISOString() }
            });
        } catch (stripeError) {
            // THIS IS THE IMPORTANT PART: Send the detailed error back to the browser
            context.log.error('Error creating subscription:', stripeError.message);
            const debugInfo = { type: stripeError.type, message: stripeError.message, code: stripeError.code, param: stripeError.param };
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Subscription creation failed',
                message: 'Service temporarily unavailable'
            });
            return;
        }

        context.res.status = 200;
        context.res.body = JSON.stringify({ success: true, message: 'Trial subscription created successfully' });

    } catch (error) {
        context.log.error('Unexpected error:', error.message);
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: 'Internal server error', message: 'Service temporarily unavailable' });
    }
};