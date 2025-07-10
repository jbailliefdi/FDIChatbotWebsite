const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');
const { sendInviteEmail, sendAccountActivatedEmail, sendAccountDeactivatedEmail, sendAdminPromotedEmail, sendAdminDemotedEmail, sendAccountRemovedEmail } = require('../utils/emailService');

// Initialize Cosmos DB client
let cosmosClient, database, organizationsContainer, usersContainer;

try {
    if (process.env.COSMOS_DB_CONNECTION_STRING) {
        cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
        database = cosmosClient.database('fdi-chatbot');
        organizationsContainer = database.container('organizations');
        usersContainer = database.container('users');
        console.log('Cosmos DB initialized successfully');
    } else {
        console.warn('COSMOS_DB_CONNECTION_STRING not found. Database operations will be disabled.');
    }
} catch (error) {
    console.error('Failed to initialize Cosmos DB client:', error.message);
}

module.exports = async function (context, req) {
    context.log('=== DASHBOARD API CALLED ===');
    context.log('Method:', req.method);
    context.log('URL:', req.url);
    context.log('Params:', req.params);
    context.log('Body:', req.body);

    // CORS headers
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': 'https://kind-mud-048fffa03.6.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    try {
        const method = req.method;
        const orgId = req.params.orgId;
        const segments = req.params.segments ? req.params.segments.split('/') : [];
        
        context.log('Parsed - Method:', method, 'OrgId:', orgId, 'Segments:', segments);

        // Route: /api/organization/{orgId}/invite - POST
        if (method === 'POST' && segments.includes('invite')) {
            context.log('INVITE ROUTE MATCHED!');
            
            const { firstName, lastName, email, role = 'user' } = req.body || {};
            
            if (!email || !firstName || !lastName) {
                context.res.status = 400;
                context.res.body = { error: 'First name, last name, and email are required' };
                return;
            }

            // Check if database is available
            if (!usersContainer || !organizationsContainer) {
                context.log('Database not available, returning demo response');
                context.res.status = 200;
                context.res.body = {
                    message: 'User invited successfully (demo mode - database not available)',
                    user: {
                        id: 'demo-' + Date.now(),
                        email: email,
                        firstName: firstName,
                        lastName: lastName,
                        role: role
                    }
                };
                return;
            }

            try {
                // Get organization details first
                const orgQuery = {
                    query: "SELECT * FROM c WHERE c.id = @orgId",
                    parameters: [{ name: "@orgId", value: orgId }]
                };
                
                const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
                
                if (organizations.length === 0) {
                    context.res.status = 404;
                    context.res.body = { error: 'Organization not found' };
                    return;
                }
                
                const organization = organizations[0];
                
                // Check if user already exists
                const existingUserQuery = {
                    query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId",
                    parameters: [
                        { name: "@email", value: email },
                        { name: "@orgId", value: orgId }
                    ]
                };
                
                const { resources: existingUsers } = await usersContainer.items.query(existingUserQuery).fetchAll();
                
                if (existingUsers.length > 0) {
                    context.res.status = 400;
                    context.res.body = { error: 'User with this email already exists in the organization' };
                    return;
                }

                // Generate invite token
                const crypto = require('crypto');
                const inviteToken = crypto.randomBytes(32).toString('hex');
                const expirationDate = new Date();
                expirationDate.setDate(expirationDate.getDate() + 30); // 30 days expiration

                // Create new user
                const userId = uuidv4();
                const newUser = {
                    id: userId,
                    email: email,
                    firstName: firstName,
                    lastName: lastName,
                    phone: null,
                    organizationId: orgId,
                    role: role,
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                    lastLogin: null,
                    invitedUser: true,
                    inviteToken: inviteToken,
                    inviteExpires: expirationDate.toISOString(),
                    questionsAsked: 0,
                    questionsResetDate: new Date().toISOString()
                };
                
                context.log('Creating user:', newUser);
                await usersContainer.items.create(newUser);
                context.log('User created successfully');
                
                // Send invitation email
                try {
                    const emailResult = await sendInviteEmail(email, inviteToken, organization.name);
                    context.log('Email result:', emailResult);
                    
                    if (emailResult.success) {
                        context.log('Invitation email sent successfully');
                    } else {
                        context.log('Failed to send invitation email:', emailResult.error);
                    }
                } catch (emailError) {
                    context.log('Email sending error:', emailError.message);
                }
                
                context.res.status = 200;
                context.res.body = {
                    message: 'User invited successfully and email sent',
                    user: {
                        id: userId,
                        email: email,
                        firstName: firstName,
                        lastName: lastName,
                        role: role
                    }
                };
                
            } catch (dbError) {
                context.log.error('Database error:', dbError.message);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to create user',
                    message: 'Service temporarily unavailable'
                };
            }
            return;
        }
        
        // Route: /api/organization/{orgId}/overview - GET
        if (method === 'GET' && segments.includes('overview')) {
            context.log('OVERVIEW ROUTE MATCHED!');
            
            // Check if database is available
            if (!usersContainer || !organizationsContainer) {
                context.log('Database not available, returning demo response');
                context.res.status = 200;
                context.res.body = {
                    organization: { id: orgId, name: 'Demo Organization' },
                    users: [],
                    usage: { total: 2, used: 0, available: 2, percentage: 0 }
                };
                return;
            }

            try {
                // Get organization details
                const orgQuery = {
                    query: "SELECT * FROM c WHERE c.id = @orgId",
                    parameters: [{ name: "@orgId", value: orgId }]
                };
                
                const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
                
                if (organizations.length === 0) {
                    context.res.status = 404;
                    context.res.body = { error: 'Organization not found' };
                    return;
                }
                
                const organization = organizations[0];
                
                // Get all users for this organization
                const usersQuery = {
                    query: "SELECT c.id, c.email, c.firstName, c.lastName, c.role, c.status, c.createdAt, c.lastLogin FROM c WHERE c.organizationId = @orgId ORDER BY c.createdAt DESC",
                    parameters: [{ name: "@orgId", value: orgId }]
                };
                
                const { resources: users } = await usersContainer.items.query(usersQuery).fetchAll();
                
                // Calculate usage stats
                const activeUsers = users.filter(u => u.status === 'active').length;
                const usage = {
                    total: organization.licenseCount || 2,
                    used: activeUsers,
                    available: (organization.licenseCount || 2) - activeUsers,
                    percentage: Math.round((activeUsers / (organization.licenseCount || 2)) * 100)
                };
                
                context.res.status = 200;
                context.res.body = {
                    organization: {
                        id: organization.id,
                        name: organization.name,
                        licenseCount: organization.licenseCount,
                        status: organization.status,
                        createdAt: organization.createdAt
                    },
                    users,
                    usage
                };
                
            } catch (dbError) {
                context.log.error('Database error:', dbError.message);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to get organization overview',
                    message: 'Service temporarily unavailable'
                };
            }
            return;
        }
        
        // Route: /api/organization/{orgId}/users/{userId} - PUT (update user)
        if (method === 'PUT' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            context.log('UPDATE USER ROUTE MATCHED!', { userId, body: req.body });
            
            // Check if database is available
            if (!usersContainer) {
                context.res.status = 500;
                context.res.body = { error: 'Database not available' };
                return;
            }

            try {
                // Get user
                const userQuery = {
                    query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
                    parameters: [
                        { name: "@userId", value: userId },
                        { name: "@orgId", value: orgId }
                    ]
                };
                
                const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
                
                if (users.length === 0) {
                    context.res.status = 404;
                    context.res.body = { error: 'User not found' };
                    return;
                }
                
                const user = users[0];
                const { role, status } = req.body || {};
                
                // If deactivating an admin, check admin constraints
                if (status === 'deactivated' && user.role === 'admin') {
                    const adminQuery = {
                        query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
                        parameters: [{ name: "@orgId", value: orgId }]
                    };
                    
                    const { resources: adminCount } = await usersContainer.items.query(adminQuery).fetchAll();
                    
                    if (adminCount[0] <= 1) {
                        context.res.status = 400;
                        context.res.body = { error: 'Cannot deactivate the only admin user' };
                        return;
                    }
                }
                
                // Update user
                const updatedUser = {
                    ...user,
                    role: role || user.role,
                    status: status || user.status,
                    lastUpdated: new Date().toISOString()
                };
                
                if (status === 'deactivated') {
                    updatedUser.deactivatedAt = new Date().toISOString();
                } else if (status === 'active' && user.status !== 'active') {
                    updatedUser.reactivatedAt = new Date().toISOString();
                    delete updatedUser.deactivatedAt;
                }
                
                context.log('Updating user:', updatedUser);
                await usersContainer.item(user.id, user.organizationId).replace(updatedUser);
                
                // Send email notifications for status/role changes
                await sendUserChangeNotifications(user, updatedUser, orgId, context);
                
                context.res.status = 200;
                context.res.body = {
                    message: 'User updated successfully',
                    user: updatedUser
                };
                
            } catch (dbError) {
                context.log.error('Database error:', dbError.message);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to update user',
                    message: 'Service temporarily unavailable'
                };
            }
            return;
        }
        
        // Route: /api/organization/{orgId}/users/{userId} - DELETE (delete user)
        if (method === 'DELETE' && segments.includes('users') && segments.length >= 2) {
            const userId = segments[segments.indexOf('users') + 1];
            context.log('DELETE USER ROUTE MATCHED!', { userId });
            
            // Check if database is available
            if (!usersContainer) {
                context.res.status = 500;
                context.res.body = { error: 'Database not available' };
                return;
            }

            try {
                // Get user
                const userQuery = {
                    query: "SELECT * FROM c WHERE c.id = @userId AND c.organizationId = @orgId",
                    parameters: [
                        { name: "@userId", value: userId },
                        { name: "@orgId", value: orgId }
                    ]
                };
                
                const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
                
                if (users.length === 0) {
                    context.res.status = 404;
                    context.res.body = { error: 'User not found' };
                    return;
                }
                
                const user = users[0];
                
                // Check admin constraints
                if (user.role === 'admin') {
                    const adminQuery = {
                        query: "SELECT VALUE COUNT(1) FROM c WHERE c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
                        parameters: [{ name: "@orgId", value: orgId }]
                    };
                    
                    const { resources: adminCount } = await usersContainer.items.query(adminQuery).fetchAll();
                    
                    if (adminCount[0] <= 1) {
                        context.res.status = 400;
                        context.res.body = { error: 'Cannot remove the only admin user' };
                        return;
                    }
                }
                
                // Send removal email before deleting
                await sendUserRemovalNotification(user, orgId, context);
                
                // Delete user
                context.log('Deleting user:', user.id);
                await usersContainer.item(user.id, user.organizationId).delete();
                
                context.res.status = 200;
                context.res.body = { message: 'User removed successfully' };
                
            } catch (dbError) {
                context.log.error('Database error:', dbError.message);
                context.res.status = 500;
                context.res.body = { 
                    error: 'Failed to delete user',
                    message: 'Service temporarily unavailable'
                };
            }
            return;
        }
        
        // Default response
        context.res.status = 200;
        context.res.body = {
            message: 'Dashboard API endpoint reached',
            method: method,
            orgId: orgId,
            segments: segments,
            url: req.url
        };
        
    } catch (error) {
        context.log.error('Error:', error.message);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: 'Service temporarily unavailable'
        };
    }
};

async function sendUserChangeNotifications(originalUser, updatedUser, orgId, context) {
    try {
        // Get organization details for email
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: orgId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for email notifications');
            return;
        }
        
        const organization = organizations[0];
        const adminEmail = organization.adminEmail;
        
        // Check for status changes
        if (originalUser.status !== updatedUser.status) {
            if (originalUser.status === 'pending' && updatedUser.status === 'active') {
                // Account activated
                context.log('Sending account activated email to:', updatedUser.email);
                const emailResult = await sendAccountActivatedEmail(updatedUser.email, organization.name, adminEmail);
                if (emailResult.success) {
                    context.log('Account activated email sent successfully');
                } else {
                    context.log('Failed to send account activated email:', emailResult.error);
                }
            } else if (originalUser.status === 'deactivated' && updatedUser.status === 'active') {
                // Account reactivated
                context.log('Sending account activated email to:', updatedUser.email);
                const emailResult = await sendAccountActivatedEmail(updatedUser.email, organization.name, adminEmail);
                if (emailResult.success) {
                    context.log('Account reactivated email sent successfully');
                } else {
                    context.log('Failed to send account reactivated email:', emailResult.error);
                }
            } else if (updatedUser.status === 'deactivated') {
                // Account deactivated
                context.log('Sending account deactivated email to:', updatedUser.email);
                const emailResult = await sendAccountDeactivatedEmail(updatedUser.email, organization.name, adminEmail);
                if (emailResult.success) {
                    context.log('Account deactivated email sent successfully');
                } else {
                    context.log('Failed to send account deactivated email:', emailResult.error);
                }
            }
        }
        
        // Check for role changes
        if (originalUser.role !== updatedUser.role) {
            if (originalUser.role === 'user' && updatedUser.role === 'admin') {
                // Promoted to admin
                context.log('Sending admin promoted email to:', updatedUser.email);
                const emailResult = await sendAdminPromotedEmail(updatedUser.email, organization.name, adminEmail);
                if (emailResult.success) {
                    context.log('Admin promoted email sent successfully');
                } else {
                    context.log('Failed to send admin promoted email:', emailResult.error);
                }
            } else if (originalUser.role === 'admin' && updatedUser.role === 'user') {
                // Demoted from admin
                context.log('Sending admin demoted email to:', updatedUser.email);
                const emailResult = await sendAdminDemotedEmail(updatedUser.email, organization.name, adminEmail);
                if (emailResult.success) {
                    context.log('Admin demoted email sent successfully');
                } else {
                    context.log('Failed to send admin demoted email:', emailResult.error);
                }
            }
        }
        
    } catch (error) {
        context.log.error('Error sending user change notifications:', error.message);
        // Don't fail the main operation if email fails
    }
}

async function sendUserRemovalNotification(user, orgId, context) {
    try {
        // Get organization details for email
        const orgQuery = {
            query: "SELECT * FROM c WHERE c.id = @orgId",
            parameters: [{ name: "@orgId", value: orgId }]
        };
        
        const { resources: organizations } = await organizationsContainer.items.query(orgQuery).fetchAll();
        
        if (organizations.length === 0) {
            context.log('Organization not found for removal email notification');
            return;
        }
        
        const organization = organizations[0];
        const adminEmail = organization.adminEmail;
        
        // Send account removal email
        context.log('Sending account removal email to:', user.email);
        const emailResult = await sendAccountRemovedEmail(user.email, organization.name, adminEmail);
        if (emailResult.success) {
            context.log('Account removal email sent successfully');
        } else {
            context.log('Failed to send account removal email:', emailResult.error);
        }
        
    } catch (error) {
        context.log.error('Error sending user removal notification:', error.message);
        // Don't fail the main operation if email fails
    }
}