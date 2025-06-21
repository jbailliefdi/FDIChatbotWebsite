const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Admin users API called');

    try {
        // Verify admin authentication
        const adminUser = await verifyAdminAccess(context, req);
        if (!adminUser) {
            context.res = { status: 401, body: { message: 'Unauthorized' } };
            return;
        }

        switch (req.method) {
            case 'GET':
                await handleGetUsers(context, req);
                break;
            case 'POST':
                await handleCreateUser(context, req, adminUser);
                break;
            case 'PUT':
                await handleUpdateUser(context, req, adminUser);
                break;
            case 'DELETE':
                await handleDeleteUser(context, req, adminUser);
                break;
            default:
                context.res = { status: 405, body: { message: 'Method not allowed' } };
        }

    } catch (error) {
        context.log.error('Error in admin users API:', error);
        context.res = { status: 500, body: { message: 'Internal server error' } };
    }
};

async function verifyAdminAccess(context, req) {
    try {
        const email = req.headers['x-user-email'] || req.body?.adminEmail;
        
        if (!email) {
            context.log('No email provided for admin verification');
            return null;
        }

        // Check if user exists and has admin role
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.status = 'active'",
            parameters: [{ name: "@email", value: email.toLowerCase() }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.log('User not found:', email);
            return null;
        }

        const user = users[0];

        // Check if user has admin role OR is a system admin
        if (user.role !== 'admin' && !user.systemAdmin) {
            context.log('User is not an admin:', email);
            return null;
        }

        return user;

    } catch (error) {
        context.log.error('Error verifying admin access:', error);
        return null;
    }
}

async function handleGetUsers(context, req) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const organizationId = req.query.organizationId || '';

        // Build query
        let queryParts = ["SELECT * FROM c"];
        let parameters = [];
        let whereConditions = [];

        if (search) {
            whereConditions.push("(CONTAINS(LOWER(c.email), @search) OR CONTAINS(LOWER(c.firstName), @search) OR CONTAINS(LOWER(c.lastName), @search))");
            parameters.push({ name: "@search", value: search.toLowerCase() });
        }

        if (status) {
            whereConditions.push("c.status = @status");
            parameters.push({ name: "@status", value: status });
        }

        if (organizationId) {
            whereConditions.push("c.organizationId = @organizationId");
            parameters.push({ name: "@organizationId", value: organizationId });
        }

        if (whereConditions.length > 0) {
            queryParts.push("WHERE " + whereConditions.join(" AND "));
        }

        queryParts.push("ORDER BY c.createdAt DESC");

        const query = {
            query: queryParts.join(" "),
            parameters: parameters
        };

        const { resources: users } = await usersContainer.items.query(query).fetchAll();

        // Get organization details for each user
        const usersWithOrgs = await Promise.all(users.map(async (user) => {
            try {
                const { resource: org } = await organizationsContainer.item(user.organizationId, user.organizationId).read();
                return {
                    ...user,
                    organization: org ? {
                        id: org.id,
                        name: org.name,
                        status: org.status,
                        licenseCount: org.licenseCount,
                        subscriptionId: org.subscriptionId
                    } : null
                };
            } catch (error) {
                context.log.warn('Could not fetch organization for user:', user.email);
                return { ...user, organization: null };
            }
        }));

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedUsers = usersWithOrgs.slice(startIndex, endIndex);

        // Get total count for pagination
        const totalCount = users.length;
        const totalPages = Math.ceil(totalCount / limit);

        context.res = {
            status: 200,
            body: {
                users: paginatedUsers,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            }
        };

    } catch (error) {
        context.log.error('Error getting users:', error);
        throw error;
    }
}

async function handleCreateUser(context, req, adminUser) {
    try {
        const { email, firstName, lastName, organizationId, role = 'user' } = req.body;

        if (!email || !firstName || !lastName || !organizationId) {
            context.res = { status: 400, body: { message: 'Missing required fields' } };
            return;
        }

        // Check if user already exists
        const existingUserQuery = {
            query: "SELECT * FROM c WHERE c.email = @email",
            parameters: [{ name: "@email", value: email.toLowerCase() }]
        };

        const { resources: existingUsers } = await usersContainer.items.query(existingUserQuery).fetchAll();
        
        if (existingUsers.length > 0) {
            context.res = { status: 400, body: { message: 'User with this email already exists' } };
            return;
        }

        // Verify organization exists and admin has access
        const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!organization) {
            context.res = { status: 404, body: { message: 'Organization not found' } };
            return;
        }

        // Check license limits
        const userCountQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organizationId }]
        };

        const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
        const currentUserCount = countResult[0] || 0;

        if (currentUserCount >= organization.licenseCount) {
            context.res = { 
                status: 400, 
                body: { message: `License limit reached. Organization has ${organization.licenseCount} licenses and ${currentUserCount} active users.` }
            };
            return;
        }

        // Create new user
        const newUser = {
            id: require('uuid').v4(),
            email: email.toLowerCase(),
            firstName,
            lastName,
            organizationId,
            role,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            invitedBy: adminUser.email,
            mockUser: false
        };

        await usersContainer.items.create(newUser);

        context.res = {
            status: 201,
            body: { message: 'User created successfully', user: newUser }
        };

    } catch (error) {
        context.log.error('Error creating user:', error);
        throw error;
    }
}

async function handleUpdateUser(context, req, adminUser) {
    try {
        const { userId } = req.query;
        const updates = req.body;

        if (!userId) {
            context.res = { status: 400, body: { message: 'User ID is required' } };
            return;
        }

        // Get existing user
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 404, body: { message: 'User not found' } };
            return;
        }

        const existingUser = users[0];

        // Update user
        const updatedUser = {
            ...existingUser,
            ...updates,
            lastUpdated: new Date().toISOString(),
            updatedBy: adminUser.email
        };

        // Remove fields that shouldn't be updated
        delete updatedUser.id;
        delete updatedUser.createdAt;

        await usersContainer.item(existingUser.id, existingUser.email).replace(updatedUser);

        context.res = {
            status: 200,
            body: { message: 'User updated successfully', user: updatedUser }
        };

    } catch (error) {
        context.log.error('Error updating user:', error);
        throw error;
    }
}

async function handleDeleteUser(context, req, adminUser) {
    try {
        const { userId } = req.query;

        if (!userId) {
            context.res = { status: 400, body: { message: 'User ID is required' } };
            return;
        }

        // Get user to delete
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            context.res = { status: 404, body: { message: 'User not found' } };
            return;
        }

        const userToDelete = users[0];

        // Soft delete by updating status
        const updatedUser = {
            ...userToDelete,
            status: 'deleted',
            deletedAt: new Date().toISOString(),
            deletedBy: adminUser.email
        };

        await usersContainer.item(userToDelete.id, userToDelete.email).replace(updatedUser);

        context.res = {
            status: 200,
            body: { message: 'User deleted successfully' }
        };

    } catch (error) {
        context.log.error('Error deleting user:', error);
        throw error;
    }
}