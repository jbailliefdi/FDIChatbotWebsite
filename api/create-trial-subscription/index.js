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
        // --- 1. Validate environment variables first ---
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
            context.log.error("SERVER CONFIGURATION ERROR: STRIPE_SECRET_KEY or STRIPE_PRICE_ID is not set.");
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Server configuration error',
                message: 'A required environment variable (STRIPE_SECRET_KEY or STRIPE_PRICE_ID) is missing on the server.'
            });
            return;
        }

        const { companyName, firstName, lastName, email, phone, planType } = req.body;
        const licenses = 5;

        // --- 2. Validate user input ---
        if (!email || !firstName || !lastName || !companyName) {
            context.res.status = 400;
            context.res.body = JSON.stringify({ error: 'Missing required fields', message: 'Please fill in all required fields' });
            return;
        }
        if (planType !== 'trial') {
            context.res.status = 400;
            context.res.body = JSON.stringify({ error: 'Invalid plan type', message: 'This endpoint only handles trial subscriptions' });
            return;
        }

        // --- 3. Check for existing customer in Stripe ---
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
            // --- 4. Create new customer if they don't exist ---
            customer = await stripe.customers.create({
                email: email,
                name: `${firstName} ${lastName}`,
                metadata: { companyName: companyName, phone: phone || '', licenseCount: licenses.toString(), signupSource: 'trial', role: 'admin' }
            });
        }

        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 3);

        // --- 5. Attempt to create the subscription (THIS IS WHERE THE ERROR LIKELY IS) ---
        let subscription;
        try {
            subscription = await stripe.subscriptions.create({
                customer: customer.id,
                items: [{
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: licenses
                }],
                trial_end: Math.floor(trialEndDate.getTime() / 1000),
                payment_behavior: 'default_incomplete',
                payment_settings: { save_default_payment_method: 'on_subscription' },
                expand: ['latest_invoice.payment_intent'],
                metadata: { companyName: companyName, licenseCount: licenses.toString(), planType: 'trial', trialStarted: new Date().toISOString() }
            });
        } catch (stripeError) {
            // ===================================================================
            // THIS IS THE IMPORTANT DEBUGGING CHANGE
            // We are now sending the detailed error back to the browser
            // ===================================================================
            context.log.error('Error creating subscription:', stripeError);
            
            const debugInfo = {
                type: stripeError.type,
                message: stripeError.message,
                code: stripeError.code,
                param: stripeError.param
            };

            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Subscription creation failed',
                message: 'Unable to create trial subscription. See debug info.',
                debugInfo: debugInfo // This object will tell us exactly what Stripe is complaining about.
            });
            return;
        }

        // --- 6. If everything succeeds, send the success response ---
        context.res.status = 200;
        context.res.body = JSON.stringify({
            success: true,
            customerId: customer.id,
            subscriptionId: subscription.id,
            trialEndDate: trialEndDate.toISOString(),
            message: 'Trial subscription created successfully'
        });

    } catch (error) {
        // Catch any other unexpected errors (e.g., if `stripe.customers.list` fails)
        context.log.error('Unexpected error in trial subscription creation:', error);
        context.res.status = 500;
        context.res.body = JSON.stringify({
            error: 'Internal server error',
            message: 'An unexpected error occurred. See debug info.',
            debugInfo: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });
    }
};