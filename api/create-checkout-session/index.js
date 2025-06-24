const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Creating Stripe checkout session');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { 
            email, 
            companyName, 
            firstName, 
            lastName, 
            phone, 
            licenseCount = 1,
            pricePerLicense = 50,
            planType = 'monthly'
        } = req.body;

        if (!email || !companyName || !firstName || !lastName) {
            context.res = { 
                status: 400, 
                body: { message: 'Missing required fields: email, companyName, firstName, lastName' } 
            };
            return;
        }

        // Server-side license validation
        if (planType === 'trial') {
            if (licenseCount < 1 || licenseCount > 3) {
                context.res = { 
                    status: 400, 
                    body: { message: 'Trial plans are limited to 1-3 users only.' } 
                };
                return;
            }
        } else if (planType === 'annual' || planType === 'monthly') {
            if (licenseCount < 1 || licenseCount > 500) {
                context.res = { 
                    status: 400, 
                    body: { message: 'Professional plans are limited to 1-500 users.' } 
                };
                return;
            }
        }

        // Extract domain for organization lookup
        const domain = email.split('@')[1];

        // Check if organization already exists for this domain
        const orgDomainQuery = {
            query: "SELECT * FROM c WHERE c.adminEmail LIKE @domain",
            parameters: [
                { name: "@domain", value: `%@${domain}` }
            ]
        };

        const { resources: existingOrgs } = await organizationsContainer.items.query(orgDomainQuery).fetchAll();

        if (existingOrgs.length > 0) {
            const existingOrg = existingOrgs[0];
            
            // Check if trial has expired
            if (existingOrg.status === 'trial_expired' && planType === 'trial') {
                context.res = {
                    status: 400,
                    body: { 
                        message: 'Your organization\'s trial has already expired. Please contact your administrator or subscribe to a paid plan.',
                        organizationName: existingOrg.name,
                        adminEmail: existingOrg.adminEmail
                    }
                };
                return;
            }
            
            // Check if organization is still trialing and someone is trying to start another trial
            if ((existingOrg.status === 'trialing' || existingOrg.status === 'active') && planType === 'trial') {
                context.res = {
                    status: 400,
                    body: { 
                        message: 'Your organization already has an active account. Please contact your administrator for access.',
                        organizationName: existingOrg.name,
                        adminEmail: existingOrg.adminEmail
                    }
                };
                return;
            }
            
            // Check if user already exists
            const userQuery = {
                query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                parameters: [{ name: "@email", value: email }]
            };
            
            const { resources: existingUsers } = await usersContainer.items.query(userQuery).fetchAll();
            
            if (existingUsers.length > 0) {
                context.res = {
                    status: 400,
                    body: { 
                        message: 'You already have an account. Please sign in or contact your administrator if you need assistance.',
                        organizationName: existingOrg.name,
                        adminEmail: existingOrg.adminEmail
                    }
                };
                return;
            }
            
            // For paid plans, allow admin to upgrade/change subscription
            if (planType !== 'trial' && existingOrg.adminEmail.toLowerCase() !== email.toLowerCase()) {
                context.res = {
                    status: 400,
                    body: { 
                        message: 'Only your organization administrator can modify the subscription. Please contact your admin for assistance.',
                        organizationName: existingOrg.name,
                        adminEmail: existingOrg.adminEmail
                    }
                };
                return;
            }
        }

        // Create or retrieve customer
        let customer;
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            // Update customer with latest info
            customer = await stripe.customers.update(customer.id, {
                name: `${firstName} ${lastName}`,
                phone: phone || undefined,
                metadata: {
                    companyName: companyName,
                    licenseCount: licenseCount.toString()
                }
            });
        } else {
            customer = await stripe.customers.create({
                email: email,
                name: `${firstName} ${lastName}`,
                phone: phone || undefined,
                metadata: {
                    companyName: companyName,
                    licenseCount: licenseCount.toString()
                }
            });
        }

        // Get the base URL for redirects
        const origin = req.headers.origin || req.headers.referer || 'https://your-domain.com';
        
        // Create checkout session
        let sessionConfig = {
            customer: customer.id,
            payment_method_types: ['card'],
            allow_promotion_codes: true,
            billing_address_collection: 'required',
            tax_id_collection: {
                enabled: true
            },
            customer_update: {
                address: 'auto',
                name: 'auto'
            },
            metadata: {
                email: email,
                companyName: companyName,
                firstName: firstName,
                lastName: lastName,
                phone: phone || '',
                licenseCount: licenseCount.toString(),
                pricePerLicense: pricePerLicense.toString(),
                planType: planType
            },
            success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/pricing?payment=cancelled`,
            consent_collection: {
                terms_of_service: 'required'
            }
        };

        if (planType === 'trial') {
            // Trial setup - create subscription with trial period
            sessionConfig.mode = 'subscription';
            sessionConfig.subscription_data = {
                trial_period_days: 3,
                metadata: {
                    planType: 'trial',
                    trialUsers: licenseCount.toString()
                }
            };
            sessionConfig.line_items = [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: 'TIA Professional - Trial',
                            description: `AI Tax Assistant - 3-day trial for ${licenseCount} user${licenseCount > 1 ? 's' : ''}, then £${licenseCount * pricePerLicense}/month`,
                            metadata: {
                                licenseCount: licenseCount.toString(),
                                companyName: companyName,
                                planType: 'trial'
                            }
                        },
                        recurring: {
                            interval: 'month'
                        },
                        unit_amount: pricePerLicense * 100, // £50 per license
                        tax_behavior: 'exclusive'
                    },
                    quantity: licenseCount, // Use actual license count, not fixed 1
                }
            ];
        } else if (planType === 'annual') {
            // Annual subscription
            sessionConfig.mode = 'subscription';
            sessionConfig.line_items = [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: 'TIA Professional - Annual',
                            description: `AI Tax Assistant for ${licenseCount} user${licenseCount > 1 ? 's' : ''} - Annual billing`,
                            metadata: {
                                licenseCount: licenseCount.toString(),
                                companyName: companyName,
                                planType: 'annual'
                            }
                        },
                        recurring: {
                            interval: 'year'
                        },
                        unit_amount: 55000, // £550 per user per year
                        tax_behavior: 'exclusive'
                    },
                    quantity: licenseCount,
                }
            ];
        } else {
            // Monthly subscription
            sessionConfig.mode = 'subscription';
            sessionConfig.line_items = [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: 'TIA Professional - Monthly',
                            description: `AI Tax Assistant for ${licenseCount} user${licenseCount > 1 ? 's' : ''} - Monthly billing`,
                            metadata: {
                                licenseCount: licenseCount.toString(),
                                companyName: companyName,
                                planType: 'monthly'
                            }
                        },
                        recurring: {
                            interval: 'month'
                        },
                        unit_amount: pricePerLicense * 100,
                        tax_behavior: 'exclusive'
                    },
                    quantity: licenseCount,
                }
            ];
        }

        sessionConfig.automatic_tax = {
            enabled: true,
        };

        const session = await stripe.checkout.sessions.create(sessionConfig);

        context.log('Checkout session created:', session.id);

        context.res = {
            status: 200,
            body: {
                sessionId: session.id,
                url: session.url,
                customerId: customer.id
            }
        };

    } catch (error) {
        context.log.error('Error creating checkout session:', error);
        context.res = {
            status: 500,
            body: { 
                message: 'Failed to create checkout session',
                error: error.message 
            }
        };
    }
};