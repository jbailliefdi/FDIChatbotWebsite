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

            // Simple success response
            context.res.status = 200;
            context.res.body = {
                message: 'User invited successfully (simplified version)',
                user: {
                    id: 'test-' + Date.now(),
                    email: email,
                    firstName: firstName,
                    lastName: lastName,
                    role: role
                }
            };
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
        context.log.error('Error:', error);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: error.message
        };
    }
};