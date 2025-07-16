/**
 * Client-Side Security Utilities
 * JavaScript security functions for frontend protection
 */

/**
 * HTML escape function to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - HTML-escaped text
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Create text node safely (alternative to innerHTML)
 * @param {string} text - Text to create node from
 * @returns {Text} - Text node
 */
function createTextNode(text) {
    return document.createTextNode(text || '');
}

/**
 * Safely set element text content
 * @param {Element} element - Element to set text on
 * @param {string} text - Text to set
 */
function setElementText(element, text) {
    if (element && element.textContent !== undefined) {
        element.textContent = text || '';
    }
}

/**
 * Safely create HTML element with text content
 * @param {string} tagName - Tag name to create
 * @param {string} textContent - Text content for the element
 * @param {Object} attributes - Attributes to set on element
 * @returns {Element} - Created element
 */
function createSafeElement(tagName, textContent = '', attributes = {}) {
    const element = document.createElement(tagName);
    
    if (textContent) {
        element.textContent = textContent;
    }
    
    for (const [key, value] of Object.entries(attributes)) {
        if (typeof value === 'string') {
            element.setAttribute(key, value);
        }
    }
    
    return element;
}

/**
 * Safely append multiple elements to a parent
 * @param {Element} parent - Parent element
 * @param {Array} children - Array of child elements
 */
function safeAppendChildren(parent, children) {
    if (!parent || !Array.isArray(children)) return;
    
    children.forEach(child => {
        if (child && child.nodeType) {
            parent.appendChild(child);
        }
    });
}

/**
 * Input sanitization for client-side validation
 * @param {string} input - Input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>\"'%;()&+${}[\]\\]/g, '').trim();
}

/**
 * Email validation
 * @param {string} email - Email to validate
 * @returns {boolean} - True if email is valid
 */
function validateEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Name validation
 * @param {string} name - Name to validate
 * @returns {boolean} - True if name is valid
 */
function validateName(name) {
    if (typeof name !== 'string') return false;
    return /^[a-zA-Z\s\-']+$/.test(name) && name.length > 0 && name.length <= 100;
}

/**
 * Phone number validation
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if phone is valid
 */
function validatePhone(phone) {
    if (typeof phone !== 'string') return false;
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

/**
 * Show validation error safely
 * @param {string} fieldName - Field name
 * @param {string} message - Error message
 */
function showValidationError(fieldName, message) {
    const errorDiv = document.getElementById(fieldName + 'Error');
    if (errorDiv) {
        setElementText(errorDiv, message);
        errorDiv.className = 'validation-message error';
        errorDiv.style.display = 'block';
    }
}

/**
 * Show validation success safely
 * @param {string} fieldName - Field name
 * @param {string} message - Success message
 */
function showValidationSuccess(fieldName, message = '') {
    const errorDiv = document.getElementById(fieldName + 'Error');
    if (errorDiv) {
        setElementText(errorDiv, message);
        errorDiv.className = 'validation-message success';
        errorDiv.style.display = message ? 'block' : 'none';
    }
}

/**
 * Show form errors safely
 * @param {Array} errors - Array of error messages
 * @param {string} containerId - Container ID for errors
 */
function showFormErrors(errors, containerId = 'formErrors') {
    const errorContainer = document.getElementById(containerId);
    const errorsList = document.getElementById(containerId + 'List');
    
    if (!errorContainer || !errorsList) return;
    
    if (errors.length > 0) {
        // Clear existing errors
        errorsList.innerHTML = '';
        
        // Add new errors safely
        errors.forEach(error => {
            const li = createSafeElement('li', error);
            errorsList.appendChild(li);
        });
        
        errorContainer.classList.add('show');
    } else {
        errorContainer.classList.remove('show');
    }
}

/**
 * Clear form errors
 * @param {string} containerId - Container ID for errors
 */
function clearFormErrors(containerId = 'formErrors') {
    const errorContainer = document.getElementById(containerId);
    if (errorContainer) {
        errorContainer.classList.remove('show');
    }
}

/**
 * Debounce function to limit function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Safe event listener addition
 * @param {Element} element - Element to add listener to
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 */
function addSafeEventListener(element, event, handler) {
    if (element && typeof handler === 'function') {
        element.addEventListener(event, handler);
    }
}

/**
 * Get safe URL parameter
 * @param {string} name - Parameter name
 * @returns {string|null} - Parameter value or null
 */
function getSafeURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    const value = urlParams.get(name);
    return value ? sanitizeInput(value) : null;
}

/**
 * Safe JSON parse
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} - Parsed JSON or default value
 */
function safeJsonParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error('JSON parse error:', e);
        return defaultValue;
    }
}

// Export functions for module usage (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        createTextNode,
        setElementText,
        createSafeElement,
        safeAppendChildren,
        sanitizeInput,
        validateEmail,
        validateName,
        validatePhone,
        showValidationError,
        showValidationSuccess,
        showFormErrors,
        clearFormErrors,
        debounce,
        addSafeEventListener,
        getSafeURLParameter,
        safeJsonParse
    };
}