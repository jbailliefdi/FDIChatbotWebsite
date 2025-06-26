const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

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
        // SECURITY: Check Azure Static Web Apps authentication FIRST
        const clientPrincipal = req.headers['x-ms-client-principal'];
        if (!clientPrincipal) {
            context.res = {
                status: 401,
                body: { error: 'Authentication required' }
            };
            return;
        }

        // Parse authenticated user info
        const authenticatedUser = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString());
        if (!authenticatedUser || !authenticatedUser.userDetails) {
            context.res = {
                status: 401,
                body: { error: 'Invalid authentication' }
            };
            return;
        }

        const authenticatedEmail = authenticatedUser.userDetails;
        const { action, adminEmail, userEmail, userData } = req.body;

        // SECURITY: Verify the authenticated user matches the claimed admin email
        if (authenticatedEmail !== adminEmail) {
            context.res = {
                status: 403,
                body: { error: 'Email mismatch - you can only perform admin actions as yourself' }
            };
            return;
        }

        // Verify admin permissions in database (now that we know the user is authenticated)
        const adminQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.role = 'admin'",
            parameters: [{ name: "@email", value: adminEmail }]
        };

        const { resources: admins } = await usersContainer.items.query(adminQuery).fetchAll();

        if (admins.length === 0) {
            context.res = {
                status: 403,
                body: { error: 'Admin privileges required' }
            };
            return;
        }

        const admin = admins[0];

        switch (action) {
            case 'add':
                await addUser(admin.organizationId, userData);
                break;
            case 'remove':
                await removeUser(admin.organizationId, userEmail);
                break;
            case 'list':
                const users = await listUsers(admin.organizationId);
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
        context.log.error('Error managing users:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
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
        lastLogin: null
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
        await usersContainer.item(user.id, user.id).patch([
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
