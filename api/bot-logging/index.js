const { 
    createQuestionLog, 
    updateQuestionLogResponse, 
    updateQuestionLogErrors, 
    updateQuestionLogModels,
    updateQuestionLogTokens,
    updateQuestionLogVectorSearchTime,
    updateQuestionLogTimings
} = require('../utils/logService');
const { checkAndUpdateRateLimit } = require('../utils/rateLimit');

module.exports = async function (context, req) {
    context.log('=== BOT LOGGING API CALLED ===');
    context.log('Method:', req.method);
    context.log('Action:', req.params.action);
    context.log('Body:', req.body);

    // CORS headers
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    try {
        const action = req.params.action;
        const method = req.method;

        if (method === 'POST' && action === 'create') {
            // Create new question log
            const { conversationid, userid, submitTimestamp, modelChoices } = req.body;
            
            if (!conversationid || !userid) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: conversationid, userid' };
                return;
            }

            // Check and update rate limit
            let rateLimitCheckTime = 0;
            try {
                context.log('=== RATE LIMIT CHECK ===');
                context.log('User ID for rate limit:', userid);
                const rateLimitStart = Date.now();
                const rateLimitResult = await checkAndUpdateRateLimit(userid);
                const rateLimitEnd = Date.now();
                rateLimitCheckTime = rateLimitEnd - rateLimitStart;
                context.log('Rate limit result:', rateLimitResult);
                
                if (!rateLimitResult.allowed) {
                    context.log.warn('Rate limit exceeded for user:', userid, 'Questions asked:', rateLimitResult.questionsAsked);
                    context.res.status = 429;
                    context.res.body = { 
                        error: 'Monthly query limit exceeded',
                        questionsAsked: rateLimitResult.questionsAsked,
                        limit: rateLimitResult.limit,
                        resetDate: rateLimitResult.resetDate
                    };
                    return;
                }
                
                context.log('Rate limit check passed. Questions asked:', rateLimitResult.questionsAsked, 'of', rateLimitResult.limit);
            } catch (rateLimitError) {
                context.log.error('Rate limit check failed:', rateLimitError.message);
                context.log.warn('Continuing with log creation despite rate limit failure');
                // Continue with log creation even if rate limit check fails
            }

            const currentTimestamp = submitTimestamp || new Date().toISOString();
            const dbWriteStart = Date.now();
            const questionId = await createQuestionLog(conversationid, userid, currentTimestamp, modelChoices);
            const dbWriteEnd = Date.now();
            const dbWriteTime = dbWriteEnd - dbWriteStart;
            
            if (questionId) {
                // Log the timing data for rate limit check and database write
                const timingData = {
                    rateLimitCheckTime: rateLimitCheckTime,
                    dbWriteTime: dbWriteTime
                };
                
                try {
                    await updateQuestionLogTimings(questionId, timingData);
                    context.log(`Initial timing data logged for question ${questionId}: ${JSON.stringify(timingData)}`);
                } catch (timingError) {
                    context.log.error('Error logging initial timing data:', timingError.message);
                }
                
                context.res.status = 200;
                context.res.body = { 
                    success: true, 
                    questionid: questionId,
                    message: 'Question log created successfully' 
                };
            } else {
                context.res.status = 500;
                context.res.body = { error: 'Failed to create question log' };
            }
            return;
        }

        if (method === 'PUT' && action === 'update-response') {
            // Update response timestamp
            const { questionid, responseTimestamp } = req.body;
            
            if (!questionid || !responseTimestamp) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid, responseTimestamp' };
                return;
            }

            await updateQuestionLogResponse(questionid, responseTimestamp);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log response updated successfully' 
            };
            return;
        }

        if (method === 'PUT' && action === 'update-errors') {
            // Update error codes
            const { questionid, errorCodes } = req.body;
            
            if (!questionid || !Array.isArray(errorCodes)) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid, errorCodes (array)' };
                return;
            }

            await updateQuestionLogErrors(questionid, errorCodes);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log errors updated successfully' 
            };
            return;
        }

        if (method === 'PUT' && action === 'update-models') {
            // Update model choices
            const { questionid, modelChoices } = req.body;
            
            if (!questionid || !Array.isArray(modelChoices)) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid, modelChoices (array)' };
                return;
            }

            await updateQuestionLogModels(questionid, modelChoices);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log models updated successfully' 
            };
            return;
        }

        if (method === 'PUT' && action === 'update-tokens') {
            // Update token counts
            const { questionid, userQueryTokens, botResponseTokens } = req.body;
            
            if (!questionid || (userQueryTokens === undefined && botResponseTokens === undefined)) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid and at least one of userQueryTokens, botResponseTokens' };
                return;
            }

            await updateQuestionLogTokens(questionid, userQueryTokens, botResponseTokens);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log tokens updated successfully' 
            };
            return;
        }

        if (method === 'PUT' && action === 'update-vector-search-time') {
            // Update vector search time
            const { questionid, vectorSearchTime } = req.body;
            
            if (!questionid || vectorSearchTime === undefined) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid, vectorSearchTime' };
                return;
            }

            await updateQuestionLogVectorSearchTime(questionid, vectorSearchTime);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log vector search time updated successfully' 
            };
            return;
        }

        if (method === 'PUT' && action === 'update-timings') {
            // Update multiple timing metrics
            const { questionid, timingData } = req.body;
            
            if (!questionid || !timingData || typeof timingData !== 'object') {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: questionid, timingData (object)' };
                return;
            }

            await updateQuestionLogTimings(questionid, timingData);
            
            context.res.status = 200;
            context.res.body = { 
                success: true, 
                message: 'Question log timings updated successfully' 
            };
            return;
        }

        if (method === 'GET' && action === 'query') {
            // Query for recent logs
            const { conversationid, userid, limit = 10 } = req.query;
            
            if (!conversationid || !userid) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required query parameters: conversationid, userid' };
                return;
            }

            try {
                const { queryLogs } = require('../utils/logService');
                const logs = await queryLogs(conversationid, userid, parseInt(limit));
                
                context.res.status = 200;
                context.res.body = { 
                    success: true, 
                    logs: logs || [],
                    message: 'Logs queried successfully' 
                };
            } catch (queryError) {
                context.log.error('Error querying logs:', queryError.message);
                context.res.status = 500;
                context.res.body = { error: 'Failed to query logs' };
            }
            return;
        }

        // Invalid action
        context.res.status = 400;
        context.res.body = { error: 'Invalid action. Supported actions: create, update-response, update-errors, update-models, update-tokens, update-vector-search-time, update-timings, query' };
        
    } catch (error) {
        context.log.error('Error in bot logging API:', error.message);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: 'Service temporarily unavailable'
        };
    }
};