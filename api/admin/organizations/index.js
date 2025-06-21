const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Admin organizations API called');

    try {
        // Verify admin authentication
        const adminUser = await verifyAdminAccess(context, req);
        if (!adminUser) {
            context.res = { status: 401, body: { message: 'Unauthorized' } };
            return;
        }

        switch (req.method) {
            case 'GET':
                await handleGetOrganizations(context, req);
                break;
            case 'POST':
                await handleCreateOrganization(context, req, adminUser);
                break;
            case 'PUT':
                await handleUpdateOrganization(context, req, adminUser);
                break;
            case 'DELETE':
                await handleDeleteOrganization(context, req, adminUser);
                break;
            default:
                context.res = { status: 405, body: { message: 'Method not allowed' } };
        }

    } catch (error) {
        context.log.error('Error in admin organizations API:', error);
        context.res = { status: 500, body: { message: 'Internal server error' } };
    }
};

async function verifyAdminAccess(context, req) {
    try {
        const email = req.headers['x-user-email'] || req.body?.adminEmail;
        
        if (!email) return null;

        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.status = 'active'",
            parameters: [{ name: "@email", value: email.toLowerCase() }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) return null;

        const user = users[0];
        return (user.role === 'admin' || user.systemAdmin) ? user : null;

    } catch (error) {
        context.log.error('Error verifying admin access:', error);
        return null;
    }
}

async function handleGetOrganizations(context, req) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const status = req.query.status || '';

        // Build query
        let queryParts = ["SELECT * FROM c"];
        let parameters = [];
        let whereConditions = [];

        if (search) {
            whereConditions.push("(CONTAINS(LOWER(c.name), @search) OR CONTAINS(LOWER(c.adminEmail), @search))");
            parameters.push({ name: "@search", value: search.toLowerCase() });
        }

        if (status) {
            whereConditions.push("c.status = @status");
            parameters.push({ name: "@status", value: status });
        }

        if (whereConditions.length > 0) {
            queryParts.push("WHERE " + whereConditions.join(" AND "));
        }

        queryParts.push("ORDER BY c.createdAt DESC");

        const query = {
            query: queryParts.join(" "),
            parameters: parameters
        };

        const { resources: organizations } = await organizationsContainer.items.query(query).fetchAll();

        // Get user counts for each organization
        const orgsWithDetails = await Promise.all(organizations.map(async (org) => {
            try {
                // Get active user count
                const activeUserQuery = {
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                    parameters: [{ name: "@orgId", value: org.id }]
                };

                const { resources: activeCountResult } = await usersContainer.items.query(activeUserQuery).fetchAll();
                const activeUserCount = activeCountResult[0] || 0;

                // Get total user count
                const totalUserQuery = {
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId",
                    parameters: [{ name: "@orgId", value: org.id }]
                };

                const { resources: totalCountResult } = await usersContainer.items.query(totalUserQuery).fetchAll();
                const totalUserCount = totalCountResult[0] || 0;

                // Calculate days remaining for trial/grace periods
                let daysRemaining = null;
                if (org.trialEnd) {
                    const trialDays = Math.ceil((new Date(org.trialEnd) - new Date()) / (1000 * 60 * 60 * 24));
                    if (trialDays > 0) daysRemaining = trialDays;
                }
                if (org.gracePeriodEnd) {
                    const graceDays = Math.ceil((new Date(org.gracePeriodEnd) - new Date()) / (1000 * 60 * 60 * 24));
                    if (graceDays > 0) daysRemaining = graceDays;
                }

                return {
                    ...org,
                    activeUserCount,
                    totalUserCount,
                    licenseUtilization: org.licenseCount > 0 ? (activeUserCount / org.licenseCount * 100).toFixed(1) : 0,
                    daysRemaining
                };
            } catch (error) {
                context.log.warn('Error getting details for organization:', org.id);
                return { ...org, activeUserCount: 0, totalUserCount: 0, licenseUtilization: 0 };
            }
        }));

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedOrgs = orgsWithDetails.slice(startIndex, endIndex);

        const totalCount = organizations.length;
        const totalPages = Math.ceil(totalCount / limit);

        // Calculate summary statistics
        const stats = {
            total: totalCount,
            active: organizations.filter(o => o.status === 'active').length,
            trialing: organizations.filter(o => o.status === 'trialing').length,
            pastDue: organizations.filter(o => o.status === 'past_due').length,
            cancelled: organizations.filter(o => o.status === 'cancelled').length,
            totalLicenses: organizations.reduce((sum, o) => sum + (o.licenseCount || 0), 0),
            totalActiveUsers: orgsWithDetails.reduce((sum, o) => sum + (o.activeUserCount || 0), 0)
        };

        context.res = {
            status: 200,
            body: {
                organizations: paginatedOrgs,
                stats,
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
        context.log.error('Error getting organizations:', error);
        throw error;
    }
}

async function handleUpdateOrganization(context, req, adminUser) {
    try {
        const { organizationId } = req.query;
        const updates = req.body;

        if (!organizationId) {
            context.res = { status: 400, body: { message: 'Organization ID is required' } };
            return;
        }

        // Get existing organization
        const { resource: existingOrg } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!existingOrg) {
            context.res = { status: 404, body: { message: 'Organization not found' } };
            return;
        }

        // If license count is being reduced, check if it's valid
        if (updates.licenseCount && updates.licenseCount < existingOrg.licenseCount) {
            const activeUserQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organizationId }]
            };

            const { resources: countResult } = await usersContainer.items.query(activeUserQuery).fetchAll();
            const activeUserCount = countResult[0] || 0;

            if (updates.licenseCount < activeUserCount) {
                context.res = { 
                    status: 400, 
                    body: { 
                        message: `Cannot reduce licenses below active user count. Active users: ${activeUserCount}, Requested licenses: ${updates.licenseCount}` 
                    }
                };
                return;
            }
        }

        // Update organization
        const updatedOrg = {
            ...existingOrg,
            ...updates,
            lastUpdated: new Date().toISOString(),
            updatedBy: adminUser.email
        };

        // Remove fields that shouldn't be updated
        delete updatedOrg.id;
        delete updatedOrg.createdAt;

        await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

        context.res = {
            status: 200,
            body: { message: 'Organization updated successfully', organization: updatedOrg }
        };

    } catch (error) {
        context.log.error('Error updating organization:', error);
        throw error;
    }
}

async function handleDeleteOrganization(context, req, adminUser) {
    try {
        const { organizationId } = req.query;
        const { transferUsersTo } = req.body; // Optional: transfer users to another org

        if (!organizationId) {
            context.res = { status: 400, body: { message: 'Organization ID is required' } };
            return;
        }

        // Get organization
        const { resource: org } = await organizationsContainer.item(organizationId, organizationId).read();
        
        if (!org) {
            context.res = { status: 404, body: { message: 'Organization not found' } };
            return;
        }

        // Get all users in this organization
        const usersQuery = {
            query: "SELECT * FROM c WHERE c.organizationId = @orgId",
            parameters: [{ name: "@orgId", value: organizationId }]
        };

        const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();

        if (transferUsersTo) {
            // Transfer users to another organization
            const { resource: targetOrg } = await organizationsContainer.item(transferUsersTo, transferUsersTo).read();
            
            if (!targetOrg) {
                context.res = { status: 400, body: { message: 'Target organization not found' } };
                return;
            }

            // Update all users
            for (const user of users) {
                const updatedUser = {
                    ...user,
                    organizationId: transferUsersTo,
                    transferredAt: new Date().toISOString(),
                    transferredBy: adminUser.email,
                    previousOrganizationId: organizationId
                };

                await usersContainer.item(user.id, user.email).replace(updatedUser);
            }
        } else {
            // Deactivate all users
            for (const user of users) {
                const updatedUser = {
                    ...user,
                    status: 'deleted',
                    deletedAt: new Date().toISOString(),
                    deletedBy: adminUser.email,
                    deletionReason: 'Organization deleted'
                };

                await usersContainer.item(user.id, user.email).replace(updatedUser);
            }
        }

        // Soft delete organization
        const updatedOrg = {
            ...org,
            status: 'deleted',
            deletedAt: new Date().toISOString(),
            deletedBy: adminUser.email,
            userTransferredTo: transferUsersTo || null
        };

        await organizationsContainer.item(organizationId, organizationId).replace(updatedOrg);

        context.res = {
            status: 200,
            body: { 
                message: 'Organization deleted successfully',
                usersAffected: users.length,
                usersTransferred: transferUsersTo ? users.length : 0
            }
        };

    } catch (error) {
        context.log.error('Error deleting organization:', error);
        throw error;
    }
}