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

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        context.res.body = '';
        return;
    }

    try {
        // Validate environment variables
        if (!process.env.STRIPE_SECRET_KEY) {
            context.log.error('STRIPE_SECRET_KEY environment variable is not set');
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Server configuration error',
                message: 'Payment system not configured'
            });
            return;
        }

        if (!process.env.STRIPE_PRICE_ID) {
            context.log.error('STRIPE_PRICE_ID environment variable is not set');
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Server configuration error',
                message: 'Product pricing not configured'
            });
            return;
        }

        const {
            companyName,
            firstName,
            lastName,
            email,
            phone,
            licenseCount,
            planType
        } = req.body;

        context.log('Received trial subscription request:', {
            email,
            companyName,
            licenseCount,
            planType
        });

        // Validate required fields
        if (!email || !firstName || !lastName || !companyName) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Missing required fields',
                message: 'Please fill in all required fields'
            });
            return;
        }

        if (planType !== 'trial') {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Invalid plan type',
                message: 'This endpoint only handles trial subscriptions'
            });
            return;
        }

        const licenses = parseInt(licenseCount) || 1;
        if (licenses < 1 || licenses > 100) {
            context.res.status = 400;
            context.res.body = JSON.stringify({
                error: 'Invalid license count',
                message: 'License count must be between 1 and 100'
            });
            return;
        }

        // Check if customer already exists
        let existingCustomers;
        try {
            existingCustomers = await stripe.customers.list({
                email: email,
                limit: 1
            });
        } catch (stripeError) {
            context.log.error('Error checking existing customers:', stripeError);
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Payment system error',
                message: 'Unable to process subscription at this time'
            });
            return;
        }

        let customer;
        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            context.log('Found existing customer:', customer.id);
            
            // Check if they already have an active subscription or trial
            try {
                const existingSubscriptions = await stripe.subscriptions.list({
                    customer: customer.id,
                    status: 'all',
                    limit: 10
                });

                const activeOrTrialing = existingSubscriptions.data.find(sub => 
                    ['active', 'trialing', 'past_due'].includes(sub.status)
                );

                if (activeOrTrialing) {
                    context.res.status = 400;
                    context.res.body = JSON.stringify({
                        error: 'Subscription already exists',
                        message: 'You already have an active subscription or trial'
                    });
                    return;
                }
            } catch (stripeError) {
                context.log.error('Error checking existing subscriptions:', stripeError);
                // Continue anyway - we'll let Stripe handle duplicates
            }
        } else {
            // Create new customer
            try {
                customer = await stripe.customers.create({
                    email: email,
                    name: `${firstName} ${lastName}`,
                    metadata: {
                        companyName: companyName,
                        phone: phone || '',
                        licenseCount: licenses.toString(),
                        signupSource: 'trial'
                    }
                });
                context.log('Created new customer:', customer.id);
            } catch (stripeError) {
                context.log.error('Error creating customer:', stripeError);
                context.res.status = 500;
                context.res.body = JSON.stringify({
                    error: 'Customer creation failed',
                    message: 'Unable to create customer account'
                });
                return;
            }
        }

        // Create the trial subscription
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 3); // 3 days from now

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
                payment_settings: {
                    save_default_payment_method: 'on_subscription'
                },
                expand: ['latest_invoice.payment_intent'],
                metadata: {
                    companyName: companyName,
                    licenseCount: licenses.toString(),
                    planType: 'trial',
                    trialStarted: new Date().toISOString()
                }
            });
            context.log('Created trial subscription:', subscription.id);
        } catch (stripeError) {
            context.log.error('Error creating subscription:', stripeError);
            context.res.status = 500;
            context.res.body = JSON.stringify({
                error: 'Subscription creation failed',
                message: 'Unable to create trial subscription'
            });
            return;
        }

        // Log successful trial creation
        context.log('Trial subscription created successfully', {
            customerId: customer.id,
            subscriptionId: subscription.id,
            email: email,
            companyName: companyName,
            licenseCount: licenses,
            trialEndDate: trialEndDate.toISOString()
        });

        // Send success response
        context.res.status = 200;
        context.res.body = JSON.stringify({
            success: true,
            customerId: customer.id,
            subscriptionId: subscription.id,
            trialEndDate: trialEndDate.toISOString(),
            message: 'Trial subscription created successfully'
        });

    } catch (error) {
        context.log.error('Unexpected error in trial subscription creation:', error);
        context.res.status = 500;
        context.res.body = JSON.stringify({
            error: 'Internal server error',
            message: 'An unexpected error occurred. Please try again.'
        });
    }
};