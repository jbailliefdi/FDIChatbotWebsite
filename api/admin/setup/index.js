const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Admin setup API called');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { email, firstName, lastName, setupKey } = req.body;

        // Verify setup key (you should set this as an environment variable)
        const expectedSetupKey = process.env.ADMIN_SETUP_KEY || 'fdi-admin-setup-2025';
        if (setupKey !== expectedSetupKey) {
            context.res = { status: 401, body: { message: 'Invalid setup key' } };
            return;
        }

        // Check if admin already exists
        const existingAdminQuery = {
            query: "SELECT * FROM c WHERE c.systemAdmin = true",
            parameters: []
        };

        const { resources: existingAdmins } = await usersContainer.items.query(existingAdminQuery).fetchAll();

        if (existingAdmins.length > 0) {
            context.res = { 
                status: 400, 
                body: { 
                    message: 'System admin already exists',
                    existingAdmin: existingAdmins[0].email
                } 
            };
            return;
        }

        // Create FDI admin organization
        const adminOrgId = uuidv4();
        const adminOrganization = {
            id: adminOrgId,
            name: "FD Intelligence (Admin)",
            subscriptionId: "admin-subscription",
            licenseCount: 999,
            status: "active",
            adminEmail: email,
            createdAt: new Date().toISOString(),
            isAdminOrganization: true,
            mockSubscription: false
        };

        await organizationsContainer.items.create(adminOrganization);

        // Create system admin user
        const adminUserId = uuidv4();
        const systemAdmin = {
            id: adminUserId,
            email: email.toLowerCase(),
            firstName: firstName || 'System',
            lastName: lastName || 'Admin',
            organizationId: adminOrgId,
            role: 'admin',
            systemAdmin: true, // Special flag for system admin
            status: 'active',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            mockUser: false,
            permissions: [
                'manage_all_users',
                'manage_all_organizations', 
                'view_analytics',
                'system_settings',
                'billing_management'
            ]
        };

        await usersContainer.items.create(systemAdmin);

        context.log('System admin created successfully:', email);

        context.res = {
            status: 200,
            body: {
                message: 'System admin created successfully',
                admin: {
                    email: systemAdmin.email,
                    name: `${systemAdmin.firstName} ${systemAdmin.lastName}`,
                    organization: adminOrganization.name
                }
            }
        };

    } catch (error) {
        context.log.error('Error setting up admin:', error);
        context.res = {
            status: 500,
            body: { message: 'Internal server error', error: error.message }
        };
    }
};