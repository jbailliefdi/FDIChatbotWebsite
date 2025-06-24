module.exports = async function (context, req) {
    if (req.method !== 'GET') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    context.res = {
        status: 200,
        body: {
            clientId: process.env.MSAL_CLIENT_ID,
            authority: "https://login.microsoftonline.com/common"
        }
    };
};