const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');
const { validateAdminAccess } = require('../utils/auth');

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
        const { action, organizationId, userEmail, userData } = req.body;

        // Validate authentication token and admin access
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            context.res = { status: 401, body: { error: 'Authorization header required' } };
            return;
        }

        const { user: adminUser } = await validateAdminAccess(authHeader, organizationId, usersContainer);

        switch (action) {
            case 'add':
                await addUser(adminUser.organizationId, userData);
                break;
            case 'remove':
                await removeUser(adminUser.organizationId, userEmail);
                break;
            case 'list':
                const users = await listUsers(adminUser.organizationId);
                context.res = {
                    status: 200,
                    body: { users }
                };
                return;
            default:
                context.res = {
                    status: 400,
                    body: { error: 'Invalid action' }
                };
                return;
        }

        context.res = {
            status: 200,
            body: { success: true }
        };

    } catch (error) {
        context.log.error('Error managing users:', error.message);
        if (error.message.includes('Access denied') || error.message.includes('Invalid token')) {
            context.res = { status: 403, body: { error: 'Access denied' } };
        } else {
            context.res = { status: 500, body: { error: 'Service temporarily unavailable' } };
        }
    }
};

async function addUser(organizationId, userData) {
    // Check license limit
    const orgQuery = {
        query: "SELECT * FROM c WHERE c.id = @orgId",
        parameters: [{ name: "@orgId", value: organizationId }]
    };

    const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
    const organization = organizations[0];

    const userCountQuery = {
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
        parameters: [{ name: "@orgId", value: organizationId }]
    };

    const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
    const currentUserCount = countResult[0] || 0;

    if (currentUserCount >= organization.licenseCount) {
        throw new Error('License limit exceeded');
    }

    // Create new user
    const userId = uuidv4();
    const newUser = {
        id: userId,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        organizationId: organizationId,
        role: 'user',
        status: 'active',
        createdAt: new Date().toISOString(),
        lastLogin: null,
        questionsAsked: 0,
        questionsResetDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    };

    await usersContainer.items.create(newUser);

    // TODO: Send invitation email
}

async function removeUser(organizationId, userEmail) {
    const userQuery = {
        query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId",
        parameters: [
            { name: "@email", value: userEmail },
            { name: "@orgId", value: organizationId }
        ]
    };

    const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

    if (users.length > 0) {
        const user = users[0];
        await usersContainer.item(user.id, user.organizationId).patch([
            { op: 'replace', path: '/status', value: 'inactive' }
        ]);
    }
}

async function listUsers(organizationId) {
    const userQuery = {
        query: "SELECT * FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
        parameters: [{ name: "@orgId", value: organizationId }]
    };

    const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
    
    return users.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
    }));
}
