const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Mock Stripe webhook received');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { event_type, email, action } = req.body;
        
        context.log('Processing mock event:', event_type, 'for email:', email);

        switch (event_type) {
            case 'checkout.session.completed':
                await handleMockCheckoutCompleted(context, email);
                break;
                
            case 'customer.subscription.updated':
                await handleMockSubscriptionUpdated(context, email, req.body.status);
                break;
                
            case 'customer.subscription.deleted':
                await handleMockSubscriptionCancelled(context, email);
                break;
                
            case 'invoice.payment_failed':
                await handleMockPaymentFailed(context, email);
                break;
                
            case 'invoice.payment_succeeded':
                await handleMockPaymentSucceeded(context, email);
                break;

            // Admin actions for testing
            case 'admin.simulate_cancellation':
                await handleMockSubscriptionCancelled(context, email);
                break;
                
            case 'admin.simulate_payment_failure':
                await handleMockPaymentFailed(context, email);
                break;
                
            case 'admin.simulate_reactivation':
                await handleMockSubscriptionUpdated(context, email, 'active');
                break;

            default:
                context.log('Unknown event type:', event_type);
        }

        context.res = {
            status: 200,
            body: { 
                received: true, 
                event_type: event_type,
                message: `Mock ${event_type} processed successfully`
            }
        };

    } catch (error) {
        context.log.error('Error processing mock webhook:', error);
        context.res = {
            status: 500,
            body: { message: 'Internal server error' }
        };
    }
};

async function handleMockCheckoutCompleted(context, email) {
    try {
        context.log('Processing mock checkout completion for:', email);

        // Extract company name from email domain
        const domain = email.split('@')[1];
        const companyName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);

        let organizationId;
        let isNewOrganization = false;
        let userRole = 'user'; // Default role for new users

        // Check if organization already exists for this domain
        const orgDomainQuery = {
            query: "SELECT * FROM c WHERE c.adminEmail LIKE @domain OR c.name = @companyName",
            parameters: [
                { name: "@domain", value: `%@${domain}` },
                { name: "@companyName", value: `${companyName} Ltd` }
            ]
        };

        const { resources: existingOrgs } = await organizationsContainer.items.query(orgDomainQuery).fetchAll();

        if (existingOrgs.length > 0) {
            // Organization exists - use existing one
            organizationId = existingOrgs[0].id;
            context.log('Using existing organization:', organizationId);
            
            // Check if this email is already the admin email
            if (existingOrgs[0].adminEmail === email) {
                userRole = 'admin';
                context.log('User is existing admin, maintaining admin role');
            } else {
                userRole = 'user';
                context.log('Adding user to existing organization as regular user');
            }
        } else {
            // No organization exists - create new one
            organizationId = uuidv4();
            isNewOrganization = true;
            userRole = 'admin'; // First user becomes admin

            const organization = {
                id: organizationId,
                name: `${companyName} Ltd`,
                subscriptionId: `mock-sub-${Date.now()}`,
                licenseCount: 5, // Default to 5 licenses
                status: 'trialing', // Start with trial
                adminEmail: email,
                createdAt: new Date().toISOString(),
                trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                mockSubscription: true
            };

            await organizationsContainer.items.create(organization);
            context.log('Created new organization:', organizationId);
        }

        // Check if user already exists
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: existingUsers } = await usersContainer.items.query(userQuery).fetchAll();

        if (existingUsers.length > 0) {
            // User already exists - update their information
            const existingUser = existingUsers[0];
            const updatedUser = {
                ...existingUser,
                organizationId: organizationId,
                role: userRole,
                status: 'active',
                lastUpdated: new Date().toISOString()
            };

            await usersContainer.item(existingUser.id, existingUser.id).replace(updatedUser);
            context.log('Updated existing user:', email);
        } else {
            // Create new user
            const userId = uuidv4();
            const firstName = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
            const newUser = {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: 'User',
                organizationId: organizationId,
                role: userRole,
                status: 'active',
                createdAt: new Date().toISOString(),
                lastLogin: null,
                mockUser: true
            };

            await usersContainer.items.create(newUser);
            context.log('Created new user:', email, 'with role:', userRole);
        }

        context.log('Checkout completed successfully - Organization:', organizationId, 'User role:', userRole);

    } catch (error) {
        context.log.error('Error in handleMockCheckoutCompleted:', error);
        throw error;
    }
}

async function handleMockSubscriptionUpdated(context, email, status = 'active') {
    try {
        context.log('Processing mock subscription update for:', email, 'status:', status);

        // Find user
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

        // Find organization
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

        // Update organization status
        const updatedOrg = {
            ...organization,
            status: status,
            lastUpdated: new Date().toISOString()
        };

        // Remove trial end if subscription becomes active
        if (status === 'active') {
            delete updatedOrg.trialEnd;
        }

        // Add grace period if payment failed
        if (status === 'past_due') {
            updatedOrg.gracePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
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

async function handleMockPaymentSucceeded(context, email) {
    try {
        context.log('Processing mock payment success for:', email);

        // Find user and organization
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) return;

        const user = users[0];
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: user.organizationId }]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) return;

        const organization = organizations[0];

        // Update to active and remove grace periods
        const updatedOrg = {
            ...organization,
            status: 'active',
            lastUpdated: new Date().toISOString()
        };

        // Remove trial and grace period fields
        delete updatedOrg.trialEnd;
        delete updatedOrg.gracePeriodEnd;

        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);

        context.log('Payment succeeded - subscription reactivated');

    } catch (error) {
        context.log.error('Error in handleMockPaymentSucceeded:', error);
        throw error;
    }
}