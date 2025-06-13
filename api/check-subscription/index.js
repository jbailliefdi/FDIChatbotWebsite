// api/check-subscription/index.js
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = {
            status: 405,
            body: { error: 'Method not allowed' }
        };
        return;
    }

    try {
        const { email } = req.body;

        if (!email) {
            context.res = {
                status: 400,
                body: { error: 'Email is required' }
            };
            return;
        }

        // Find user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            context.res = {
                status: 200,
                body: { hasAccess: false, reason: 'User not found' }
            };
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
            context.res = {
                status: 200,
                body: { hasAccess: false, reason: 'Organization not found' }
            };
            return;
        }

        const organization = organizations[0];

        // Check subscription status
        const hasValidSubscription = organization.status === 'active' || 
                                   organization.status === 'trialing';

        // Count current users in organization
        const userCountQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organization.id }]
        };

        const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
        const currentUserCount = countResult[0] || 0;

        const withinLicenseLimit = currentUserCount <= organization.licenseCount;

        context.res = {
            status: 200,
            body: {
                hasAccess: hasValidSubscription && withinLicenseLimit && user.status === 'active',
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    organizationId: user.organizationId
                },
                organization: {
                    id: organization.id,
                    name: organization.name,
                    licenseCount: organization.licenseCount,
                    currentUsers: currentUserCount,
                    status: organization.status
                }
            }
        };

    } catch (error) {
        context.log.error('Error checking subscription:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};
// api/check-subscription/index.js
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = {
            status: 405,
            body: { error: 'Method not allowed' }
        };
        return;
    }

    try {
        const { email } = req.body;

        if (!email) {
            context.res = {
                status: 400,
                body: { error: 'Email is required' }
            };
            return;
        }

        // Find user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            context.res = {
                status: 200,
                body: { hasAccess: false, reason: 'User not found' }
            };
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
            context.res = {
                status: 200,
                body: { hasAccess: false, reason: 'Organization not found' }
            };
            return;
        }

        const organization = organizations[0];

        // Check subscription status
        const hasValidSubscription = organization.status === 'active' || 
                                   organization.status === 'trialing';

        // Count current users in organization
        const userCountQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organization.id }]
        };

        const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
        const currentUserCount = countResult[0] || 0;

        const withinLicenseLimit = currentUserCount <= organization.licenseCount;

        context.res = {
            status: 200,
            body: {
                hasAccess: hasValidSubscription && withinLicenseLimit && user.status === 'active',
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    organizationId: user.organizationId
                },
                organization: {
                    id: organization.id,
                    name: organization.name,
                    licenseCount: organization.licenseCount,
                    currentUsers: currentUserCount,
                    status: organization.status
                }
            }
        };

    } catch (error) {
        context.log.error('Error checking subscription:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};
