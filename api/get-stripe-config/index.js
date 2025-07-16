const { applySecurityHeaders } = require('../utils/securityHeaders');

module.exports = async function (context, req) {
    if (req.method !== 'GET') {
        applySecurityHeaders(context, req, { message: 'Method not allowed' }, 405);
        return;
    }

    applySecurityHeaders(context, req, {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
};