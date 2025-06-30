// Simplified bot token endpoint for demo access

module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        // Temporary: Allow access during trial/demo period with basic email validation
        // TODO: Implement full Microsoft authentication flow in frontend
        const { email } = req.body;
        
        context.log('Bot token request received for email:', email);
        
        if (!email) {
            context.log.error('No email provided in bot token request');
            context.res = { status: 400, body: { message: 'Email required in request body' } };
            return;
        }

        // Handle various email formats that might come from MSAL
        let cleanEmail = email;
        if (typeof email === 'string') {
            cleanEmail = email.toLowerCase().trim();
        } else {
            context.log.error('Email is not a string:', typeof email, email);
            context.res = { status: 400, body: { message: 'Email must be a string' } };
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            context.log.error('Invalid email format:', cleanEmail);
            context.res = { status: 400, body: { message: 'Valid email required' } };
            return;
        }

        context.log('Returning DirectLine token for email:', cleanEmail);

        // Return the DirectLine token for demo access
        // In production, this should require full authentication
        context.res = {
            status: 200,
            body: {
                token: process.env.DIRECT_LINE_TOKEN,
                userId: 'demo-user-' + cleanEmail.split('@')[0],
                organizationId: 'demo-org'
            }
        };

    } catch (error) {
        context.log.error('Error getting bot token:', error);
        context.res = {
            status: 500,
            body: { message: 'Failed to get token: ' + error.message }
        };
    }
};