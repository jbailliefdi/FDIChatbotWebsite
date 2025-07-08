const { 
    createQuestionLog, 
    updateQuestionLogResponse, 
    updateQuestionLogErrors, 
    updateQuestionLogModels 
} = require('../utils/logService');

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
            
            if (!conversationid || !userid || !submitTimestamp) {
                context.res.status = 400;
                context.res.body = { error: 'Missing required fields: conversationid, userid, submitTimestamp' };
                return;
            }

            const questionId = await createQuestionLog(conversationid, userid, submitTimestamp, modelChoices);
            
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

        // Invalid action
        context.res.status = 400;
        context.res.body = { error: 'Invalid action. Supported actions: create, update-response, update-errors, update-models' };
        
    } catch (error) {
        context.log.error('Error in bot logging API:', error.message);
        context.res.status = 500;
        context.res.body = { 
            error: 'Internal server error',
            message: 'Service temporarily unavailable'
        };
    }
};