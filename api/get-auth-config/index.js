const { applySecurityHeaders } = require('../utils/securityHeaders');
const { withRateLimitWrapper } = require('../utils/rateLimitMiddleware');

async function getAuthConfigHandler(context, req) {
    if (req.method !== 'GET') {
        applySecurityHeaders(context, req, { message: 'Method not allowed' }, 405);
        return;
    }

    applySecurityHeaders(context, req, {
        clientId: process.env.MSAL_CLIENT_ID,
        authority: "https://login.microsoftonline.com/common"
    });
}

// Export with rate limiting protection
module.exports = withRateLimitWrapper(getAuthConfigHandler, {
    limitType: 'auth' // 50 requests per hour per IP
});