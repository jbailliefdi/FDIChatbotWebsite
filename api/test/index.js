module.exports = async function (context, req) {
    context.log('Test endpoint called');
    
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        return;
    }

    context.res.status = 200;
    context.res.body = {
        message: 'Test endpoint working!',
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString()
    };
};