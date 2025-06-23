const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

// Stripe webhook endpoint secret for signature verification
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

module.exports = async function (context, req) {
    context.log('Webhook received');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        let event;
        
        // Check if this is a real Stripe webhook or mock event
        const stripeSignature = req.headers['stripe-signature'];
        
        if (stripeSignature && endpointSecret) {
            // Real Stripe webhook - verify signature
            try {
                event = stripe.webhooks.constructEvent(
                    req.rawBody || JSON.stringify(req.body),
                    stripeSignature,
                    endpointSecret
                );
                context.log('Verified Stripe webhook event:', event.type);
            } catch (err) {
                context.log.error('Webhook signature verification failed:', err.message);
                context.res = { status: 400, body: { message: 'Webhook signature verification failed' } };
                return;
            }
        } else {
            // Mock event for testing (backwards compatibility)
            event = {
                type: req.body.event_type,
                data: {
                    object: req.body
                }
            };
            context.log('Processing mock event:', event.type);
        }

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(context, event.data.object);
                break;
                
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(context, event.data.object);
                break;
                
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(context, event.data.object);
                break;
                
            case 'invoice.payment_failed':
                await handlePaymentFailed(context, event.data.object);
                break;
                
            case 'invoice.payment_succeeded':
                await handlePaymentSucceeded(context, event.data.object);
                break;

            // Mock admin actions for testing (backwards compatibility)
            case 'admin.simulate_cancellation':
                await handleMockSubscriptionCancelled(context, req.body.email);
                break;
                
            case 'admin.simulate_payment_failure':
                await handleMockPaymentFailed(context, req.body.email);
                break;
                
            case 'admin.simulate_reactivation':
                await handleMockSubscriptionUpdated(context, req.body.email, 'active');
                break;

            default:
                context.log('Unhandled event type:', event.type);
        }

        context.res = {
            status: 200,
            body: { 
                received: true, 
                event_type: event.type,
                message: `Event ${event.type} processed successfully`
            }
        };

    } catch (error) {
        context.log.error('Error processing webhook:', error);
        context.res = {
            status: 500,
            body: { message: error.message || 'Internal server error' }
        };
    }
};

async function handleCheckoutCompleted(context, session) {
    try {
        context.log('Processing checkout completion for session:', session.id);

        // Get customer details from Stripe
        const customer = await stripe.customers.retrieve(session.customer);
        const email = customer.email;
        
        // Get session line items to determine license count
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
        const licenseCount = lineItems.data.reduce((total, item) => total + item.quantity, 0);

        // Extract company info from session metadata or customer metadata
        const metadata = session.metadata || {};
        const customerMetadata = customer.metadata || {};
        
        const companyName = metadata.companyName || customerMetadata.companyName || 
                          `${email.split('@')[1].split('.')[0].charAt(0).toUpperCase()}${email.split('@')[1].split('.')[0].slice(1)} Ltd`;
        const firstName = metadata.firstName || customer.name?.split(' ')[0] || email.split('@')[0];
        const lastName = metadata.lastName || customer.name?.split(' ').slice(1).join(' ') || 'User';
        const phone = metadata.phone || customer.phone || null;

        // Extract domain for organization lookup
        const domain = email.split('@')[1];
        let organizationId;
        let isNewOrganization = false;
        let userRole = 'user';

        // Check if organization already exists for this domain
        const orgDomainQuery = {
            query: "SELECT * FROM c WHERE c.adminEmail LIKE @domain",
            parameters: [
                { name: "@domain", value: `%@${domain}` }
            ]
        };

        const { resources: existingOrgs } = await organizationsContainer.items.query(orgDomainQuery).fetchAll();

        if (existingOrgs.length > 0) {
            // Organization exists
            const existingOrg = existingOrgs[0];
            organizationId = existingOrg.id;
            context.log('Using existing organization:', organizationId);
            
            // Check license limits
            const userCountQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organizationId }]
            };
            
            const { resources: userCountResult } = await usersContainer.items.query(userCountQuery).fetchAll();
            const currentUserCount = userCountResult[0] || 0;
            
            if (currentUserCount >= existingOrg.licenseCount) {
                // Update organization license count if needed
                if (licenseCount > existingOrg.licenseCount) {
                    const updatedOrg = {
                        ...existingOrg,
                        licenseCount: licenseCount,
                        stripeCustomerId: customer.id,
                        stripeSubscriptionId: session.subscription,
                        lastUpdated: new Date().toISOString()
                    };
                    await organizationsContainer.item(existingOrg.id, existingOrg.id).replace(updatedOrg);
                    context.log('Updated organization license count to:', licenseCount);
                }
            }
            
            userRole = existingOrg.adminEmail === email ? 'admin' : 'user';
        } else {
            // Create new organization
            organizationId = uuidv4();
            isNewOrganization = true;
            userRole = 'admin';

            const organization = {
                id: organizationId,
                name: companyName,
                stripeCustomerId: customer.id,
                stripeSubscriptionId: session.subscription,
                licenseCount: licenseCount,
                status: 'active',
                adminEmail: email,
                createdAt: new Date().toISOString(),
                stripeCheckoutSessionId: session.id
            };

            await organizationsContainer.items.create(organization);
            context.log('Created new organization:', organizationId, 'with', licenseCount, 'licenses');
        }

        // Handle user creation/update
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: existingUsers } = await usersContainer.items.query(userQuery).fetchAll();

        if (existingUsers.length > 0) {
            // Update existing user
            const existingUser = existingUsers[0];
            const updatedUser = {
                ...existingUser,
                organizationId: organizationId,
                role: userRole,
                status: 'active',
                firstName: firstName,
                lastName: lastName,
                phone: phone,
                stripeCustomerId: customer.id,
                lastUpdated: new Date().toISOString()
            };

            await usersContainer.item(existingUser.id, existingUser.id).replace(updatedUser);
            context.log('Updated existing user:', email);
        } else {
            // Create new user
            const userId = uuidv4();
            const newUser = {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: lastName,
                phone: phone,
                organizationId: organizationId,
                role: userRole,
                status: 'active',
                stripeCustomerId: customer.id,
                createdAt: new Date().toISOString(),
                lastLogin: null
            };

            await usersContainer.items.create(newUser);
            context.log('Created new user:', email, 'with role:', userRole);
        }

        context.log('Checkout completed successfully');

    } catch (error) {
        context.log.error('Error in handleCheckoutCompleted:', error);
        throw error;
    }
}

async function handleSubscriptionUpdated(context, subscription) {
    try {
        context.log('Processing subscription update:', subscription.id, 'status:', subscription.status);

        // Find organization by subscription ID
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.stripeSubscriptionId = @subId",
            parameters: [{ name: "@subId", value: subscription.id }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for subscription:', subscription.id);
            return;
        }

        const organization = organizations[0];

        // Update organization status based on subscription status
        let newStatus = subscription.status;
        if (subscription.status === 'past_due') {
            newStatus = 'past_due';
        } else if (subscription.status === 'canceled') {
            newStatus = 'cancelled';
        } else if (subscription.status === 'active') {
            newStatus = 'active';
        }

        const updatedOrg = {
            ...organization,
            status: newStatus,
            lastUpdated: new Date().toISOString()
        };

        // Add grace period for past due subscriptions
        if (subscription.status === 'past_due') {
            updatedOrg.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        } else {
            delete updatedOrg.gracePeriodEnd;
        }

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization status updated to:', newStatus);

    } catch (error) {
        context.log.error('Error in handleSubscriptionUpdated:', error);
        throw error;
    }
}

async function handleSubscriptionDeleted(context, subscription) {
    try {
        context.log('Processing subscription deletion:', subscription.id);

        const orgQuery = {
            query: "SELECT * FROM c WHERE c.stripeSubscriptionId = @subId",
            parameters: [{ name: "@subId", value: subscription.id }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for subscription:', subscription.id);
            return;
        }

        const organization = organizations[0];
        const updatedOrg = {
            ...organization,
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization status set to cancelled');

    } catch (error) {
        context.log.error('Error in handleSubscriptionDeleted:', error);
        throw error;
    }
}

async function handlePaymentFailed(context, invoice) {
    try {
        context.log('Processing payment failure for invoice:', invoice.id);

        if (!invoice.subscription) {
            context.log('No subscription associated with invoice');
            return;
        }

        // Find organization by subscription ID
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.stripeSubscriptionId = @subId",
            parameters: [{ name: "@subId", value: invoice.subscription }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for subscription:', invoice.subscription);
            return;
        }

        const organization = organizations[0];
        const updatedOrg = {
            ...organization,
            status: 'past_due',
            gracePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            lastUpdated: new Date().toISOString()
        };

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization status set to past_due with grace period');

    } catch (error) {
        context.log.error('Error in handlePaymentFailed:', error);
        throw error;
    }
}

async function handlePaymentSucceeded(context, invoice) {
    try {
        context.log('Processing payment success for invoice:', invoice.id);

        if (!invoice.subscription) {
            context.log('No subscription associated with invoice');
            return;
        }

        // Find organization by subscription ID
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.stripeSubscriptionId = @subId",
            parameters: [{ name: "@subId", value: invoice.subscription }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for subscription:', invoice.subscription);
            return;
        }

        const organization = organizations[0];
        const updatedOrg = {
            ...organization,
            status: 'active',
            lastUpdated: new Date().toISOString()
        };

        // Remove grace period
        delete updatedOrg.gracePeriodEnd;

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization status restored to active');

    } catch (error) {
        context.log.error('Error in handlePaymentSucceeded:', error);
        throw error;
    }
}

// Mock functions for backwards compatibility
async function handleMockSubscriptionUpdated(context, email, status = 'active') {
    try {
        context.log('Processing mock subscription update for:', email, 'status:', status);

        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.log('User not found for subscription update');
            return;
        }

        const user = users[0];
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: user.organizationId }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for subscription update');
            return;
        }

        const organization = organizations[0];
        const updatedOrg = {
            ...organization,
            status: status,
            lastUpdated: new Date().toISOString()
        };

        if (status === 'active') {
            delete updatedOrg.trialEnd;
            delete updatedOrg.gracePeriodEnd;
        }

        if (status === 'past_due') {
            updatedOrg.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        }

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization status updated to:', status);

    } catch (error) {
        context.log.error('Error in handleMockSubscriptionUpdated:', error);
        throw error;
    }
}

async function handleMockSubscriptionCancelled(context, email) {
    await handleMockSubscriptionUpdated(context, email, 'cancelled');
}

async function handleMockPaymentFailed(context, email) {
    await handleMockSubscriptionUpdated(context, email, 'past_due');
}