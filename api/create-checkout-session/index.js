const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
            pricePerLicense = 50 
        } = req.body;

        if (!email || !companyName || !firstName || !lastName) {
            context.res = { 
                status: 400, 
                body: { message: 'Missing required fields: email, companyName, firstName, lastName' } 
            };
            return;
        }

        const subtotal = licenseCount * pricePerLicense * 100; // Convert to pence for Stripe
        const vatAmount = Math.round(subtotal * 0.20); // 20% VAT
        const totalAmount = subtotal + vatAmount;

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
        const session = await stripe.checkout.sessions.create({
            customer: customer.id,
            payment_method_types: ['card'],
            mode: 'subscription',
            allow_promotion_codes: true,
            billing_address_collection: 'required',
            tax_id_collection: {
                enabled: true
            },
            line_items: [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: 'TIA Professional',
                            description: `AI Tax Assistant for ${licenseCount} user${licenseCount > 1 ? 's' : ''}`,
                            metadata: {
                                licenseCount: licenseCount.toString(),
                                companyName: companyName
                            }
                        },
                        recurring: {
                            interval: 'month'
                        },
                        unit_amount: pricePerLicense * 100, // £50 per license in pence
                        tax_behavior: 'exclusive'
                    },
                    quantity: licenseCount,
                }
            ],
            automatic_tax: {
                enabled: true,
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
                pricePerLicense: pricePerLicense.toString()
            },
            success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/pricing?payment=cancelled`,
            consent_collection: {
                terms_of_service: 'required'
            }
        });

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