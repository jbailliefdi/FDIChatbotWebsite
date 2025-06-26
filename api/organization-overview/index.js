const { CosmosClient } = require('@azure/cosmos');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Organization overview request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': process.env.SITE_DOMAIN || 'https://kind-mud-048fffa03.6.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-principal'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    if (req.method !== 'GET') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    // SECURITY: Check Azure Static Web Apps authentication
    const clientPrincipal = req.headers['x-ms-client-principal'];
    if (!clientPrincipal) {
        context.res.status = 401;
        context.res.body = { error: 'Authentication required' };
        return;
    }

    let authenticatedUser;
    try {
        authenticatedUser = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString());
        if (!authenticatedUser || !authenticatedUser.userDetails) {
            context.res.status = 401;
            context.res.body = { error: 'Invalid authentication' };
            return;
        }
    } catch (error) {
        context.res.status = 401;
        context.res.body = { error: 'Invalid authentication token' };
        return;
    }

    const authenticatedEmail = authenticatedUser.userDetails;

    // Get orgId from query parameter
    const orgId = req.query.orgId;
    
    if (!orgId) {
        context.res.status = 400;
        context.res.body = { error: 'Organization ID required as query parameter' };
        return;
    }

    // Input validation for organization ID
    if (typeof orgId !== 'string' || orgId.trim().length === 0 || orgId.length > 100) {
        context.res.status = 400;
        context.res.body = { error: 'Invalid organization ID format' };
        return;
    }

    try {
        // SECURITY: Verify user belongs to the requested organization
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId AND c.status = 'active'",
            parameters: [
                { name: "@email", value: authenticatedEmail.toLowerCase() },
                { name: "@orgId", value: orgId }
            ]
        };

        const { resources: userAccess } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (userAccess.length === 0) {
            context.res.status = 403;
            context.res.body = { error: 'Access denied. You do not have permission to view this organization.' };
            return;
        }

        // Get organization details
        const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
        
        if (!organization) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
        }

        // 🔧 FIXED: Get billing interval from Stripe if not already stored
        let billingInterval = organization.billingInterval || 'month'; // Default to monthly

        if (organization.stripeSubscriptionId) {
            try {
                const subscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
                if (subscription && subscription.items.data.length > 0) {
                    const priceData = subscription.items.data[0].price;
                    billingInterval = priceData.recurring.interval; // 'month' or 'year'
                    
                    // Update organization record if billing interval wasn't stored
                    if (!organization.billingInterval) {
                        const updatedOrg = {
                            ...organization,
                            billingInterval: billingInterval,
                            lastModified: new Date().toISOString()
                        };
                        await organizationsContainer.item(orgId, orgId).replace(updatedOrg);
                        context.log(`Updated organization ${orgId} with billing interval: ${billingInterval}`);
                    }
                }
            } catch (stripeError) {
                context.log.warn('Could not retrieve billing interval from Stripe:', stripeError.message);
                // Continue with default billing interval
            }
        }

        // Get organization users
        const { resources: users } = await usersContainer.items
            .query({
                query: "SELECT * FROM c WHERE c.organizationId = @orgId",
                parameters: [{ name: "@orgId", value: orgId }]
            })
            .fetchAll();

        // Calculate license usage
        const totalLicenses = organization.licenseCount || 1;
        const activeUsers = users.filter(user => user.status === 'active').length;
        const availableLicenses = Math.max(0, totalLicenses - activeUsers);
        const usagePercentage = totalLicenses > 0 ? Math.round((activeUsers / totalLicenses) * 100) : 0;

        // Prepare organization data with pending changes info and billing interval
        const orgData = {
            id: organization.id,
            name: organization.name,
            status: organization.status || 'active',
            licenseCount: totalLicenses,
            trialEndDate: organization.trialEndDate,
            stripeCustomerId: organization.stripeCustomerId,
            stripeSubscriptionId: organization.stripeSubscriptionId,
            createdAt: organization.createdAt,
            // 🔧 FIXED: Include billing interval information
            billingInterval: billingInterval,
            // Include pending downgrade information
            pendingDowngrade: organization.pendingDowngrade || false,
            pendingLicenseCount: organization.pendingLicenseCount,
            downgradeScheduledAt: organization.downgradeScheduledAt,
            downgradeScheduledBy: organization.downgradeScheduledBy
        };

        // Prepare usage data
        const usage = {
            used: activeUsers,
            total: totalLicenses,
            available: availableLicenses,
            percentage: usagePercentage
        };

        // Format users data
        const formattedUsers = users.map(user => ({
            id: user.id,
            email: user.email,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            role: user.role || 'user',
            status: user.status || 'active',
            createdAt: user.createdAt || new Date().toISOString(),
            lastLoginDate: user.lastLoginDate
        }));

        context.res.status = 200;
        context.res.body = {
            organization: orgData,
            users: formattedUsers,
            usage: usage
        };

    } catch (error) {
        context.log.error('Error fetching organization overview:', error);
        context.res.status = 500;
        context.res.body = { error: 'Internal server error' };
    }
};