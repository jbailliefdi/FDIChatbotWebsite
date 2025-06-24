const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createTrialSubscription(req, res) {
    try {
        const {
            companyName,
            firstName,
            lastName,
            email,
            phone,
            licenseCount,
            planType
        } = req.body;

        // Validate required fields
        if (!email || !firstName || !lastName || !companyName || planType !== 'trial') {
            return res.status(400).json({
                error: 'Missing required fields or invalid plan type'
            });
        }

        // Check if customer already exists
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        let customer;
        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            
            // Check if they already have an active subscription or trial
            const existingSubscriptions = await stripe.subscriptions.list({
                customer: customer.id,
                status: 'all',
                limit: 10
            });

            const activeOrTrialing = existingSubscriptions.data.find(sub => 
                ['active', 'trialing', 'past_due'].includes(sub.status)
            );

            if (activeOrTrialing) {
                return res.status(400).json({
                    error: 'Customer already has an active subscription or trial'
                });
            }
        } else {
            // Create new customer
            customer = await stripe.customers.create({
                email: email,
                name: `${firstName} ${lastName}`,
                metadata: {
                    companyName: companyName,
                    phone: phone || '',
                    licenseCount: licenseCount.toString(),
                    signupSource: 'trial'
                }
            });
        }

        // Create the trial subscription
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 3); // 3 days from now

        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{
                price: process.env.STRIPE_PRICE_ID, // Your TIA Professional price ID
                quantity: licenseCount
            }],
            trial_end: Math.floor(trialEndDate.getTime() / 1000),
            payment_behavior: 'default_incomplete',
            payment_settings: {
                save_default_payment_method: 'on_subscription'
            },
            expand: ['latest_invoice.payment_intent'],
            metadata: {
                companyName: companyName,
                licenseCount: licenseCount.toString(),
                planType: 'trial',
                trialStarted: new Date().toISOString()
            }
        });

        // Create organization and user records in your database
        await createTrialOrganizationAndUser({
            customerId: customer.id,
            subscriptionId: subscription.id,
            companyName,
            firstName,
            lastName,
            email,
            phone,
            licenseCount,
            trialEndDate
        });

        // Send welcome email (optional)
        await sendTrialWelcomeEmail({
            email,
            firstName,
            companyName,
            trialEndDate,
            licenseCount
        });

        res.json({
            success: true,
            customerId: customer.id,
            subscriptionId: subscription.id,
            trialEndDate: trialEndDate.toISOString(),
            message: 'Trial subscription created successfully'
        });

    } catch (error) {
        console.error('Error creating trial subscription:', error);
        res.status(500).json({
            error: 'Failed to create trial subscription',
            details: error.message
        });
    }
}

// Helper function to create organization and user records
async function createTrialOrganizationAndUser({
    customerId,
    subscriptionId,
    companyName,
    firstName,
    lastName,
    email,
    phone,
    licenseCount,
    trialEndDate
}) {
    // This should integrate with your existing database operations
    // Example structure:
    
    const organizationId = `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const organization = {
        id: organizationId,
        name: companyName,
        status: 'trialing',
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        totalLicenses: licenseCount,
        usedLicenses: 1, // Admin user
        trialEndDate: trialEndDate,
        createdAt: new Date(),
        planType: 'trial'
    };

    const user = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        organizationId: organizationId,
        email: email,
        firstName: firstName,
        lastName: lastName,
        phone: phone || null,
        role: 'admin',
        status: 'active',
        createdAt: new Date(),
        isTrialUser: true
    };

    // Save to your database
    // await saveOrganization(organization);
    // await saveUser(user);
    
    console.log('Created trial organization:', organization);
    console.log('Created trial user:', user);
    
    return { organization, user };
}

// Helper function to send welcome email
async function sendTrialWelcomeEmail({
    email,
    firstName,
    companyName,
    trialEndDate,
    licenseCount
}) {
    try {
        // Integrate with your email service (SendGrid, AWS SES, etc.)
        const emailContent = {
            to: email,
            subject: 'Welcome to Your TIA 3-Day Free Trial!',
            html: `
                <h2>Welcome to TIA, ${firstName}!</h2>
                <p>Your 3-day free trial has started for ${companyName}.</p>
                <p><strong>Trial Details:</strong></p>
                <ul>
                    <li>Trial ends: ${trialEndDate.toLocaleDateString()}</li>
                    <li>License count: ${licenseCount} user${licenseCount > 1 ? 's' : ''}</li>
                    <li>Full access to all TIA features</li>
                </ul>
                <p><a href="${process.env.APP_URL}/app">Start using TIA now</a></p>
                <p>Questions? Reply to this email or contact support at hello@fdintelligence.co.uk</p>
            `
        };
        
        // await sendEmail(emailContent);
        console.log('Trial welcome email queued for:', email);
        
    } catch (error) {
        console.error('Error sending trial welcome email:', error);
        // Don't fail the whole process if email fails
    }
}

module.exports = {
    createTrialSubscription
};