// api/get-billing-data/index.js (CONSOLE DEBUG VERSION)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');

const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    console.log('=== BILLING API DEBUG ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    try {
        const { organizationId, userEmail } = req.body;
        
        console.log('Extracted values:');
        console.log('- organizationId:', organizationId);
        console.log('- userEmail:', userEmail);
        
        if (!organizationId || !userEmail) {
            console.log('Missing required fields');
            context.res = { 
                status: 400, 
                body: { 
                    error: 'Organization ID and user email required',
                    debug: 'Missing required fields'
                } 
            };
            return;
        }

        // First, let's try to find ALL users in this organization
        console.log('Searching for ALL users in organization:', organizationId);
        
        const allUsersQuery = {
            query: "SELECT * FROM c",
            parameters: []
        };

        const { resources: allUsers } = await usersContainer.items.query(allUsersQuery, {
            partitionKey: organizationId
        }).fetchAll();
        
        console.log(`Found ${allUsers.length} total users in organization ${organizationId}`);
        
        allUsers.forEach((user, index) => {
            console.log(`User ${index + 1}:`, {
                id: user.id,
                email: user.email,
                role: user.role,
                status: user.status,
                organizationId: user.organizationId
            });
        });

        // Now search for the specific user
        console.log('Searching for specific user with email:', userEmail);
        
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @userEmail",
            parameters: [
                { name: "@userEmail", value: userEmail }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery, {
            partitionKey: organizationId
        }).fetchAll();
        
        console.log(`Found ${users.length} users matching email ${userEmail}`);
        
        if (users.length === 0) {
            console.log('No users found with that email in this organization');
            
            // Let's also check if the user exists in a different organization
            const crossPartitionQuery = {
                query: "SELECT * FROM c WHERE c.email = @userEmail",
                parameters: [
                    { name: "@userEmail", value: userEmail }
                ]
            };

            const { resources: allMatchingUsers } = await usersContainer.items.query(crossPartitionQuery).fetchAll();
            
            console.log(`Found ${allMatchingUsers.length} users with this email across all organizations:`);
            allMatchingUsers.forEach(user => {
                console.log('- User in org:', user.organizationId, 'with role:', user.role);
            });
            
            context.res = { 
                status: 403, 
                body: { 
                    error: 'User not found in organization',
                    debug: {
                        searchedOrgId: organizationId,
                        searchedEmail: userEmail,
                        totalUsersInOrg: allUsers.length,
                        usersWithEmailAcrossAllOrgs: allMatchingUsers.length,
                        message: 'Check console for detailed user list'
                    }
                } 
            };
            return;
        }

        const currentUser = users[0];
        console.log('Found user:', {
            id: currentUser.id,
            email: currentUser.email,
            role: currentUser.role,
            status: currentUser.status
        });
        
        if (currentUser.role !== 'admin') {
            console.log('User role check failed. Expected: admin, Got:', currentUser.role);
            context.res = { 
                status: 403, 
                body: { 
                    error: 'Admin access required',
                    debug: {
                        userRole: currentUser.role,
                        expectedRole: 'admin',
                        message: 'User found but not admin'
                    }
                } 
            };
            return;
        }

        // Try to get organization
        console.log('Attempting to get organization:', organizationId);
        
        try {
            const { resource: organization } = await organizationsContainer.item(organizationId, organizationId).read();
            
            if (!organization) {
                console.log('Organization not found');
                context.res = { 
                    status: 404, 
                    body: { 
                        error: 'Organization not found',
                        debug: 'Organization lookup returned null'
                    } 
                };
                return;
            }
            
            console.log('Found organization:', {
                id: organization.id,
                name: organization.name,
                stripeCustomerId: organization.stripeCustomerId,
                status: organization.status
            });
            
            if (!organization.stripeCustomerId) {
                console.log('No Stripe customer ID found');
                context.res = { 
                    status: 404, 
                    body: { 
                        error: 'No billing setup found for this organization',
                        debug: 'Organization exists but no stripeCustomerId'
                    } 
                };
                return;
            }

            // SUCCESS - return debug info for now
            console.log('SUCCESS: All checks passed!');
            console.log('Ready to call Stripe with customer ID:', organization.stripeCustomerId);
            
            context.res = {
                status: 200,
                body: {
                    success: true,
                    debug: {
                        userId: currentUser.id,
                        userEmail: currentUser.email,
                        userRole: currentUser.role,
                        organizationId: organization.id,
                        organizationName: organization.name,
                        stripeCustomerId: organization.stripeCustomerId,
                        message: 'All validation passed - ready for Stripe integration'
                    }
                }
            };

        } catch (orgError) {
            console.error('Error getting organization:', orgError);
            context.res = {
                status: 500,
                body: { 
                    error: 'Error accessing organization: ' + orgError.message,
                    debug: 'Organization lookup failed'
                }
            };
        }

    } catch (error) {
        console.error('Top level error:', error);
        context.res = {
            status: 500,
            body: { 
                error: error.message,
                debug: 'Top level exception occurred'
            }
        };
    }
};