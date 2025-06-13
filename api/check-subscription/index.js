module.exports = async function (context, req) {
    context.log('Checking subscription for user');

    if (req.method !== 'POST') {
        context.res = { status: 405, body: { message: 'Method not allowed' } };
        return;
    }

    const { email } = req.body;
    
    if (!email) {
        context.res = { status: 400, body: { message: 'Email is required' } };
        return;
    }

    context.log('Checking subscription for email:', email);

    // FOR TESTING: Add your Microsoft account email here
    // Replace 'your-email@company.com' with your actual email
    const allowedEmails = [
        'j.baillie@fdintelligence.co.uk',  // Replace with your email
        'admin@fdintelligence.co.uk'  // Add other test emails
    ];

    if (allowedEmails.includes(email.toLowerCase())) {
        context.log('User has active subscription');
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
    context.log('User does not have active subscription');
    context.res = {
        status: 200,
        body: {
            active: false,
            message: "No active subscription found"
        }
    };
};