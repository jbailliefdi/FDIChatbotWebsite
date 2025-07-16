/**
 * Security Headers Middleware
 * Adds comprehensive security headers to all API responses
 */

/**
 * Get standard security headers for API responses
 * @returns {Object} - Security headers object
 */
function getSecurityHeaders() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-DNS-Prefetch-Control': 'off',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), midi=(), speaker-selection=(), display-capture=(), fullscreen=(), web-share=()',
        'X-Permitted-Cross-Domain-Policies': 'none',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin'
    };
}

/**
 * Get CORS headers for API responses
 * @param {string} origin - Request origin
 * @returns {Object} - CORS headers object
 */
function getCORSHeaders(origin = null) {
    const allowedOrigins = [
        'https://kind-mud-048fffa03.6.azurestaticapps.net',
        'https://fdichatbot.com'
    ];
    
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'true'
    };
    
    // Set specific origin if it's in the allowlist
    if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    } else {
        headers['Access-Control-Allow-Origin'] = allowedOrigins[0];
    }
    
    return headers;
}

/**
 * Apply security headers to Azure Function response
 * @param {Object} context - Azure Function context
 * @param {Object} req - Request object
 * @param {Object} responseBody - Response body
 * @param {number} statusCode - HTTP status code
 * @param {Object} additionalHeaders - Additional headers
 */
function applySecurityHeaders(context, req, responseBody, statusCode = 200, additionalHeaders = {}) {
    const securityHeaders = getSecurityHeaders();
    const corsHeaders = getCORSHeaders(req.headers.origin);
    
    context.res = {
        status: statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...securityHeaders,
            ...corsHeaders,
            ...additionalHeaders
        },
        body: responseBody
    };
}

/**
 * Handle OPTIONS preflight requests
 * @param {Object} context - Azure Function context
 * @param {Object} req - Request object
 */
function handleOptionsRequest(context, req) {
    const corsHeaders = getCORSHeaders(req.headers.origin);
    const securityHeaders = getSecurityHeaders();
    
    context.res = {
        status: 200,
        headers: {
            ...securityHeaders,
            ...corsHeaders
        },
        body: ''
    };
}

module.exports = {
    getSecurityHeaders,
    getCORSHeaders,
    applySecurityHeaders,
    handleOptionsRequest
};