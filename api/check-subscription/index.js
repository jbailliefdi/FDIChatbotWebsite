// Enhanced api/check-subscription/index.js with trial support
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
            query: "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email) AND c.status = 'active'",
            parameters: [{ name: "@email", value: email.toLowerCase() }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();

        if (users.length === 0) {
            // Fallback for development - allow test email
            context.log('User not found in database');
            context.res = {
                status: 200,
                body: {
                    active: false,
                    userExists: false,
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
                    userExists: true,
                    message: "Organization not found"
                }
            };
            return;
        }

        const organization = organizations[0];
        const now = new Date();

        // Calculate trial information if applicable
        let trialInfo = null;
if ((organization.status === 'trialing' || organization.isTrial) && (organization.trialEndDate || organization.trialEnd)) {
    const trialEndDate = new Date(organization.trialEndDate || organization.trialEnd);
    const trialStartDate = organization.trialStarted ? new Date(organization.trialStarted) : new Date(organization.createdAt);
    
    const timeRemaining = trialEndDate - now;
    const daysLeft = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));
    const hoursLeft = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60)));
    
    trialInfo = {
        isActive: timeRemaining > 0,
        isExpired: timeRemaining <= 0,
        isEndingSoon: daysLeft <= 1 && timeRemaining > 0,
        daysLeft,
        hoursLeft,
        trialEndDate: trialEndDate.toISOString(),
        trialStarted: trialStartDate.toISOString(),
        timeRemaining: Math.max(0, timeRemaining)
    };
}

        // Determine subscription status with enhanced trial logic
        let hasAccess = false;
        let accessReason = "";
        let warningMessage = "";
        let isGracePeriod = false;
        let isTrialing = false;

        // Check different subscription states
        if (organization.status === 'active') {
            hasAccess = true;
            accessReason = "Active subscription";
        } 
        else if (organization.status === 'trialing') {
    isTrialing = true;
    // For trialing status, check if we have trial info or assume it's active
    if (!trialInfo || trialInfo.isActive) {
        hasAccess = true;
        accessReason = "Trial period";
        if (trialInfo && trialInfo.isEndingSoon) {
            warningMessage = `Trial expires in ${trialInfo.hoursLeft} hour${trialInfo.hoursLeft !== 1 ? 's' : ''}`;
        } else if (trialInfo) {
            warningMessage = `Trial expires in ${trialInfo.daysLeft} day${trialInfo.daysLeft !== 1 ? 's' : ''}`;
        }
    } else {
        hasAccess = false;
        accessReason = "Trial expired";
    }
}
        else if (organization.status === 'trial_ending') {
            isTrialing = true;
            if (trialInfo && trialInfo.isActive) {
                hasAccess = true;
                accessReason = "Trial ending soon";
                warningMessage = `Trial expires in ${trialInfo.hoursLeft} hour${trialInfo.hoursLeft !== 1 ? 's' : ''}`;
            } else {
                hasAccess = false;
                accessReason = "Trial expired";
            }
        }
        else if (organization.status === 'trial_expired') {
            hasAccess = false;
            accessReason = "Trial expired";
            isTrialing = false;
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
            
            const response = {
                active: true,
                userExists: true,
                companyName: organization.name,
                usedLicenses: currentUserCount,
                totalLicenses: organization.licenseCount,
                userRole: user.role,
                organizationId: user.organizationId,
                subscriptionStatus: organization.status,
                accessReason: accessReason,
                warningMessage: warningMessage,
                isGracePeriod: isGracePeriod,
                isTrialing: isTrialing,
                trialEnd: organization.trialEnd,
                gracePeriodEnd: organization.gracePeriodEnd,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    status: user.status,
                    createdAt: user.createdAt
                },
                organization: {
                    id: organization.id,
                    name: organization.name,
                    status: organization.status,
                    totalLicenses: organization.licenseCount,
                    usedLicenses: currentUserCount,
                    createdAt: organization.createdAt,
                    isTrial: organization.isTrial || false
                }
            };

            // Add trial information if available
            if (trialInfo) {
                response.organization.trialEndDate = trialInfo.trialEndDate;
                response.organization.trialStarted = trialInfo.trialStarted;
                response.organization.daysLeft = trialInfo.daysLeft;
                response.organization.hoursLeft = trialInfo.hoursLeft;
                response.trial = trialInfo;
            }

            context.res = {
                status: 200,
                body: response
            };
        } else {
            context.log('User access denied:', accessReason);
            context.res = {
                status: 200,
                body: {
                    active: false,
                    userExists: true,
                    message: accessReason,
                    subscriptionStatus: organization.status,
                    companyName: organization.name,
                    user: {
                        id: user.id,
                        email: user.email,
                        role: user.role,
                        status: user.status
                    },
                    organization: {
                        id: organization.id,
                        name: organization.name,
                        status: organization.status,
                        isTrial: organization.isTrial || false
                    }
                }
            };
        }

    } catch (error) {
        context.log.error('Error checking subscription:', error);
        
      
        context.res = {
            status: 500,
            body: { message: 'Internal server error' }
        };
    }
};