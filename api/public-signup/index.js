const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Public signup function processed a request.');

    try {
        const { token, firstName, lastName, email } = req.body;

        if (!token || !firstName || !lastName || !email) {
            context.res = {
                status: 400,
                body: { error: 'Token, first name, last name, and email are required' }
            };
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            context.res = {
                status: 400,
                body: { error: 'Invalid email format' }
            };
            return;
        }

        // First check if this is a user-specific invitation token
        const userQuery = {
            query: "SELECT * FROM c WHERE c.inviteToken = @token AND c.status = 'pending'",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length > 0) {
            // This is a user-specific invitation - activate the user account
            const user = users[0];
            
            // Check if user invite token is expired
            const now = new Date();
            const expirationDate = new Date(user.inviteExpires);
            
            if (now > expirationDate) {
                context.res = {
                    status: 404,
                    body: { error: 'User invitation has expired' }
                };
                return;
            }
            
            // Verify the email matches
            if (user.email.toLowerCase() !== email.toLowerCase()) {
                context.res = {
                    status: 400,
                    body: { error: 'Email does not match the invited user' }
                };
                return;
            }
            
            // Update the user to active status
            const updatedUser = {
                ...user,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                status: 'active',
                activatedAt: new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                inviteToken: null, // Clear the invite token
                inviteExpires: null,
                questionsAsked: user.questionsAsked || 0,
                questionsResetDate: user.questionsResetDate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
            };
            
            await usersContainer.item(user.id, user.organizationId).replace(updatedUser);
            
            // Get organization details
            const orgQuery = {
                query: "SELECT * FROM c WHERE c.id = @orgId",
                parameters: [
                    { name: "@orgId", value: user.organizationId }
                ]
            };

            const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
            const organization = organizations[0];
            
            context.res = {
                status: 200,
                body: {
                    message: 'Account activated successfully',
                    organizationName: organization.name,
                    status: 'active',
                    requiresApproval: false,
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: firstName,
                        lastName: lastName,
                        role: user.role
                    }
                }
            };
            return;
        }

        // If not a user token, check for organization invite link
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.inviteLink.token = @token AND c.inviteLink.active = true",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Invalid or expired invitation link' }
            };
            return;
        }

        const organization = organizations[0];
        const inviteLink = organization.inviteLink;

        // Check if token is expired
        const now = new Date();
        const expirationDate = new Date(inviteLink.expiresAt);
        
        if (now > expirationDate) {
            // Deactivate expired link
            await organizationsContainer.item(organization.id, organization.id).patch([
                { op: 'replace', path: '/inviteLink/active', value: false }
            ]);

            context.res = {
                status: 404,
                body: { error: 'Invitation link has expired' }
            };
            return;
        }

        // Check if user already exists in the organization
        const existingUserQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId",
            parameters: [
                { name: "@email", value: email },
                { name: "@orgId", value: organization.id }
            ]
        };

        const { resources: existingUsers } = await usersContainer.items.query(existingUserQuery).fetchAll();
        
        if (existingUsers.length > 0) {
            const existingUser = existingUsers[0];
            if (existingUser.status === 'active') {
                context.res = {
                    status: 409,
                    body: { error: 'You are already a member of this organization' }
                };
                return;
            } else if (existingUser.status === 'pending') {
                context.res = {
                    status: 409,
                    body: { error: 'Your request is already pending admin approval' }
                };
                return;
            }
        }

        // Organization is already loaded from the token validation above

        // Count current active users
        const activeUsersQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [
                { name: "@orgId", value: organization.id }
            ]
        };

        const { resources: activeUserCount } = await usersContainer.items.query(activeUsersQuery).fetchAll();
        const currentActiveUsers = activeUserCount[0] || 0;

        // Create pending user record
        const newUser = {
            id: uuidv4(),
            email: email.toLowerCase(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            role: 'user',
            status: 'pending', // Pending admin approval
            organizationId: organization.id,
            organizationName: organization.name,
            inviteToken: token,
            requestedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'public_signup',
            questionsAsked: 0,
            questionsResetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
        };

        await usersContainer.items.create(newUser);

        // Update invite link usage count
        await organizationsContainer.item(organization.id, organization.id).patch([
            { op: 'replace', path: '/inviteLink/usageCount', value: (inviteLink.usageCount || 0) + 1 }
        ]);

        context.res = {
            status: 200,
            body: {
                message: 'Request submitted successfully',
                organizationName: organization.name,
                status: 'pending',
                requiresApproval: true
            }
        };

    } catch (error) {
        context.log.error('Error processing public signup:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};