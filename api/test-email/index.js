const { sendInviteEmail } = require('../utils/emailService');

module.exports = async function (context, req) {
    context.log('Test email function called');
    
    const { recipientEmail, testToken = 'test123', organizationName = 'Test Organization' } = req.body;
    
    if (!recipientEmail) {
        context.res = {
            status: 400,
            body: { error: 'Recipient email is required' }
        };
        return;
    }
    
    context.log('Environment variables check:', {
        SMTP_HOST: process.env.SMTP_HOST || 'Not set',
        SMTP_PORT: process.env.SMTP_PORT || 'Not set',
        SMTP_USER: process.env.SMTP_USER || 'Not set',
        SMTP_PASS: process.env.SMTP_PASS ? 'Set' : 'Not set',
        SMTP_FROM: process.env.SMTP_FROM || 'Not set'
    });
    
    try {
        const result = await sendInviteEmail(recipientEmail, testToken, organizationName);
        
        context.res = {
            status: 200,
            body: {
                success: result.success,
                messageId: result.messageId,
                error: result.error,
                details: result.details
            }
        };
        
    } catch (error) {
        context.log.error('Test email error:', error);
        context.res = {
            status: 500,
            body: { error: error.message }
        };
    }
};