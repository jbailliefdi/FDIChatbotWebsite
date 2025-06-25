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
                await handleInvoicePaymentSucceeded(context, event.data.object);
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

        const { metadata } = session;
        
        // Check if this is a license upgrade
        if (metadata && metadata.type === 'license_upgrade') {
            await processLicenseUpgrade(context, metadata, session);
        } else {
            // Handle regular subscription creation (your existing logic)
            await handleRegularCheckout(context, session);
        }

    } catch (error) {
        context.log.error('Error in handleCheckoutCompleted:', error);
        throw error;
    }
}

async function processLicenseUpgrade(context, metadata, session) {
    const { organizationId, newLicenseCount, stripeSubscriptionId, currentLicenseCount, billingInterval } = metadata;
    
    try {
        context.log(`Processing license upgrade for org ${organizationId}: ${currentLicenseCount} -> ${newLicenseCount} (${billingInterval || 'monthly'} billing)`);

        // Update the subscription quantity immediately (since payment was successful)
        if (stripeSubscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            const subscriptionItem = subscription.items.data[0];
            
            // For annual billing, we need to be more careful about proration
            const prorationBehavior = billingInterval === 'year' ? 'create_prorations' : 'create_prorations';
            
            await stripe.subscriptions.update(stripeSubscriptionId, {
                items: [{
                    id: subscriptionItem.id,
                    quantity: parseInt(newLicenseCount)
                }],
                proration_behavior: prorationBehavior
            });

            context.log('Stripe subscription quantity updated to:', newLicenseCount);
        }

        // Update organization record
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (organization) {
            const updatedOrg = {
                ...organization,
                licenseCount: parseInt(newLicenseCount),
                status: 'active',
                lastUpgradeDate: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                // Clear any pending downgrade since we just upgraded
                pendingDowngrade: false,
                pendingLicenseCount: null,
                downgradeScheduledAt: null,
                downgradeScheduledBy: null
            };

            await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);
            context.log(`License count updated to ${newLicenseCount} for organization ${organizationId}`);
        }

    } catch (error) {
        context.log.error('Error processing license upgrade:', error);
        throw error;
    }
}
async function handleInvoicePaymentSucceeded(context, invoice) {
    try {
        context.log('Processing invoice payment success:', invoice.id);

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
        
        // Check if there's a pending downgrade to apply
        if (organization.pendingDowngrade && organization.pendingLicenseCount) {
            // Get current subscription to check if this is the billing cycle where downgrade should apply
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
            const newQuantity = subscription.items.data[0]?.quantity;
            
            if (newQuantity && newQuantity !== organization.licenseCount) {
                // Apply the downgrade
                const updatedOrg = {
                    ...organization,
                    licenseCount: newQuantity,
                    status: 'active',
                    pendingDowngrade: false,
                    pendingLicenseCount: null,
                    downgradeScheduledAt: null,
                    downgradeScheduledBy: null,
                    lastDowngradeDate: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };

                await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
                context.log(`Applied pending downgrade: ${organization.licenseCount} -> ${newQuantity} licenses`);
            }
        } else {
            // Regular payment success - just update status
            const updatedOrg = {
                ...organization,
                status: 'active',
                lastPaymentDate: new Date(invoice.created * 1000).toISOString(),
                lastUpdated: new Date().toISOString()
            };

            await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        }

    } catch (error) {
        context.log.error('Error in handleInvoicePaymentSucceeded:', error);
        throw error;
    }
}

async function handleRegularCheckout(context, session) {
    // Your existing checkout logic for new subscriptions
    // Retrieve the full subscription object to check for trial status
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const isTrial = subscription.status === 'trialing';
    const orgStatus = isTrial ? 'trialing' : 'active';
    context.log(`Subscription ${subscription.id} status is ${subscription.status}. Org status will be set to ${orgStatus}.`);

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
            status: orgStatus,
            adminEmail: email,
            createdAt: new Date().toISOString(),
            stripeCheckoutSessionId: session.id
        };
        
        if (isTrial && subscription.trial_end) {
            organization.trialEndDate = new Date(subscription.trial_end * 1000).toISOString();
            context.log(`Setting trial end date: ${organization.trialEndDate}`);
        }
        await organizationsContainer.items.create(organization);
        context.log('Created new organization:', organizationId, 'with status:', orgStatus, 'and', licenseCount, 'licenses');
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

    context.log('Regular checkout completed successfully');
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

        // Check if this update includes a quantity change (downgrade applied)
        const newQuantity = subscription.items.data[0]?.quantity;
        const currentLicenseCount = organization.licenseCount;

        let newStatus = subscription.status;
        if (subscription.status === 'past_due') {
            newStatus = 'past_due';
        } else if (subscription.status === 'canceled') {
            newStatus = 'cancelled';
        } else if (subscription.status === 'active') {
            newStatus = 'active';
        } else if (subscription.status === 'trialing') {
            newStatus = 'trialing';
        }

        const updatedOrg = {
            ...organization,
            status: newStatus,
            lastUpdated: new Date().toISOString()
        };

        // If quantity changed and there was a pending downgrade, apply it
        if (newQuantity && newQuantity !== currentLicenseCount && organization.pendingDowngrade) {
            updatedOrg.licenseCount = newQuantity;
            updatedOrg.pendingDowngrade = false;
            updatedOrg.pendingLicenseCount = null;
            updatedOrg.downgradeScheduledAt = null;
            updatedOrg.downgradeScheduledBy = null;
            updatedOrg.lastDowngradeDate = new Date().toISOString();
            
            context.log(`Applied pending downgrade: ${currentLicenseCount} -> ${newQuantity} licenses`);
        } else if (newQuantity && newQuantity !== currentLicenseCount) {
            // Quantity changed but no pending downgrade recorded (direct Stripe change)
            updatedOrg.licenseCount = newQuantity;
            context.log(`License count updated directly: ${currentLicenseCount} -> ${newQuantity} licenses`);
        }

        // Add grace period for past due subscriptions
        if (subscription.status === 'past_due') {
            updatedOrg.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        } else {
            delete updatedOrg.gracePeriodEnd;
        }

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        context.log('Organization updated with status:', newStatus, 'and license count:', updatedOrg.licenseCount);

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