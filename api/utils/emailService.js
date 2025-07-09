const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    requireTLS: true
});

async function sendInviteEmail(recipientEmail, inviteToken, organizationName, adminEmail) {
    const inviteUrl = `fdichatbot.com/join.html?token=${inviteToken}`;
    
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `You've been added to ${organizationName} on TIA (Tax Intelligence Assistant)`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #333; text-align: center;">You've been added to an organization!</h2>
                
                <p style="color: #666; font-size: 16px;">
                    You've been added to <strong>${organizationName}</strong> on TIA (Tax Intelligence Assistant).
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    Your account is currently <strong>pending activation</strong>. Once your admin <strong>${adminEmail || 'your organization admin'}</strong> has activated your account, you'll be able to access TIA.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://${inviteUrl}" 
                       style="background-color: #007bff; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; font-weight: bold;
                              display: inline-block;">
                        Complete Registration
                    </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    If the button doesn't work, you can copy and paste this link into your browser:
                </p>
                
                <p style="color: #007bff; font-size: 14px; word-break: break-all;">
                    https://${inviteUrl}
                </p>
                
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin: 20px 0;">
                    <p style="color: #666; font-size: 16px; margin: 0;">
                        <strong>Once activated by your admin, you can access TIA at:</strong>
                    </p>
                    <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center; margin: 10px 0 0 0;">
                        <a href="https://fdichatbot.com/app" style="color: #007bff; text-decoration: none;">
                            fdichatbot.com/app
                        </a>
                    </p>
                </div>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    This invitation will expire in 30 days. If you didn't expect this invitation, 
                    you can safely ignore this email.
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendInviteEmail
};