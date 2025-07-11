const { 
    createQuestionLog, 
    updateQuestionLogResponse, 
    updateQuestionLogErrors, 
    updateQuestionLogModels,
    updateQuestionLogTokens
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

        if (method === 'POST' && action === 'check-rate-limit') {
            // Check and increment rate limit
            const { userId } = req.body;
            
            if (!userId) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required field: userId' };
                return;
            }

            try {
                context.log('=== RATE LIMIT CHECK (BOT BACKEND) ===');
                context.log('User ID for rate limit:', userId);
                const rateLimitResult = await checkAndUpdateRateLimit(userId);
                context.log('Rate limit result:', rateLimitResult);
                
                if (rateLimitResult.allowed) {
                    context.res.status = 200;
                    context.res.body = rateLimitResult;
                } else {
                    context.res.status = 429;
                    context.res.body = rateLimitResult;
                }
                return;
            } catch (rateLimitError) {
                context.log.error('Rate limit check failed:', rateLimitError.message);
                context.res.status = 500;
                context.res.body = { error: 'Rate limit check failed' };
                return;
            }
        }

        if (method === 'POST' && action === 'create') {
            // Create new question log
            const { conversationid, userid, submitTimestamp, modelChoices } = req.body;
            
            if (!conversationid || !userid) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: conversationid, userid' };
                return;
            }

            // Check and update rate limit
            try {
                context.log('=== RATE LIMIT CHECK ===');
                context.log('User ID for rate limit:', userid);
                const rateLimitResult = await checkAndUpdateRateLimit(userid);
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
                context.res.status = 500;
                context.res.body = { error: 'Rate limit check failed' };
                return;
            }

            const currentTimestamp = submitTimestamp || new Date().toISOString();
            const questionId = await createQuestionLog(conversationid, userid, currentTimestamp, modelChoices);
            
            if (questionId) {
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

        // Invalid action
        context.res.status = 400;
        context.res.body = { error: 'Invalid action. Supported actions: check-rate-limit, create, update-response, update-errors, update-models, update-tokens' };
        
    } catch (error) {
        context.log.error('Error in bot logging API:', error.message);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: 'Service temporarily unavailable'
        };
    }
};