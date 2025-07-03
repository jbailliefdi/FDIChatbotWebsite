const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const client = jwksClient({
    jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    cache: true,
    rateLimit: true
});

function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            callback(err);
            return;
        }
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
    });
}

async function validateToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('No valid authorization header');
    }
    
    const token = authHeader.substring(7);
    
    return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, {
            audience: process.env.MSAL_CLIENT_ID || '2bba73fd-cae6-4b9b-b0d1-cf1fd42a09d2',
            issuer: [
                'https://login.microsoftonline.com/common/v2.0',
                'https://sts.windows.net/common/',
                'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'
            ],
            algorithms: ['RS256']
        }, (err, decoded) => {
            if (err) {
                console.error('Token validation error:', err.message);
                reject(new Error('Invalid token'));
            } else {
                resolve(decoded);
            }
        });
    });
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Remove potential SQL injection patterns and dangerous characters
    return input.replace(/[<>\"'%;()&+]/g, '').trim();
}

async function validateAdminAccess(authHeader, organizationId, usersContainer) {
    try {
        // Validate token and get user email
        const decoded = await validateToken(authHeader);
        const userEmail = decoded.preferred_username || decoded.email || decoded.unique_name;
        
        if (!userEmail) {
            throw new Error('No email found in token');
        }
        
        // Sanitize inputs
        const sanitizedEmail = sanitizeInput(userEmail.toLowerCase());
        const sanitizedOrgId = sanitizeInput(organizationId);
        
        // Validate organization ID format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sanitizedOrgId)) {
            throw new Error('Invalid organization ID format');
        }
        
        // Verify user is admin for this organization
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
            parameters: [
                { name: "@email", value: sanitizedEmail },
                { name: "@orgId", value: sanitizedOrgId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('Access denied. Admin privileges required for this organization.');
        }
        
        return {
            user: users[0],
            email: sanitizedEmail
        };
        
    } catch (error) {
        throw error;
    }
}

module.exports = { validateToken, validateAdminAccess, sanitizeInput };