const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Organization overview request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    // Get orgId from query parameter since Azure Static Web Apps doesn't support route params
    const orgId = req.query.orgId;
    
    if (!orgId) {
        context.res.status = 400;
        context.res.body = { error: 'Organization ID required as query parameter' };
        return;
    }

    try {
        // Get organization details
        const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
        
        if (!organization) {
            context.res.status = 404;
            context.res.body = { error: 'Organization not found' };
            return;
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

        // Prepare organization data with pending changes info
        const orgData = {
            id: organization.id,
            name: organization.name,
            status: organization.status || 'active',
            licenseCount: totalLicenses,
            trialEndDate: organization.trialEndDate,
            stripeCustomerId: organization.stripeCustomerId,
            stripeSubscriptionId: organization.stripeSubscriptionId,
            createdAt: organization.createdAt,
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