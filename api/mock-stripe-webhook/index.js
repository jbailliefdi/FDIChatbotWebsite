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
                await handleMockCheckoutCompleted(context, req);
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
            body: { message: error.message || 'Internal server error' }
        };
    }
};

async function handleMockCheckoutCompleted(context, req) {
    try {
        const { email, user_data } = req.body;
        context.log('Processing mock checkout completion for:', email, 'with data:', user_data);

        // Extract company name from email domain or use provided company name
        const domain = email.split('@')[1];
        const defaultCompanyName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
        const companyName = user_data?.companyName || `${defaultCompanyName} Ltd`;

        let organizationId;
        let isNewOrganization = false;
        let userRole = 'user'; // Default role for new users

        // Check if organization already exists for this domain
        const orgDomainQuery = {
            query: "SELECT * FROM c WHERE c.adminEmail LIKE @domain",
            parameters: [
                { name: "@domain", value: `%@${domain}` }
            ]
        };

        const { resources: existingOrgs } = await organizationsContainer.items.query(orgDomainQuery).fetchAll();

        if (existingOrgs.length > 0) {
            // Organization exists - use existing one
            const existingOrg = existingOrgs[0];
            organizationId = existingOrg.id;
            context.log('Using existing organization:', organizationId);
            
            // Check license limits before adding user
            const userCountQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organizationId }]
            };
            
            const { resources: userCountResult } = await usersContainer.items.query(userCountQuery).fetchAll();
            const currentUserCount = userCountResult[0] || 0;
            
            if (currentUserCount >= existingOrg.licenseCount) {
                context.log(`License limit reached. Current users: ${currentUserCount}, License limit: ${existingOrg.licenseCount}`);
                throw new Error(`License limit reached. Your organization has ${existingOrg.licenseCount} licenses and ${currentUserCount} active users. Please upgrade your plan to add more users.`);
            }
            
            // Check if this email is already the admin email
            if (existingOrg.adminEmail === email) {
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

            const licenseCount = user_data?.licenseCount || 5; // Use provided license count or default to 5

            const organization = {
                id: organizationId,
                name: companyName,
                subscriptionId: `mock-sub-${Date.now()}`,
                licenseCount: licenseCount,
                status: 'trialing', // Start with trial
                adminEmail: email,
                createdAt: new Date().toISOString(),
                trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                mockSubscription: true
            };

            await organizationsContainer.items.create(organization);
            context.log('Created new organization:', organizationId, 'with', licenseCount, 'licenses');
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
                // Update name if provided in user_data
                firstName: user_data?.firstName || existingUser.firstName,
                lastName: user_data?.lastName || existingUser.lastName,
                phone: user_data?.phone || existingUser.phone,
                lastUpdated: new Date().toISOString()
            };

            await usersContainer.item(existingUser.id, existingUser.id).replace(updatedUser);
            context.log('Updated existing user:', email);
        } else {
            // Create new user with proper form data
            const userId = uuidv4();
            const firstName = user_data?.firstName || email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
            const lastName = user_data?.lastName || 'User';
            
            const newUser = {
                id: userId,
                email: email,
                firstName: firstName,
                lastName: lastName,
                phone: user_data?.phone || null,
                organizationId: organizationId,
                role: userRole,
                status: 'active',
                createdAt: new Date().toISOString(),
                lastLogin: null,
                mockUser: true
            };

            await usersContainer.items.create(newUser);
            context.log('Created new user:', email, 'with role:', userRole, 'Name:', firstName, lastName);
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

// Additional helper functions for license management

async function getOrganizationUsage(context, organizationId) {
    try {
        // Get organization details
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: organizationId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            throw new Error('Organization not found');
        }
        
        const organization = organizations[0];
        
        // Count active users
        const userCountQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organizationId }]
        };
        
        const { resources: userCountResult } = await usersContainer.items.query(userCountQuery).fetchAll();
        const activeUsers = userCountResult[0] || 0;
        
        // Get all users for the organization
        const usersQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt",
            parameters: [{ name: "@orgId", value: organizationId }]
        };
        
        const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();
        
        return {
            organization: organization,
            licenseCount: organization.licenseCount,
            activeUsers: activeUsers,
            availableLicenses: organization.licenseCount - activeUsers,
            users: users,
            usage: {
                percentage: Math.round((activeUsers / organization.licenseCount) * 100),
                remaining: organization.licenseCount - activeUsers
            }
        };
    } catch (error) {
        context.log.error('Error getting organization usage:', error);
        throw error;
    }
}

async function upgradeOrganizationLicenses(context, organizationId, newLicenseCount) {
    try {
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: organizationId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            throw new Error('Organization not found');
        }
        
        const organization = organizations[0];
        
        if (newLicenseCount < organization.licenseCount) {
            // Check if downgrade is possible (no more active users than new license count)
            const userCountQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organizationId }]
            };
            
            const { resources: userCountResult } = await usersContainer.items.query(userCountQuery).fetchAll();
            const activeUsers = userCountResult[0] || 0;
            
            if (activeUsers > newLicenseCount) {
                throw new Error(`Cannot downgrade to ${newLicenseCount} licenses. You have ${activeUsers} active users. Please deactivate users first.`);
            }
        }
        
        // Update organization
        const updatedOrg = {
            ...organization,
            licenseCount: newLicenseCount,
            lastUpdated: new Date().toISOString()
        };
        
        await organizationsContainer.item(organization.id, organization.id).replace(updatedOrg);
        
        context.log(`Organization ${organizationId} license count updated to ${newLicenseCount}`);
        
        return updatedOrg;
    } catch (error) {
        context.log.error('Error upgrading organization licenses:', error);
        throw error;
    }
}

async function deactivateUser(context, userId, organizationId) {
    try {
        // Get user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
            parameters: [
                { name: "@userId", value: userId },
                { name: "@orgId", value: organizationId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('User not found or not in organization');
        }
        
        const user = users[0];
        
        if (user.role === 'admin') {
            // Check if this is the only admin
            const adminQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organizationId }]
            };
            
            const { resources: adminCountResult } = await usersContainer.items.query(adminQuery).fetchAll();
            const adminCount = adminCountResult[0] || 0;
            
            if (adminCount <= 1) {
                throw new Error('Cannot deactivate the only admin user. Please assign another admin first.');
            }
        }
        
        // Deactivate user
        const updatedUser = {
            ...user,
            status: 'deactivated',
            deactivatedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        await usersContainer.item(user.id, user.id).replace(updatedUser);
        
        context.log(`User ${userId} deactivated, license freed up`);
        
        return updatedUser;
    } catch (error) {
        context.log.error('Error deactivating user:', error);
        throw error;
    }
}

async function reactivateUser(context, userId, organizationId) {
    try {
        // Check license availability first
        const usage = await getOrganizationUsage(context, organizationId);
        
        if (usage.availableLicenses <= 0) {
            throw new Error(`No available licenses. Your organization has ${usage.licenseCount} licenses and ${usage.activeUsers} active users.`);
        }
        
        // Get user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
            parameters: [
                { name: "@userId", value: userId },
                { name: "@orgId", value: organizationId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('User not found or not in organization');
        }
        
        const user = users[0];
        
        // Reactivate user
        const updatedUser = {
            ...user,
            status: 'active',
            reactivatedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        // Remove deactivatedAt if it exists
        delete updatedUser.deactivatedAt;
        
        await usersContainer.item(user.id, user.id).replace(updatedUser);
        
        context.log(`User ${userId} reactivated`);
        
        return updatedUser;
    } catch (error) {
        context.log.error('Error reactivating user:', error);
        throw error;
    }
}