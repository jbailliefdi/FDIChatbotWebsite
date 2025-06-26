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
        // SECURITY: Require MSAL_CLIENT_ID environment variable - no fallback
        const clientId = process.env.MSAL_CLIENT_ID;
        if (!clientId) {
            console.error('MSAL_CLIENT_ID environment variable is required');
            reject(new Error('Authentication configuration error'));
            return;
        }

        jwt.verify(token, getKey, {
            audience: clientId,
            issuer: [
                'https://login.microsoftonline.com/common/v2.0',
                'https://sts.windows.net/common/',
                'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'
            ],
            algorithms: ['RS256']
        }, (err, decoded) => {
            if (err) {
                console.error('Token validation error:', err);
                reject(new Error('Invalid token'));
            } else {
                resolve(decoded);
            }
        });
    });
}

async function validateAdminAccess(authHeader, organizationId, usersContainer) {
    try {
        // Validate token and get user email
        const decoded = await validateToken(authHeader);
        const userEmail = decoded.preferred_username || decoded.email || decoded.unique_name;
        
        if (!userEmail) {
            throw new Error('No email found in token');
        }
        
        // Verify user is admin for this organization
        const userQuery = {
            query: "SELECT * FROM c WHERE c.email = @email AND c.organizationId = @orgId AND c.role = 'admin' AND c.status = 'active'",
            parameters: [
                { name: "@email", value: userEmail.toLowerCase() },
                { name: "@orgId", value: organizationId }
            ]
        };
        
        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('Access denied. Admin privileges required for this organization.');
        }
        
        return {
            user: users[0],
            email: userEmail
        };
        
    } catch (error) {
        throw error;
    }
}

module.exports = { validateToken, validateAdminAccess };