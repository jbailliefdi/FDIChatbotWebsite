// api/admin/analytics/index.js
const { CosmosClient } = require('@azure/cosmos');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Admin analytics API called');

    try {
        // Verify admin authentication
        const adminUser = await verifyAdminAccess(context, req);
        if (!adminUser) {
            context.res = { status: 401, body: { message: 'Unauthorized' } };
            return;
        }

        if (req.method !== 'GET') {
            context.res = { status: 405, body: { message: 'Method not allowed' } };
            return;
        }

        const { timeframe = '30d', metric } = req.query;

        if (metric) {
            await handleSpecificMetric(context, metric, timeframe);
        } else {
            await handleDashboardAnalytics(context, timeframe);
        }

    } catch (error) {
        context.log.error('Error in admin analytics API:', error);
        context.res = { status: 500, body: { message: 'Internal server error' } };
    }
};

async function verifyAdminAccess(context, req) {
    try {
        const email = req.headers['x-user-email'] || req.query.adminEmail;
        
        if (!email) return null;

        // Check if this is a setup email and no system admin exists yet
        const setupEmails = ['j.baillie@fdintelligence.co.uk', 'j.baillieadmin@fdintelligence.co.uk'];
        
        if (setupEmails.includes(email.toLowerCase())) {
            // Check if any system admin exists
            const systemAdminQuery = {
                query: "SELECT * FROM c WHERE c.systemAdmin = true",
                parameters: []
            };

            const { resources: systemAdmins } = await usersContainer.items.query(systemAdminQuery).fetchAll();
            
            // If no system admin exists, allow the setup email to proceed
            if (systemAdmins.length === 0) {
                return {
                    email: email,
                    systemAdmin: true,
                    setupMode: true
                };
            }
        }

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

async function handleDashboardAnalytics(context, timeframe) {
    try {
        // Calculate date range
        const now = new Date();
        const daysAgo = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : timeframe === '90d' ? 90 : 30;
        const startDate = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));

        // Get all organizations and users
        const [orgResults, userResults] = await Promise.all([
            organizationsContainer.items.query("SELECT * FROM c").fetchAll(),
            usersContainer.items.query("SELECT * FROM c").fetchAll()
        ]);

        const allOrgs = orgResults.resources;
        const allUsers = userResults.resources;

        // Filter by date range
        const orgsInRange = allOrgs.filter(org => new Date(org.createdAt) >= startDate);
        const usersInRange = allUsers.filter(user => new Date(user.createdAt) >= startDate);

        // Calculate metrics
        const metrics = {
            overview: {
                totalOrganizations: allOrgs.length,
                totalUsers: allUsers.length,
                activeOrganizations: allOrgs.filter(o => o.status === 'active').length,
                activeUsers: allUsers.filter(u => u.status === 'active').length,
                newOrganizations: orgsInRange.length,
                newUsers: usersInRange.length
            },
            subscriptions: {
                active: allOrgs.filter(o => o.status === 'active').length,
                trialing: allOrgs.filter(o => o.status === 'trialing').length,
                pastDue: allOrgs.filter(o => o.status === 'past_due').length,
                cancelled: allOrgs.filter(o => o.status === 'cancelled').length,
                incomplete: allOrgs.filter(o => o.status === 'incomplete').length
            },
            revenue: {
                totalLicenses: allOrgs.reduce((sum, o) => sum + (o.licenseCount || 0), 0),
                activeLicenses: allOrgs.filter(o => o.status === 'active').reduce((sum, o) => sum + (o.licenseCount || 0), 0),
                monthlyRecurringRevenue: allOrgs.filter(o => o.status === 'active').reduce((sum, o) => sum + ((o.licenseCount || 0) * 50), 0), // £50 per license
                averageLicensesPerOrg: allOrgs.length > 0 ? (allOrgs.reduce((sum, o) => sum + (o.licenseCount || 0), 0) / allOrgs.length).toFixed(1) : 0
            },
            trials: {
                activeTrials: allOrgs.filter(o => o.status === 'trialing').length,
                expiringSoon: allOrgs.filter(o => {
                    if (o.status !== 'trialing' || !o.trialEnd) return false;
                    const daysLeft = Math.ceil((new Date(o.trialEnd) - now) / (1000 * 60 * 60 * 24));
                    return daysLeft <= 3 && daysLeft > 0;
                }).length,
                conversionRate: calculateTrialConversionRate(allOrgs)
            }
        };

        // Calculate daily signups for the chart
        const dailySignups = calculateDailySignups(orgsInRange, daysAgo);

        // Calculate growth rates
        const previousPeriodOrgs = allOrgs.filter(org => {
            const createdDate = new Date(org.createdAt);
            const previousStart = new Date(startDate.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
            return createdDate >= previousStart && createdDate < startDate;
        });

        const growthRate = previousPeriodOrgs.length > 0 ? 
            ((orgsInRange.length - previousPeriodOrgs.length) / previousPeriodOrgs.length * 100).toFixed(1) : 
            orgsInRange.length > 0 ? 100 : 0;

        // Recent activity
        const recentActivity = [
            ...orgsInRange.slice(-10).map(org => ({
                type: 'organization_created',
                description: `New organization: ${org.name}`,
                timestamp: org.createdAt,
                data: { organizationId: org.id, adminEmail: org.adminEmail }
            })),
            ...usersInRange.slice(-10).map(user => ({
                type: 'user_created',
                description: `New user: ${user.firstName} ${user.lastName}`,
                timestamp: user.createdAt,
                data: { userId: user.id, email: user.email }
            }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);

        context.res = {
            status: 200,
            body: {
                metrics,
                charts: {
                    dailySignups,
                    growthRate: parseFloat(growthRate)
                },
                recentActivity,
                timeframe,
                generatedAt: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Error getting dashboard analytics:', error);
        throw error;
    }
}

async function handleSpecificMetric(context, metric, timeframe) {
    try {
        const now = new Date();
        const daysAgo = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : timeframe === '90d' ? 90 : 30;
        const startDate = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));

        let result = {};

        switch (metric) {
            case 'revenue_breakdown':
                result = await getRevenueBreakdown(startDate);
                break;
            case 'user_engagement':
                result = await getUserEngagement(startDate);
                break;
            case 'churn_analysis':
                result = await getChurnAnalysis(startDate);
                break;
            case 'license_utilization':
                result = await getLicenseUtilization();
                break;
            default:
                context.res = { status: 400, body: { message: 'Unknown metric' } };
                return;
        }

        context.res = {
            status: 200,
            body: {
                metric,
                data: result,
                timeframe,
                generatedAt: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Error getting specific metric:', error);
        throw error;
    }
}

function calculateTrialConversionRate(organizations) {
    const completedTrials = organizations.filter(org => 
        org.trialEnd && new Date(org.trialEnd) < new Date()
    );
    
    if (completedTrials.length === 0) return 0;
    
    const converted = completedTrials.filter(org => org.status === 'active').length;
    return ((converted / completedTrials.length) * 100).toFixed(1);
}

function calculateDailySignups(organizations, daysAgo) {
    const dailyData = [];
    const now = new Date();
    
    for (let i = daysAgo - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const dateStr = date.toISOString().split('T')[0];
        
        const signupsOnDay = organizations.filter(org => {
            const orgDate = new Date(org.createdAt);
            return orgDate.toISOString().split('T')[0] === dateStr;
        }).length;
        
        dailyData.push({
            date: dateStr,
            signups: signupsOnDay
        });
    }
    
    return dailyData;
}

async function getRevenueBreakdown(startDate) {
    const { resources: organizations } = await organizationsContainer.items.query("SELECT * FROM c").fetchAll();
    
    const breakdown = {
        byStatus: {},
        byLicenseCount: {},
        monthlyRecurring: 0,
        annualRecurring: 0
    };
    
    organizations.forEach(org => {
        const revenue = (org.licenseCount || 0) * 50; // £50 per license
        
        // By status
        if (!breakdown.byStatus[org.status]) {
            breakdown.byStatus[org.status] = { count: 0, revenue: 0 };
        }
        breakdown.byStatus[org.status].count++;
        if (org.status === 'active') {
            breakdown.byStatus[org.status].revenue += revenue;
            breakdown.monthlyRecurring += revenue;
            breakdown.annualRecurring += revenue * 12;
        }
        
        // By license count
        const licenseRange = org.licenseCount <= 5 ? '1-5' : 
                           org.licenseCount <= 10 ? '6-10' : 
                           org.licenseCount <= 25 ? '11-25' : '25+';
        
        if (!breakdown.byLicenseCount[licenseRange]) {
            breakdown.byLicenseCount[licenseRange] = { count: 0, revenue: 0 };
        }
        breakdown.byLicenseCount[licenseRange].count++;
        if (org.status === 'active') {
            breakdown.byLicenseCount[licenseRange].revenue += revenue;
        }
    });
    
    return breakdown;
}

async function getUserEngagement(startDate) {
    const { resources: users } = await usersContainer.items.query("SELECT * FROM c").fetchAll();
    
    const engagement = {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.status === 'active').length,
        usersWithRecentLogin: 0,
        averageDaysSinceLastLogin: 0,
        newUsersInPeriod: users.filter(u => new Date(u.createdAt) >= startDate).length
    };
    
    // Calculate login metrics
    const usersWithLogin = users.filter(u => u.lastLogin);
    engagement.usersWithRecentLogin = usersWithLogin.filter(u => {
        const daysSinceLogin = (new Date() - new Date(u.lastLogin)) / (1000 * 60 * 60 * 24);
        return daysSinceLogin <= 7;
    }).length;
    
    if (usersWithLogin.length > 0) {
        const totalDays = usersWithLogin.reduce((sum, u) => {
            const days = (new Date() - new Date(u.lastLogin)) / (1000 * 60 * 60 * 24);
            return sum + days;
        }, 0);
        engagement.averageDaysSinceLastLogin = (totalDays / usersWithLogin.length).toFixed(1);
    }
    
    return engagement;
}

async function getChurnAnalysis(startDate) {
    const { resources: organizations } = await organizationsContainer.items.query("SELECT * FROM c").fetchAll();
    
    const churn = {
        totalCancellations: organizations.filter(o => o.status === 'cancelled').length,
        churnRate: 0,
        reasonsForChurn: {},
        recentCancellations: []
    };
    
    const activeOrgs = organizations.filter(o => o.status === 'active').length;
    const cancelledOrgs = organizations.filter(o => o.status === 'cancelled').length;
    
    if (activeOrgs + cancelledOrgs > 0) {
        churn.churnRate = ((cancelledOrgs / (activeOrgs + cancelledOrgs)) * 100).toFixed(2);
    }
    
    // Recent cancellations
    churn.recentCancellations = organizations
        .filter(o => o.status === 'cancelled' && o.deletedAt && new Date(o.deletedAt) >= startDate)
        .map(o => ({
            name: o.name,
            cancelledAt: o.deletedAt,
            licenseCount: o.licenseCount,
            reason: o.cancellationReason || 'Not specified'
        }))
        .sort((a, b) => new Date(b.cancelledAt) - new Date(a.cancelledAt));
    
    return churn;
}

async function getLicenseUtilization() {
    const [orgResults, userResults] = await Promise.all([
        organizationsContainer.items.query("SELECT * FROM c WHERE c.status = 'active'").fetchAll(),
        usersContainer.items.query("SELECT * FROM c WHERE c.status = 'active'").fetchAll()
    ]);
    
    const activeOrgs = orgResults.resources;
    const activeUsers = userResults.resources;
    
    const utilization = {
        totalLicenses: activeOrgs.reduce((sum, o) => sum + (o.licenseCount || 0), 0),
        usedLicenses: activeUsers.length,
        utilizationRate: 0,
        underutilizedOrgs: [],
        overutilizedOrgs: []
    };
    
    if (utilization.totalLicenses > 0) {
        utilization.utilizationRate = ((utilization.usedLicenses / utilization.totalLicenses) * 100).toFixed(1);
    }
    
    // Find under/over utilized organizations
    for (const org of activeOrgs) {
        const orgUsers = activeUsers.filter(u => u.organizationId === org.id).length;
        const utilizationPercent = org.licenseCount > 0 ? (orgUsers / org.licenseCount * 100) : 0;
        
        if (utilizationPercent < 50 && org.licenseCount > 1) {
            utilization.underutilizedOrgs.push({
                name: org.name,
                licenseCount: org.licenseCount,
                usedLicenses: orgUsers,
                utilizationPercent: utilizationPercent.toFixed(1)
            });
        } else if (orgUsers > org.licenseCount) {
            utilization.overutilizedOrgs.push({
                name: org.name,
                licenseCount: org.licenseCount,
                usedLicenses: orgUsers,
                utilizationPercent: utilizationPercent.toFixed(1)
            });
        }
    }
    
    return utilization;
}