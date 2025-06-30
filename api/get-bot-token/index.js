module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    try {
        // Basic auth check (add your own validation)
        const { email } = req.body;
        if (!email) {
            context.res = { status: 401, body: { message: 'Email required' } };
            return;
        }

        // Return the fixed DirectLine token
        const directLineToken = process.env.DIRECT_LINE_TOKEN;

        context.res = {
            status: 200,
            body: {
                token: directLineToken
            }
        };

    } catch (error) {
        context.log.error('Error getting bot token:', error);
        context.res = {
            status: 500,
            body: { message: 'Failed to get token' }
        };
    }
};