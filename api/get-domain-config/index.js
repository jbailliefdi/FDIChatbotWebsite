module.exports = async function (context, req) {
    // Enable CORS
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': process.env.SITE_DOMAIN || 'https://kind-mud-048fffa03.6.azurestaticapps.net',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    if (req.method !== 'GET') {
        context.res.status = 405;
        context.res.body = { error: 'Method not allowed' };
        return;
    }

    try {
        // SECURITY: Only expose the site domain, no sensitive configuration
        const siteDomain = process.env.SITE_DOMAIN || 'https://kind-mud-048fffa03.6.azurestaticapps.net';
        
        context.res.status = 200;
        context.res.body = {
            siteDomain: siteDomain
        };

    } catch (error) {
        context.log.error('Error in get-domain-config:', error);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: 'Unable to load domain configuration'
        };
    }
};