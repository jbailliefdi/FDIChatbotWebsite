/**
 * Rate Limiting Middleware for Azure Functions
 * Provides easy-to-use rate limiting for different endpoint types
 */

const { checkRateLimit, applyRateLimitResponse } = require('./enhancedRateLimit');
const { applySecurityHeaders } = require('./securityHeaders');

/**
 * Rate limiting middleware factory
 * @param {Object} options - Rate limiting options
 * @param {string} options.limitType - Type of rate limit ('general', 'signup', 'payment', 'auth', 'webhook')
 * @param {boolean} options.requireAuth - Whether endpoint requires authentication
 * @param {Function} options.getUserId - Function to extract user ID from request
 * @returns {Function} - Middleware function
 */
function createRateLimitMiddleware(options = {}) {
    const {
        limitType = 'general',
        requireAuth = false,
        getUserId = null
    } = options;

    return async function rateLimitMiddleware(context, req, next) {
        try {
            // Get user ID if authentication is required
            let userId = null;
            if (requireAuth && getUserId) {
                userId = await getUserId(req);
            }

            // Check rate limiting
            const rateLimitResult = await checkRateLimit(req, {
                limitType,
                userId
            });

            // If rate limited, respond immediately
            if (!rateLimitResult.allowed) {
                applyRateLimitResponse(context, req, rateLimitResult);
                return;
            }

            // Add rate limit headers to successful responses
            context.rateLimitHeaders = rateLimitResult.headers;

            // Continue to next middleware or handler
            if (next) {
                await next();
            }

        } catch (error) {
            console.error('Rate limit middleware error:', error);
            // Allow request to proceed if rate limiting fails
            if (next) {
                await next();
            }
        }
    };
}

/**
 * Specific rate limiting middleware for different endpoint types
 */
const rateLimitMiddleware = {
    // General endpoints (100 requests/minute per IP)
    general: createRateLimitMiddleware({
        limitType: 'general'
    }),

    // Signup endpoints (5 requests/hour per IP)
    signup: createRateLimitMiddleware({
        limitType: 'signup'
    }),

    // Payment endpoints (10 requests/hour per IP)
    payment: createRateLimitMiddleware({
        limitType: 'payment'
    }),

    // Authentication endpoints (50 requests/hour per IP)
    auth: createRateLimitMiddleware({
        limitType: 'auth'
    }),

    // Webhook endpoints (1000 requests/minute per IP)
    webhook: createRateLimitMiddleware({
        limitType: 'webhook'
    }),

    // Authenticated endpoints (with user rate limiting)
    authenticated: (getUserIdFn) => createRateLimitMiddleware({
        limitType: 'general',
        requireAuth: true,
        getUserId: getUserIdFn
    })
};

/**
 * Apply rate limiting to Azure Function
 * @param {Object} context - Azure Function context
 * @param {Object} req - Request object
 * @param {Function} handler - Main endpoint handler
 * @param {Object} options - Rate limiting options
 */
async function withRateLimit(context, req, handler, options = {}) {
    const middleware = createRateLimitMiddleware(options);
    
    let handlerCalled = false;
    
    await middleware(context, req, async () => {
        handlerCalled = true;
        await handler(context, req);
    });
    
    // If handler was called, ensure rate limit headers are applied
    if (handlerCalled && context.rateLimitHeaders && context.res) {
        context.res.headers = {
            ...context.res.headers,
            ...context.rateLimitHeaders
        };
    }
}

/**
 * Rate limiting decorator for Azure Functions
 * @param {Object} options - Rate limiting options
 * @returns {Function} - Decorator function
 */
function rateLimit(options = {}) {
    return function(target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function(context, req) {
            await withRateLimit(context, req, originalMethod, options);
        };
        
        return descriptor;
    };
}

/**
 * Simple rate limiting wrapper for Azure Functions
 * @param {Function} handler - Original Azure Function handler
 * @param {Object} options - Rate limiting options
 * @returns {Function} - Wrapped handler
 */
function withRateLimitWrapper(handler, options = {}) {
    return async function(context, req) {
        await withRateLimit(context, req, handler, options);
    };
}

/**
 * Get user ID from JWT token (example implementation)
 * @param {Object} req - Request object
 * @returns {string|null} - User ID or null
 */
async function getUserIdFromJWT(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        
        const token = authHeader.substring(7);
        // This would need to be implemented with your JWT verification logic
        // For now, returning null to indicate no user ID available
        return null;
        
    } catch (error) {
        console.error('Error extracting user ID from JWT:', error);
        return null;
    }
}

/**
 * Get user ID from Azure AD token (example implementation)
 * @param {Object} req - Request object
 * @returns {string|null} - User ID or null
 */
async function getUserIdFromAzureAD(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        
        // This would need to be implemented with your Azure AD verification logic
        // For now, returning null to indicate no user ID available
        return null;
        
    } catch (error) {
        console.error('Error extracting user ID from Azure AD token:', error);
        return null;
    }
}

module.exports = {
    createRateLimitMiddleware,
    rateLimitMiddleware,
    withRateLimit,
    withRateLimitWrapper,
    rateLimit,
    getUserIdFromJWT,
    getUserIdFromAzureAD
};