/**
 * Security Utilities
 * Comprehensive security functions for input validation, sanitization, and output encoding
 */

/**
 * HTML escape function to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - HTML-escaped text
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    
    return text.replace(/[&<>"'\/]/g, function(match) {
        return htmlEscapes[match];
    });
}

/**
 * Enhanced input sanitization for general use
 * @param {string} input - Input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Remove potential injection patterns and dangerous characters
    return input.replace(/[<>\"'%;()&+${}[\]\\]/g, '').trim();
}

/**
 * Email header sanitization to prevent header injection
 * @param {string} input - Input to sanitize for email headers
 * @returns {string} - Sanitized input safe for email headers
 */
function sanitizeEmailHeader(input) {
    if (typeof input !== 'string') return '';
    // Remove CRLF and control characters
    return input.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim();
}

/**
 * Domain validation for database queries
 * @param {string} domain - Domain to validate
 * @returns {boolean} - True if domain is valid
 */
function validateDomain(domain) {
    if (typeof domain !== 'string') return false;
    // Basic domain validation - alphanumeric, dots, and hyphens only
    return /^[a-zA-Z0-9.-]+$/.test(domain) && domain.length > 0 && domain.length <= 253;
}

/**
 * URL origin validation against whitelist
 * @param {string} origin - Origin to validate
 * @param {Array} allowedOrigins - Array of allowed origins
 * @returns {boolean} - True if origin is allowed
 */
function validateOrigin(origin, allowedOrigins = []) {
    if (typeof origin !== 'string') return false;
    return allowedOrigins.includes(origin);
}

/**
 * Email format validation
 * @param {string} email - Email to validate
 * @returns {boolean} - True if email format is valid
 */
function validateEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Name validation (letters, spaces, hyphens, apostrophes only)
 * @param {string} name - Name to validate
 * @returns {boolean} - True if name is valid
 */
function validateName(name) {
    if (typeof name !== 'string') return false;
    return /^[a-zA-Z\s\-']+$/.test(name) && name.length > 0 && name.length <= 100;
}

/**
 * UUID validation
 * @param {string} uuid - UUID to validate
 * @returns {boolean} - True if UUID is valid
 */
function validateUUID(uuid) {
    if (typeof uuid !== 'string') return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

/**
 * Phone number validation (international format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if phone number is valid
 */
function validatePhone(phone) {
    if (typeof phone !== 'string') return false;
    // Remove all non-digit characters for validation
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

/**
 * Numeric validation with optional decimal places
 * @param {string} value - Value to validate
 * @param {number} maxDecimals - Maximum decimal places (default: 2)
 * @returns {boolean} - True if value is valid number
 */
function validateNumeric(value, maxDecimals = 2) {
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    const numericRegex = new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`);
    return numericRegex.test(value.toString());
}

/**
 * Organization name validation
 * @param {string} orgName - Organization name to validate
 * @returns {boolean} - True if organization name is valid
 */
function validateOrganizationName(orgName) {
    if (typeof orgName !== 'string') return false;
    // Allow alphanumeric, spaces, hyphens, apostrophes, and common business characters
    return /^[a-zA-Z0-9\s\-'&.,()]+$/.test(orgName) && orgName.length > 0 && orgName.length <= 200;
}

/**
 * Server-side form validation to match client-side validation
 * @param {Object} formData - Form data to validate
 * @returns {Object} - Validation result with errors array
 */
function validateFormData(formData) {
    const errors = [];
    
    // Company name validation
    if (!formData.companyName || typeof formData.companyName !== 'string') {
        errors.push('Company name is required');
    } else {
        const trimmed = formData.companyName.trim();
        if (trimmed.length < 2) {
            errors.push('Company name must be at least 2 characters');
        } else if (trimmed.length > 100) {
            errors.push('Company name must be less than 100 characters');
        } else if (/[<>{}\[\]"'&;]/.test(trimmed)) {
            errors.push('Company name contains invalid characters');
        }
    }
    
    // First name validation
    if (!formData.firstName || typeof formData.firstName !== 'string') {
        errors.push('First name is required');
    } else {
        const trimmed = formData.firstName.trim();
        if (trimmed.length < 1) {
            errors.push('First name is required');
        } else if (trimmed.length > 50) {
            errors.push('First name must be less than 50 characters');
        } else if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
            errors.push('First name can only contain letters, spaces, hyphens, and apostrophes');
        }
    }
    
    // Last name validation
    if (!formData.lastName || typeof formData.lastName !== 'string') {
        errors.push('Last name is required');
    } else {
        const trimmed = formData.lastName.trim();
        if (trimmed.length < 1) {
            errors.push('Last name is required');
        } else if (trimmed.length > 50) {
            errors.push('Last name must be less than 50 characters');
        } else if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
            errors.push('Last name can only contain letters, spaces, hyphens, and apostrophes');
        }
    }
    
    // Email validation
    if (!formData.email || typeof formData.email !== 'string') {
        errors.push('Email address is required');
    } else if (!validateEmail(formData.email)) {
        errors.push('Please enter a valid email address');
    }
    
    // License count validation
    if (!formData.licenseCount || typeof formData.licenseCount !== 'number') {
        errors.push('License count is required');
    } else {
        const num = parseInt(formData.licenseCount);
        if (isNaN(num) || num < 1) {
            errors.push('License count must be at least 1');
        } else if (num > 1000) {
            errors.push('Please contact us for enterprise pricing (1000+ users)');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Content Security Policy nonce generator
 * @returns {string} - Random nonce for CSP
 */
function generateCSPNonce() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Safe JSON parse with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} - Parsed JSON or default value
 */
function safeJsonParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * Rate limiting key generator
 * @param {string} identifier - User identifier
 * @param {string} action - Action being performed
 * @returns {string} - Rate limiting key
 */
function generateRateLimitKey(identifier, action) {
    return `${sanitizeInput(identifier)}:${sanitizeInput(action)}`;
}

/**
 * HTTP header sanitization to prevent header injection
 * @param {string} input - Input to sanitize for HTTP headers
 * @returns {string} - Sanitized input safe for HTTP headers
 */
function sanitizeHttpHeader(input) {
    if (typeof input !== 'string') return '';
    // Remove CRLF, control characters, and dangerous characters
    return input.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim();
}

/**
 * URL validation with protocol and domain checks
 * @param {string} url - URL to validate
 * @param {Array} allowedProtocols - Allowed protocols (default: ['http:', 'https:'])
 * @returns {boolean} - True if URL is valid and safe
 */
function validateUrl(url, allowedProtocols = ['http:', 'https:']) {
    if (typeof url !== 'string') return false;
    
    try {
        const urlObj = new URL(url);
        
        // Check protocol
        if (!allowedProtocols.includes(urlObj.protocol)) {
            return false;
        }
        
        // Check for dangerous patterns
        if (url.includes('javascript:') || url.includes('data:') || url.includes('vbscript:')) {
            return false;
        }
        
        // Basic domain validation
        if (!validateDomain(urlObj.hostname)) {
            return false;
        }
        
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Safe origin validation with fallback
 * @param {string} origin - Origin to validate
 * @param {Array} allowedOrigins - Array of allowed origins
 * @param {string} fallbackOrigin - Fallback origin if validation fails
 * @returns {string} - Validated origin or fallback
 */
function validateOriginWithFallback(origin, allowedOrigins = [], fallbackOrigin = '') {
    if (typeof origin !== 'string' || !origin) {
        return fallbackOrigin;
    }
    
    // Sanitize the origin first
    const sanitizedOrigin = sanitizeHttpHeader(origin);
    
    // Validate URL format
    if (!validateUrl(sanitizedOrigin)) {
        return fallbackOrigin;
    }
    
    // Check against whitelist
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(sanitizedOrigin)) {
        return fallbackOrigin;
    }
    
    return sanitizedOrigin;
}

module.exports = {
    escapeHtml,
    sanitizeInput,
    sanitizeEmailHeader,
    sanitizeHttpHeader,
    validateDomain,
    validateOrigin,
    validateOriginWithFallback,
    validateUrl,
    validateEmail,
    validateName,
    validateUUID,
    validatePhone,
    validateNumeric,
    validateOrganizationName,
    validateFormData,
    generateCSPNonce,
    safeJsonParse,
    generateRateLimitKey
};