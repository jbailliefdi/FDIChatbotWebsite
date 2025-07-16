/**
 * Enhanced Rate Limiting System with IP-based Protection and DDoS Mitigation
 * Provides comprehensive protection against various attack vectors
 */

const { CosmosClient } = require('@azure/cosmos');
const { sanitizeHttpHeader } = require('./security');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const usersContainer = database.container('users');

// Rate limiting configuration
const RATE_LIMITS = {
    // Monthly limits (existing)
    monthly: {
        authenticated: 50,
        window: 30 * 24 * 60 * 60 * 1000 // 30 days
    },
    
    // Burst protection limits
    burst: {
        perSecond: 10,
        perMinute: 100,
        perHour: 1000,
        perDay: 10000
    },
    
    // IP-based limits
    ip: {
        general: { requests: 100, window: 60 * 1000 }, // 100 per minute
        signup: { requests: 5, window: 60 * 60 * 1000 }, // 5 per hour
        payment: { requests: 10, window: 60 * 60 * 1000 }, // 10 per hour
        auth: { requests: 50, window: 60 * 60 * 1000 }, // 50 per hour
        webhook: { requests: 1000, window: 60 * 1000 } // 1000 per minute
    },
    
    // Progressive penalties
    penalties: {
        firstViolation: 60 * 1000,      // 1 minute
        secondViolation: 5 * 60 * 1000, // 5 minutes
        thirdViolation: 15 * 60 * 1000, // 15 minutes
        subsequentViolations: 60 * 60 * 1000 // 1 hour
    }
};

// In-memory storage for short-term rate limiting (would use Redis in production)
const memoryStore = {
    ip: new Map(),
    burst: new Map(),
    penalties: new Map()
};

/**
 * Get client IP address from Azure Function request
 */
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const realIP = req.headers['x-real-ip'];
    const azureClientIP = req.headers['x-azure-clientip'];
    
    return sanitizeHttpHeader(forwarded || realIP || azureClientIP || 'unknown');
}

/**
 * Check if IP is currently blocked due to penalties
 */
function isIPBlocked(ip) {
    const penalty = memoryStore.penalties.get(ip);
    if (!penalty) return false;
    
    const now = Date.now();
    if (now > penalty.unblockTime) {
        memoryStore.penalties.delete(ip);
        return false;
    }
    
    return true;
}

/**
 * Apply progressive penalty to IP
 */
function applyPenalty(ip) {
    const now = Date.now();
    const existing = memoryStore.penalties.get(ip);
    
    let violationCount = 1;
    let penaltyDuration = RATE_LIMITS.penalties.firstViolation;
    
    if (existing) {
        violationCount = existing.violationCount + 1;
        switch (violationCount) {
            case 2:
                penaltyDuration = RATE_LIMITS.penalties.secondViolation;
                break;
            case 3:
                penaltyDuration = RATE_LIMITS.penalties.thirdViolation;
                break;
            default:
                penaltyDuration = RATE_LIMITS.penalties.subsequentViolations;
        }
    }
    
    memoryStore.penalties.set(ip, {
        violationCount,
        unblockTime: now + penaltyDuration,
        blockedAt: now
    });
    
    return {
        blocked: true,
        violationCount,
        unblockTime: now + penaltyDuration,
        retryAfter: Math.ceil(penaltyDuration / 1000)
    };
}

/**
 * Check IP-based rate limiting
 */
function checkIPRateLimit(ip, limitType = 'general') {
    if (isIPBlocked(ip)) {
        const penalty = memoryStore.penalties.get(ip);
        return {
            allowed: false,
            rateLimited: true,
            reason: 'IP_BLOCKED',
            retryAfter: Math.ceil((penalty.unblockTime - Date.now()) / 1000),
            violationCount: penalty.violationCount
        };
    }
    
    const now = Date.now();
    const limit = RATE_LIMITS.ip[limitType];
    const key = `${ip}:${limitType}`;
    
    let bucket = memoryStore.ip.get(key);
    if (!bucket) {
        bucket = {
            requests: 0,
            windowStart: now,
            lastRequest: now
        };
        memoryStore.ip.set(key, bucket);
    }
    
    // Reset window if expired
    if (now - bucket.windowStart > limit.window) {
        bucket.requests = 0;
        bucket.windowStart = now;
    }
    
    // Check if limit exceeded
    if (bucket.requests >= limit.requests) {
        const penalty = applyPenalty(ip);
        return {
            allowed: false,
            rateLimited: true,
            reason: 'IP_RATE_LIMIT_EXCEEDED',
            limit: limit.requests,
            window: limit.window,
            retryAfter: penalty.retryAfter,
            violationCount: penalty.violationCount
        };
    }
    
    // Increment counter
    bucket.requests++;
    bucket.lastRequest = now;
    
    return {
        allowed: true,
        rateLimited: false,
        remaining: limit.requests - bucket.requests,
        resetTime: bucket.windowStart + limit.window
    };
}

/**
 * Check burst protection (requests per second/minute)
 */
function checkBurstProtection(ip) {
    const now = Date.now();
    const key = `${ip}:burst`;
    
    let bucket = memoryStore.burst.get(key);
    if (!bucket) {
        bucket = {
            requests: [],
            lastCleanup: now
        };
        memoryStore.burst.set(key, bucket);
    }
    
    // Clean old requests (older than 1 minute)
    if (now - bucket.lastCleanup > 60000) {
        bucket.requests = bucket.requests.filter(time => now - time < 60000);
        bucket.lastCleanup = now;
    }
    
    // Check per-second limit
    const secondAgo = now - 1000;
    const recentRequests = bucket.requests.filter(time => time > secondAgo);
    
    if (recentRequests.length >= RATE_LIMITS.burst.perSecond) {
        const penalty = applyPenalty(ip);
        return {
            allowed: false,
            rateLimited: true,
            reason: 'BURST_LIMIT_EXCEEDED',
            limit: RATE_LIMITS.burst.perSecond,
            window: 1000,
            retryAfter: penalty.retryAfter
        };
    }
    
    // Check per-minute limit
    const minuteAgo = now - 60000;
    const minuteRequests = bucket.requests.filter(time => time > minuteAgo);
    
    if (minuteRequests.length >= RATE_LIMITS.burst.perMinute) {
        const penalty = applyPenalty(ip);
        return {
            allowed: false,
            rateLimited: true,
            reason: 'BURST_LIMIT_EXCEEDED',
            limit: RATE_LIMITS.burst.perMinute,
            window: 60000,
            retryAfter: penalty.retryAfter
        };
    }
    
    // Add current request
    bucket.requests.push(now);
    
    return {
        allowed: true,
        rateLimited: false,
        remaining: RATE_LIMITS.burst.perSecond - recentRequests.length - 1
    };
}

/**
 * Comprehensive rate limiting check
 */
async function checkRateLimit(req, options = {}) {
    const ip = getClientIP(req);
    const limitType = options.limitType || 'general';
    const userId = options.userId;
    
    const result = {
        allowed: true,
        rateLimited: false,
        ip: ip,
        checks: {
            ipBlocked: false,
            ipRateLimit: null,
            burstProtection: null,
            userRateLimit: null
        },
        headers: {}
    };
    
    try {
        // 1. Check if IP is blocked
        if (isIPBlocked(ip)) {
            const penalty = memoryStore.penalties.get(ip);
            result.allowed = false;
            result.rateLimited = true;
            result.reason = 'IP_BLOCKED';
            result.retryAfter = Math.ceil((penalty.unblockTime - Date.now()) / 1000);
            result.checks.ipBlocked = true;
            return result;
        }
        
        // 2. Check burst protection
        const burstCheck = checkBurstProtection(ip);
        result.checks.burstProtection = burstCheck;
        
        if (!burstCheck.allowed) {
            result.allowed = false;
            result.rateLimited = true;
            result.reason = burstCheck.reason;
            result.retryAfter = burstCheck.retryAfter;
            return result;
        }
        
        // 3. Check IP-based rate limiting
        const ipCheck = checkIPRateLimit(ip, limitType);
        result.checks.ipRateLimit = ipCheck;
        
        if (!ipCheck.allowed) {
            result.allowed = false;
            result.rateLimited = true;
            result.reason = ipCheck.reason;
            result.retryAfter = ipCheck.retryAfter;
            return result;
        }
        
        // 4. Check user-based rate limiting (if authenticated)
        if (userId) {
            try {
                const userCheck = await checkAndUpdateUserRateLimit(userId);
                result.checks.userRateLimit = userCheck;
                
                if (!userCheck.allowed) {
                    result.allowed = false;
                    result.rateLimited = true;
                    result.reason = 'USER_RATE_LIMIT_EXCEEDED';
                    result.userLimit = userCheck.limit;
                    result.userUsed = userCheck.questionsAsked;
                    result.userResetDate = userCheck.resetDate;
                }
            } catch (error) {
                console.error('User rate limit check failed:', error);
                // Continue without user rate limiting if check fails
            }
        }
        
        // 5. Set rate limiting headers
        result.headers = {
            'X-RateLimit-Limit': RATE_LIMITS.ip[limitType].requests,
            'X-RateLimit-Remaining': ipCheck.remaining || 0,
            'X-RateLimit-Reset': ipCheck.resetTime || Date.now() + RATE_LIMITS.ip[limitType].window,
            'X-RateLimit-Window': RATE_LIMITS.ip[limitType].window
        };
        
        if (result.retryAfter) {
            result.headers['Retry-After'] = result.retryAfter;
        }
        
        return result;
        
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // Allow request to proceed if rate limiting fails
        return {
            allowed: true,
            rateLimited: false,
            error: error.message
        };
    }
}

/**
 * Legacy user rate limiting (monthly)
 */
async function checkAndUpdateUserRateLimit(userId) {
    try {
        const userQuery = {
            query: "SELECT * FROM c WHERE c.id = @userId AND c.status = 'active'",
            parameters: [{ name: "@userId", value: userId }]
        };

        const { resources: users } = await usersContainer.items.query(userQuery).fetchAll();
        
        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        let resetDate = new Date(user.questionsResetDate || user.createdAt);
        let questionsAsked = user.questionsAsked || 0;
        
        // Initialize rate limiting fields if missing
        if (user.questionsAsked === undefined || user.questionsResetDate === undefined) {
            const currentDate = new Date();
            await usersContainer.item(user.id, user.organizationId).patch([
                { op: 'add', path: '/questionsAsked', value: 0 },
                { op: 'add', path: '/questionsResetDate', value: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1).toISOString() }
            ]);
        }
        
        // Reset counter if new month
        if (now >= resetDate) {
            questionsAsked = 0;
            resetDate = new Date(currentYear, currentMonth + 1, 1);
        }

        // Check monthly limit
        if (questionsAsked >= RATE_LIMITS.monthly.authenticated) {
            return {
                allowed: false,
                questionsAsked: questionsAsked,
                limit: RATE_LIMITS.monthly.authenticated,
                resetDate: new Date(currentYear, currentMonth + 1, 1).toISOString()
            };
        }

        // Increment counter
        const newQuestionsAsked = questionsAsked + 1;
        
        await usersContainer.item(user.id, user.organizationId).patch([
            { op: 'replace', path: '/questionsAsked', value: newQuestionsAsked },
            { op: 'replace', path: '/questionsResetDate', value: resetDate.toISOString() }
        ]);

        return {
            allowed: true,
            questionsAsked: newQuestionsAsked,
            limit: RATE_LIMITS.monthly.authenticated,
            resetDate: new Date(currentYear, currentMonth + 1, 1).toISOString()
        };

    } catch (error) {
        console.error('User rate limit check failed:', error);
        throw error;
    }
}

/**
 * Apply rate limiting to Azure Function response
 */
function applyRateLimitResponse(context, req, rateLimitResult) {
    const statusCode = rateLimitResult.allowed ? 200 : 429;
    const headers = {
        'Content-Type': 'application/json',
        ...rateLimitResult.headers
    };
    
    let body;
    if (rateLimitResult.allowed) {
        body = { success: true };
    } else {
        body = {
            error: 'Rate limit exceeded',
            message: getRateLimitMessage(rateLimitResult.reason),
            code: rateLimitResult.reason,
            retryAfter: rateLimitResult.retryAfter
        };
    }
    
    context.res = {
        status: statusCode,
        headers: headers,
        body: body
    };
}

/**
 * Get user-friendly rate limit message
 */
function getRateLimitMessage(reason) {
    switch (reason) {
        case 'IP_BLOCKED':
            return 'Your IP has been temporarily blocked due to repeated violations. Please try again later.';
        case 'IP_RATE_LIMIT_EXCEEDED':
            return 'Too many requests from your IP address. Please slow down and try again later.';
        case 'BURST_LIMIT_EXCEEDED':
            return 'You are sending requests too quickly. Please slow down.';
        case 'USER_RATE_LIMIT_EXCEEDED':
            return 'You have exceeded your monthly query limit. Please wait until next month or upgrade your plan.';
        default:
            return 'Rate limit exceeded. Please try again later.';
    }
}

/**
 * Clean up expired entries (should be called periodically)
 */
function cleanup() {
    const now = Date.now();
    
    // Clean IP rate limits
    for (const [key, bucket] of memoryStore.ip.entries()) {
        if (now - bucket.windowStart > RATE_LIMITS.ip.general.window * 2) {
            memoryStore.ip.delete(key);
        }
    }
    
    // Clean burst protection
    for (const [key, bucket] of memoryStore.burst.entries()) {
        if (now - bucket.lastCleanup > 300000) { // 5 minutes
            memoryStore.burst.delete(key);
        }
    }
    
    // Clean penalties
    for (const [key, penalty] of memoryStore.penalties.entries()) {
        if (now > penalty.unblockTime) {
            memoryStore.penalties.delete(key);
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

module.exports = {
    checkRateLimit,
    applyRateLimitResponse,
    checkAndUpdateUserRateLimit,
    getClientIP,
    isIPBlocked,
    RATE_LIMITS,
    cleanup
};