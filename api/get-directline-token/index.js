// This is the "messenger" function.
// It runs on the server, gets the token from the secure vault (environment variables),
// and sends it back to your JavaScript.
module.exports = async function (context, req) {
    context.res = {
        // status: 200, /* Defaults to 200 */
        body: { 
            token: process.env.DIRECT_LINE_TOKEN 
        }
    };
};