// DirectLine token endpoint with Azure Static Web Apps authentication
module.exports = async function (context, req) {
    try {
        // Check Azure Static Web Apps authentication
        const clientPrincipal = req.headers['x-ms-client-principal'];
        if (!clientPrincipal) {
            context.res = { status: 401, body: { message: 'Authentication required' } };
            return;
        }

        // Parse user info from Azure SWA
        const user = JSON.parse(Buffer.from(clientPrincipal, 'base64').toString());
        if (!user || !user.userDetails) {
            context.res = { status: 401, body: { message: 'Invalid authentication' } };
            return;
        }

        const directLineToken = process.env.DIRECT_LINE_TOKEN;
        
        if (!directLineToken) {
            context.log.error('DIRECT_LINE_TOKEN environment variable not set');
            context.res = { status: 500, body: { message: 'DirectLine token not configured' } };
            return;
        }

        context.log('Successfully returning DirectLine token for user:', user.userDetails);
        context.res = {
            status: 200,
            body: { 
                token: directLineToken 
            }
        };

    } catch (error) {
        context.log.error('Error getting DirectLine token:', error);
        context.res = {
            status: 500,
            body: { message: 'Failed to get DirectLine token' }
        };
    }
};