const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Creating Stripe checkout session');

    if (req.method !== 'POST') {
        context.res = {
            status: 405,
            body: { error: 'Method not allowed' }
        };
        return;
    }

    try {
        const { 
            companyName, 
            firstName, 
            lastName, 
            email, 
            phone, 
            licenseCount, 
            pricePerLicense 
        } = req.body;

        // Validate input
        if (!companyName || !firstName || !lastName || !email || !licenseCount) {
            context.res = {
                status: 400,
                body: { error: 'Missing required fields' }
            };
            return;
        }

        // Check if organization already exists
        const existingOrg = await organizationsContainer.items
            .query({
                query: "SELECT * FROM c WHERE c.adminEmail = @email",
                parameters: [{ name: "@email", value: email }]
            })
            .fetchAll();

        if (existingOrg.resources.length > 0) {
            context.res = {
                status: 400,
                body: { error: 'An organization with this email already exists' }
            };
            return;
        }

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer_email: email,
            line_items: [{
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: 'FDI AI Professional',
                        description: `AI Chatbot License for ${companyName}`,
                        images: ['https://your-domain.com/logo.png'],
                    },
                    unit_amount: pricePerLicense * 100, // Stripe uses pence
                    recurring: {
                        interval: 'month',
                    },
                },
                quantity: licenseCount,
            }],
            metadata: {
                companyName,
                firstName,
                lastName,
                email,
                phone: phone || '',
                licenseCount: licenseCount.toString(),
            },
            success_url: `${process.env.DOMAIN_URL}/pricing?success=true`,
            cancel_url: `${process.env.DOMAIN_URL}/pricing?canceled=true`,
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    companyName,
                    licenseCount: licenseCount.toString(),
                }
            }
        });

        context.res = {
            status: 200,
            body: { sessionId: session.id }
        };

    } catch (error) {
        context.log.error('Stripe checkout error:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Creating Stripe checkout session');

    if (req.method !== 'POST') {
        context.res = {
            status: 405,
            body: { error: 'Method not allowed' }
        };
        return;
    }

    try {
        const { 
            companyName, 
            firstName, 
            lastName, 
            email, 
            phone, 
            licenseCount, 
            pricePerLicense 
        } = req.body;

        // Validate input
        if (!companyName || !firstName || !lastName || !email || !licenseCount) {
            context.res = {
                status: 400,
                body: { error: 'Missing required fields' }
            };
            return;
        }

        // Check if organization already exists
        const existingOrg = await organizationsContainer.items
            .query({
                query: "SELECT * FROM c WHERE c.adminEmail = @email",
                parameters: [{ name: "@email", value: email }]
            })
            .fetchAll();

        if (existingOrg.resources.length > 0) {
            context.res = {
                status: 400,
                body: { error: 'An organization with this email already exists' }
            };
            return;
        }

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer_email: email,
            line_items: [{
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: 'FDI AI Professional',
                        description: `AI Chatbot License for ${companyName}`,
                        images: ['https://your-domain.com/logo.png'],
                    },
                    unit_amount: pricePerLicense * 100, // Stripe uses pence
                    recurring: {
                        interval: 'month',
                    },
                },
                quantity: licenseCount,
            }],
            metadata: {
                companyName,
                firstName,
                lastName,
                email,
                phone: phone || '',
                licenseCount: licenseCount.toString(),
            },
            success_url: `${process.env.DOMAIN_URL}/pricing?success=true`,
            cancel_url: `${process.env.DOMAIN_URL}/pricing?canceled=true`,
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    companyName,
                    licenseCount: licenseCount.toString(),
                }
            }
        });

        context.res = {
            status: 200,
            body: { sessionId: session.id }
        };

    } catch (error) {
        context.log.error('Stripe checkout error:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};
