const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT,
    key: process.env.COSMOS_DB_KEY,
});

const database = cosmosClient.database('TIA');
const usersContainer = database.container('users');
const inviteLinksContainer = database.container('inviteLinks');
const organizationsContainer = database.container('organizations');

module.exports = async function (context, req) {
    context.log('Public signup function processed a request.');

    try {
        const { token, firstName, lastName, email, company } = req.body;

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

        // Validate invite token
        const linkQuery = {
            query: "SELECT * FROM c WHERE c.token = @token AND c.active = true",
            parameters: [
                { name: "@token", value: token }
            ]
        };

        const { resources: inviteLinks } = await inviteLinksContainer.items.query(linkQuery).fetchAll();
        
        if (inviteLinks.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Invalid or expired invitation link' }
            };
            return;
        }

        const inviteLink = inviteLinks[0];

        // Check if token is expired
        const now = new Date();
        const expirationDate = new Date(inviteLink.expiresAt);
        
        if (now > expirationDate) {
            // Deactivate expired link
            await inviteLinksContainer.item(inviteLink.id, inviteLink.organizationId).patch([
                { op: 'replace', path: '/active', value: false }
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
                { name: "@orgId", value: inviteLink.organizationId }
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

        // Get organization details to check license availability
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [
                { name: "@orgId", value: inviteLink.organizationId }
            ]
        };

        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Organization not found' }
            };
            return;
        }

        const organization = organizations[0];

        // Count current active users
        const activeUsersQuery = {
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.status = 'active'",
            parameters: [
                { name: "@orgId", value: inviteLink.organizationId }
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
            company: company?.trim() || '',
            role: 'user',
            status: 'pending', // Pending admin approval
            organizationId: inviteLink.organizationId,
            organizationName: inviteLink.organizationName,
            inviteToken: token,
            requestedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'public_signup'
        };

        await usersContainer.items.create(newUser);

        // Update invite link usage count
        await inviteLinksContainer.item(inviteLink.id, inviteLink.organizationId).patch([
            { op: 'replace', path: '/usageCount', value: (inviteLink.usageCount || 0) + 1 }
        ]);

        context.res = {
            status: 200,
            body: {
                message: 'Request submitted successfully',
                organizationName: inviteLink.organizationName,
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