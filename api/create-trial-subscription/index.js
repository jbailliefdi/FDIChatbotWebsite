const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function (context, req) {
    // Set CORS headers
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.SITE_DOMAIN || 'https://kind-mud-048fffa03.6.azurestaticapps.net',
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
            context.log.error('Missing required environment variables: STRIPE_SECRET_KEY or STRIPE_PRICE_ID');
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Server configuration error',
                message: 'Service temporarily unavailable. Please try again later.'
            });
            return;
        }

        const { companyName, firstName, lastName, email, phone, planType } = req.body;
        const licenses = 5;

        // SECURITY: Input validation
        if (!email || !firstName || !lastName || !companyName) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'All required fields (email, firstName, lastName, companyName) must be provided.'
            });
            return;
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'Please provide a valid email address.'
            });
            return;
        }

        // Name length validation
        if (firstName.length > 50 || lastName.length > 50) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'First name and last name must be 50 characters or less.'
            });
            return;
        }

        // Company name validation
        if (companyName.length > 100) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'Company name must be 100 characters or less.'
            });
            return;
        }

        // Phone validation (if provided)
        if (phone && phone.length > 20) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'Phone number must be 20 characters or less.'
            });
            return;
        }

        if (planType !== 'trial') {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Validation error',
                message: 'Invalid plan type. Only trial subscriptions are supported by this endpoint.'
            });
            return;
        }
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
            // SECURITY: Log detailed error server-side but send generic message to client
            context.log.error('Error creating subscription:', {
                type: stripeError.type,
                message: stripeError.message,
                code: stripeError.code,
                param: stripeError.param,
                stack: stripeError.stack
            });
            
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Subscription creation failed',
                message: 'Unable to create trial subscription. Please try again or contact support.'
            });
            return;
        }

        context.res.status = 200;
        context.res.body = JSON.stringify({ success: true, message: 'Trial subscription created successfully' });

    } catch (error) {
        // SECURITY: Log detailed error server-side but send generic message to client
        context.log.error('Unexpected error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        context.res.status = 500;
        context.res.body = JSON.stringify({ 
            error: 'Internal server error',
            message: 'An unexpected error occurred. Please try again or contact support.'
        });
    }
};