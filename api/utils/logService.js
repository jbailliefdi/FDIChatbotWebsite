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

module.exports = {
    createQuestionLog,
    updateQuestionLogResponse,
    updateQuestionLogErrors,
    updateQuestionLogModels,
    updateQuestionLogTokens
};