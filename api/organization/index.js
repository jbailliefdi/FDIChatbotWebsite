// organization/index.js - Handle individual organization operations

const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    context.log('Organization API request received');

    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    // Extract orgId and action from URL
    const orgId = context.bindingData.orgId;
    let action = context.bindingData.action;

    // Extract action from URL if not provided by binding
    if (!action) {
        const segments = req.url.split('/').filter(s => s.length > 0);
        const orgIndex = segments.findIndex(s => s === orgId);
        if (orgIndex !== -1 && orgIndex + 1 < segments.length) {
            action = segments[orgIndex + 1];
        }
    }

    context.log('Organization ID:', orgId);
    context.log('Final action determined:', action);
    context.log('URL Path:', req.url);

    if (!orgId) {
        context.res.status = 400;
        context.res.body = { error: 'Organization ID is required' };
        return;
    }

    try {
        // Route to appropriate handler based on action
        switch (action) {
            case 'overview':
                await handleOverview(context, req, orgId);
                break;
            case 'billing':
                await handleBilling(context, req, orgId);
                break;
            case 'invite':
                await handleInvite(context, req, orgId);
                break;
            case 'users':
                await handleUsers(context, req, orgId);
                break;
            default:
                context.res.status = 404;
                context.res.body = { 
                    error: 'Endpoint not found',
                    debug: {
                        method: req.method,
                        orgId: orgId,
                        action: action,
                        segments: req.url.split('/').filter(s => s.length > 0)
                    }
                };
        }
    } catch (error) {
        context.log.error('Error in organization API:', error);
        context.res.status = 500;
        context.res.body = { error: error.message || 'Internal server error' };
    }
};

// Handle GET /organization/{orgId}/overview
async function handleOverview(context, req, orgId) {
    if (req.method !== 'GET') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    // Get organization
    const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
    
    if (!organization) {
        context.res.status = 404;
        context.res.body = { error: 'Organization not found' };
        return;
    }

    // Get all users for this organization
    const usersQuery = {
        query: "SELECT * FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt DESC",
        parameters: [{ name: "@orgId", value: orgId }]
    };
    
    const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();

    // Calculate usage
    const activeUsers = users.filter(u => u.status === 'active').length;
    const totalLicenses = organization.licenseCount || 1;
    const availableLicenses = Math.max(0, totalLicenses - activeUsers);
    const usagePercentage = Math.min(100, (activeUsers / totalLicenses) * 100);

    const usage = {
        used: activeUsers,
        total: totalLicenses,
        available: availableLicenses,
        percentage: usagePercentage
    };

    context.res.status = 200;
    context.res.body = {
        organization,
        users,
        usage
    };
}

// Handle GET /organization/{orgId}/billing
async function handleBilling(context, req, orgId) {
    if (req.method !== 'GET') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    // Get organization
    const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
    
    if (!organization) {
        context.res.status = 404;
        context.res.body = { error: 'Organization not found' };
        return;
    }

    // For now, return basic billing info based on organization data
    // You can extend this to integrate with Stripe API later
    const monthlyAmount = (organization.licenseCount || 1) * 50;
    
    const billingData = {
        subscription: {
            status: organization.status,
            stripeCustomerId: organization.stripeCustomerId,
            stripeSubscriptionId: organization.stripeSubscriptionId,
            licenseCount: organization.licenseCount,
            monthlyAmount: monthlyAmount
        },
        paymentMethod: {
            // Placeholder - integrate with Stripe to get real payment method
            type: 'card',
            last4: '****',
            brand: 'visa'
        },
        nextBilling: {
            date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
            amount: monthlyAmount
        },
        invoices: [
            // Placeholder - integrate with Stripe to get real invoices
            {
                id: 'inv_sample',
                date: new Date().toISOString(),
                description: `TIA Professional - ${organization.licenseCount} licenses`,
                amount: monthlyAmount,
                status: 'paid'
            }
        ]
    };

    context.res.status = 200;
    context.res.body = billingData;
}

// Handle POST /organization/{orgId}/invite
async function handleInvite(context, req, orgId) {
    if (req.method !== 'POST') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    const { firstName, lastName, email, role = 'user' } = req.body;

    if (!firstName || !lastName || !email) {
        context.res.status = 400;
        context.res.body = { error: 'First name, last name, and email are required' };
        return;
    }

    // Check if organization exists
    const { resource: organization } = await organizationsContainer.item(orgId, orgId).read();
    if (!organization) {
        context.res.status = 404;
        context.res.body = { error: 'Organization not found' };
        return;
    }

    // Check if user already exists
    const existingUserQuery = {
        query: "SELECT * FROM c WHERE c.email = @email",
        parameters: [{ name: "@email", value: email.toLowerCase() }]
    };
    
    const { resources: existingUsers } = await usersContainer.items.query(existingUserQuery).fetchAll();
    
    if (existingUsers.length > 0) {
        context.res.status = 400;
        context.res.body = { error: 'User with this email already exists' };
        return;
    }

    // Check license availability
    const activeUsersQuery = {
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
        parameters: [{ name: "@orgId", value: orgId }]
    };
    
    const { resources: [activeUserCount] } = await usersContainer.items.query(activeUsersQuery).fetchAll();
    
    if (activeUserCount >= organization.licenseCount) {
        context.res.status = 400;
        context.res.body = { error: 'No available licenses. Please upgrade your plan.' };
        return;
    }

    // Create new user
    const newUser = {
        id: require('crypto').randomUUID(),
        email: email.toLowerCase(),
        firstName,
        lastName,
        organizationId: orgId,
        role,
        status: 'active', // You might want to set to 'invited' and handle email verification
        createdAt: new Date().toISOString(),
        lastLogin: null
    };

    await usersContainer.items.create(newUser);

    // TODO: Send invitation email here

    context.res.status = 201;
    context.res.body = { 
        message: 'User invited successfully',
        user: {
            id: newUser.id,
            email: newUser.email,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            role: newUser.role,
            status: newUser.status
        }
    };
}

// Handle user management operations  
async function handleUsers(context, req, orgId) {
    // For user operations, the URL will be: /api/organization/{orgId}/users/{userId}
    // We need to extract userId from the URL path after 'users'
    const urlPath = req.url;
    const userIdMatch = urlPath.match(/\/users\/([^\/\?]+)/);
    const userId = userIdMatch ? userIdMatch[1] : null;
    
    if (!userId) {
        context.res.status = 400;
        context.res.body = { error: 'User ID is required for user operations' };
        return;
    }

    if (req.method === 'PUT') {
        // Update user (activate/deactivate)
        const { status } = req.body;

        if (!status || !['active', 'deactivated'].includes(status)) {
            context.res.status = 400;
            context.res.body = { error: 'Valid status (active/deactivated) is required' };
            return;
        }

        // Get user
        const { resource: user } = await usersContainer.item(userId, userId).read();
        
        if (!user || user.organizationId !== orgId) {
            context.res.status = 404;
            context.res.body = { error: 'User not found' };
            return;
        }

        // Update user status
        user.status = status;
        await usersContainer.item(userId, userId).replace(user);

        context.res.status = 200;
        context.res.body = { message: 'User updated successfully', user };

    } else if (req.method === 'DELETE') {
        // Remove user
        const { resource: user } = await usersContainer.item(userId, userId).read();
        
        if (!user || user.organizationId !== orgId) {
            context.res.status = 404;
            context.res.body = { error: 'User not found' };
            return;
        }

        await usersContainer.item(userId, userId).delete();

        context.res.status = 200;
        context.res.body = { message: 'User removed successfully' };

    } else {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
    }
}