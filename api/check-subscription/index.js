module.exports = async function (context, req) {
    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    const { email } = req.body;
    
    if (!email) {
        context.res = { status: 400, body: { message: 'Email is required' } };
        return;
    }

    // FOR TESTING: Return subscription active for your email
    // Replace with your actual email address
    if (email === 'j.baillie@fdintelligence.co.uk') {
        context.res = {
            status: 200,
            body: {
                active: true,
                companyName: "FD Intelligence",
                usedLicenses: 2,
                totalLicenses: 5
            }
        };
        return;
    }

    // For all other users, no subscription
    context.res = {
        status: 200,
        body: {
            active: false,
            message: "No active subscription found"
        }
    };
};