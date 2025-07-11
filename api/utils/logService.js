const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

// Initialize Cosmos DB client for logging
let cosmosClient, database, logsContainer;

try {
    if (process.env.COSMOS_DB_CONNECTION_STRING) {
        cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
        database = cosmosClient.database('fdi-chatbot');
        logsContainer = database.container('logs');
        console.log('Cosmos DB logging service initialized successfully');
    } else {
        console.warn('COSMOS_DB_CONNECTION_STRING not found. Logging will be disabled.');
    }
} catch (error) {
    console.error('Failed to initialize Cosmos DB logging client:', error.message);
}

/**
 * Creates a new question log entry
 * @param {string} conversationId - The conversation ID
 * @param {string} userId - The user ID
 * @param {string} submitTimestamp - ISO timestamp when question was submitted
 * @param {Array} modelChoices - Array of model choices used
 * @returns {string} The unique question ID
 */
async function createQuestionLog(conversationId, userId, submitTimestamp, modelChoices = []) {
    if (!logsContainer) {
        console.warn('Logs container not available, skipping log creation');
        return null;
    }

    const questionId = uuidv4();
    
    try {
        const logEntry = {
            id: questionId,
            questionid: questionId,
            conversationid: conversationId,
            userid: userId,
            submitTimestamp: submitTimestamp,
            responseTimestamp: null,
            modelChoices: modelChoices,
            errorCodes: [],
            userQueryTokens: null,
            botResponseTokens: null
        };

        await logsContainer.items.create(logEntry);
        console.log(`Question log created with ID: ${questionId}`);
        return questionId;
    } catch (error) {
        console.error('Error creating question log:', error.message);
        return null;
    }
}

/**
 * Updates a question log with response timestamp
 * @param {string} questionId - The question ID to update
 * @param {string} responseTimestamp - ISO timestamp when response was sent
 */
async function updateQuestionLogResponse(questionId, responseTimestamp) {
    if (!logsContainer || !questionId) {
        console.warn('Logs container not available or questionId missing, skipping response update');
        return;
    }

    try {
        // Get the existing log entry
        const { resource: logEntry } = await logsContainer.item(questionId, questionId).read();
        
        if (logEntry) {
            logEntry.responseTimestamp = responseTimestamp;
            await logsContainer.item(questionId, questionId).replace(logEntry);
            console.log(`Question log ${questionId} updated with response timestamp`);
        }
    } catch (error) {
        console.error('Error updating question log response:', error.message);
    }
}

/**
 * Updates a question log with error codes
 * @param {string} questionId - The question ID to update
 * @param {Array} errorCodes - Array of error codes to add
 */
async function updateQuestionLogErrors(questionId, errorCodes) {
    if (!logsContainer || !questionId) {
        console.warn('Logs container not available or questionId missing, skipping error update');
        return;
    }

    try {
        // Get the existing log entry
        const { resource: logEntry } = await logsContainer.item(questionId, questionId).read();
        
        if (logEntry) {
            logEntry.errorCodes = [...(logEntry.errorCodes || []), ...errorCodes];
            await logsContainer.item(questionId, questionId).replace(logEntry);
            console.log(`Question log ${questionId} updated with error codes:`, errorCodes);
        }
    } catch (error) {
        console.error('Error updating question log errors:', error.message);
    }
}

/**
 * Updates a question log with model choices
 * @param {string} questionId - The question ID to update
 * @param {Array} modelChoices - Array of model choices used
 */
async function updateQuestionLogModels(questionId, modelChoices) {
    if (!logsContainer || !questionId) {
        console.warn('Logs container not available or questionId missing, skipping model update');
        return;
    }

    try {
        // Get the existing log entry
        const { resource: logEntry } = await logsContainer.item(questionId, questionId).read();
        
        if (logEntry) {
            logEntry.modelChoices = modelChoices;
            await logsContainer.item(questionId, questionId).replace(logEntry);
            console.log(`Question log ${questionId} updated with model choices:`, modelChoices);
        }
    } catch (error) {
        console.error('Error updating question log models:', error.message);
    }
}

/**
 * Updates a question log with token counts
 * @param {string} questionId - The question ID to update
 * @param {number} userQueryTokens - Token count for user query
 * @param {number} botResponseTokens - Token count for bot response
 */
async function updateQuestionLogTokens(questionId, userQueryTokens, botResponseTokens) {
    if (!logsContainer || !questionId) {
        console.warn('Logs container not available or questionId missing, skipping token update');
        return;
    }

    try {
        // Get the existing log entry
        const { resource: logEntry } = await logsContainer.item(questionId, questionId).read();
        
        if (logEntry) {
            if (userQueryTokens !== null) logEntry.userQueryTokens = userQueryTokens;
            if (botResponseTokens !== null) logEntry.botResponseTokens = botResponseTokens;
            await logsContainer.item(questionId, questionId).replace(logEntry);
            console.log(`Question log ${questionId} updated with token counts - Query: ${userQueryTokens}, Response: ${botResponseTokens}`);
        }
    } catch (error) {
        console.error('Error updating question log tokens:', error.message);
    }
}

/**
 * Query logs for a specific conversation and user
 * @param {string} conversationId - The conversation ID
 * @param {string} userId - The user ID
 * @param {number} limit - Maximum number of logs to return
 * @returns {Array} Array of log entries
 */
async function queryLogs(conversationId, userId, limit = 10) {
    if (!logsContainer) {
        console.warn('Logs container not available, cannot query logs');
        return [];
    }

    try {
        const querySpec = {
            query: "SELECT * FROM c WHERE c.conversationid = @conversationId AND c.userid = @userId ORDER BY c.submitTimestamp DESC OFFSET 0 LIMIT @limit",
            parameters: [
                {
                    name: "@conversationId",
                    value: conversationId
                },
                {
                    name: "@userId", 
                    value: userId
                },
                {
                    name: "@limit",
                    value: limit
                }
            ]
        };

        const { resources: logs } = await logsContainer.items.query(querySpec).fetchAll();
        console.log(`Found ${logs.length} logs for conversation ${conversationId} and user ${userId}`);
        return logs;
    } catch (error) {
        console.error('Error querying logs:', error.message);
        return [];
    }
}

/**
 * Query recent logs for a conversation regardless of user ID
 * Used to find logs created by frontend when backend has different user ID
 * @param {string} conversationId - The conversation ID
 * @param {number} minutesBack - How many minutes back to look for logs
 * @returns {Array} Array of log entries
 */
async function queryRecentLogsByConversation(conversationId, minutesBack = 5) {
    if (!logsContainer) {
        console.warn('Logs container not available, cannot query logs');
        return [];
    }

    try {
        // Calculate timestamp for X minutes ago
        const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000).toISOString();
        
        const querySpec = {
            query: "SELECT * FROM c WHERE c.conversationid = @conversationId AND c.submitTimestamp > @cutoffTime ORDER BY c.submitTimestamp DESC OFFSET 0 LIMIT 10",
            parameters: [
                {
                    name: "@conversationId",
                    value: conversationId
                },
                {
                    name: "@cutoffTime",
                    value: cutoffTime
                }
            ]
        };

        const { resources: logs } = await logsContainer.items.query(querySpec).fetchAll();
        console.log(`Found ${logs.length} recent logs for conversation ${conversationId} in last ${minutesBack} minutes`);
        return logs;
    } catch (error) {
        console.error('Error querying recent logs by conversation:', error.message);
        return [];
    }
}

/**
 * Updates a question log with correct user ID
 * @param {string} questionId - The question ID to update
 * @param {string} userId - The correct user ID to set
 */
async function updateQuestionLogUserId(questionId, userId) {
    if (!logsContainer || !questionId) {
        console.warn('Logs container not available or questionId missing, skipping user ID update');
        return;
    }

    try {
        // Get the existing log entry
        const { resource: logEntry } = await logsContainer.item(questionId, questionId).read();
        
        if (logEntry) {
            const oldUserId = logEntry.userid;
            logEntry.userid = userId;
            await logsContainer.item(questionId, questionId).replace(logEntry);
            console.log(`Question log ${questionId} updated user ID from ${oldUserId} to ${userId}`);
        }
    } catch (error) {
        console.error('Error updating question log user ID:', error.message);
    }
}

module.exports = {
    createQuestionLog,
    updateQuestionLogResponse,
    updateQuestionLogErrors,
    updateQuestionLogModels,
    updateQuestionLogTokens,
    updateQuestionLogUserId,
    queryLogs,
    queryRecentLogsByConversation
};