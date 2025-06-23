// Enhanced api/check-subscription/index.js with grace period support
const { CosmosClient } = require('@azure/cosmos');

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
            // Fallback for development - allow test email
            // Fallback for development - allow test email
const testEmails = ['j.baillie@fdintelligence.co.uk'];
if (testEmails.includes(email.toLowerCase())) {
    context.res = {
        status: 200,
        body: {
            active: true,
            companyName: "FD Intelligence (Test)",
            usedLicenses: 1,
            totalLicenses: 5,
            userRole: "admin", // Add this line
            message: "Test account",
            subscriptionStatus: "active"
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
        const now = new Date();

        // Determine subscription status with grace period logic
        let hasAccess = false;
        let accessReason = "";
        let warningMessage = "";
        let isGracePeriod = false;

        // Check different subscription states
        if (organization.status === 'active') {
            hasAccess = true;
            accessReason = "Active subscription";
        } 
        else if (organization.status === 'trialing') {
            // Check if trial has expired
            if (organization.trialEnd && new Date(organization.trialEnd) > now) {
                hasAccess = true;
                accessReason = "Trial period";
                const daysLeft = Math.ceil((new Date(organization.trialEnd) - now) / (1000 * 60 * 60 * 24));
                warningMessage = `Trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
            } else {
                hasAccess = false;
                accessReason = "Trial expired";
            }
        }
        else if (organization.status === 'past_due') {
            // Check grace period
            if (organization.gracePeriodEnd && new Date(organization.gracePeriodEnd) > now) {
                hasAccess = true;
                isGracePeriod = true;
                accessReason = "Grace period";
                const daysLeft = Math.ceil((new Date(organization.gracePeriodEnd) - now) / (1000 * 60 * 60 * 24));
                warningMessage = `Payment issue - Access ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
            } else {
                hasAccess = false;
                accessReason = "Payment overdue";
            }
        }
        else if (organization.status === 'cancelled') {
            hasAccess = false;
            accessReason = "Subscription cancelled";
        }
        else {
            hasAccess = false;
            accessReason = "Unknown status";
        }

        // Check license limits if access is granted
        let currentUserCount = 0;
        if (hasAccess) {
            const userCountQuery = {
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
                parameters: [{ name: "@orgId", value: organization.id }]
            };

            const { resources: countResult } = await usersContainer.items.query(userCountQuery).fetchAll();
            currentUserCount = countResult[0] || 0;

            const withinLicenseLimit = currentUserCount <= organization.licenseCount;
            if (!withinLicenseLimit) {
                hasAccess = false;
                accessReason = "License limit exceeded";
            }
        }

        if (hasAccess) {
            context.log('User has valid access:', accessReason);
            context.res = {
                status: 200,
                body: {
                    active: true,
                    companyName: organization.name,
                    usedLicenses: currentUserCount,
                    totalLicenses: organization.licenseCount,
                    userRole: user.role,
                    subscriptionStatus: organization.status,
                    accessReason: accessReason,
                    warningMessage: warningMessage,
                    isGracePeriod: isGracePeriod,
                    trialEnd: organization.trialEnd,
                    gracePeriodEnd: organization.gracePeriodEnd
                }
            };
        } else {
            context.log('User access denied:', accessReason);
            context.res = {
                status: 200,
                body: {
                    active: false,
                    message: accessReason,
                    subscriptionStatus: organization.status,
                    companyName: organization.name
                }
            };
        }

    } catch (error) {
        context.log.error('Error checking subscription:', error);
        
        // Fallback for development
        // Fallback for development
if (req.body?.email === 'j.baillie@fdintelligence.co.uk') {
    context.res = {
        status: 200,
        body: {
            active: true,
            companyName: "FD Intelligence (Fallback)",
            usedLicenses: 1,
            totalLicenses: 5,
            userRole: "admin", // Add this line
            message: "Database error - using fallback",
            subscriptionStatus: "active"
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