const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Checking subscription for user');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        const { email } = req.body;
        
        if (!email) {
            context.res = { status: 400, body: { message: 'Email is required' } };
            return;
        }

        context.log('Checking subscription for email:', email);

        // Find user in database
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.status = 'active'",
            parameters: [{ name: "@email", value: email.toLowerCase() }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            // User not found - check if it's a test email for development
            const testEmails = ['j.baillie@fdintelligence.co.uk'];
            if (testEmails.includes(email.toLowerCase())) {
                context.res = {
                    status: 200,
                    body: {
                        active: true,
                        companyName: "FD Intelligence (Test)",
                        usedLicenses: 1,
                        totalLicenses: 5,
                        message: "Test account"
                    }
                };
                return;
            }

            context.log('User not found in database');
            context.res = {
                status: 200,
                body: {
                    active: false,
                    message: "No active subscription found"
                }
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
            context.log('Organization not found for user');
            context.res = {
                status: 200,
                body: {
                    active: false,
                    message: "Organization not found"
                }
            };
            return;
        }

        const organization = organizations[0];

        // Check subscription status
        const hasValidSubscription = organization.status === 'active' || 
                                   organization.status === 'trialing';

        // Count current active users in organization
        const userCountQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [{ name: "@orgId", value: organization.id }]
        };

        const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
        const currentUserCount = countResult[0] || 0;

        const withinLicenseLimit = currentUserCount <= organization.licenseCount;

        if (hasValidSubscription && withinLicenseLimit) {
            context.log('User has valid subscription');
            context.res = {
                status: 200,
                body: {
                    active: true,
                    companyName: organization.name,
                    usedLicenses: currentUserCount,
                    totalLicenses: organization.licenseCount,
                    userRole: user.role,
                    subscriptionStatus: organization.status
                }
            };
        } else {
            context.log('User subscription invalid or over limit');
            context.res = {
                status: 200,
                body: {
                    active: false,
                    message: hasValidSubscription ? "License limit exceeded" : "Subscription inactive"
                }
            };
        }

    } catch (error) {
        context.log.error('Error checking subscription:', error);
        
        // Fallback for development - allow test email
        if (req.body?.email === 'j.baillie@fdintelligence.co.uk') {
            context.res = {
                status: 200,
                body: {
                    active: true,
                    companyName: "FD Intelligence (Fallback)",
                    usedLicenses: 1,
                    totalLicenses: 5,
                    message: "Database error - using fallback"
                }
            };
            return;
        }

        context.res = {
            status: 500,
            body: { message: 'Internal server error' }
        };
    }
};