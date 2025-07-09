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

async function sendInviteEmail(recipientEmail, inviteToken, organizationName) {
    const inviteUrl = `http://www.fdichatbot.com/join.html?token=${inviteToken}`;
    
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `You've been invited to join ${organizationName} on FDI Chatbot`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #333; text-align: center;">You're Invited!</h2>
                
                <p style="color: #666; font-size: 16px;">
                    You've been invited to join <strong>${organizationName}</strong> on FDI Chatbot.
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    Click the button below to accept your invitation and create your account:
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteUrl}" 
                       style="background-color: #007bff; color: white; padding: 12px 30px; 
                              text-decoration: none; border-radius: 5px; font-weight: bold;
                              display: inline-block;">
                        Accept Invitation
                    </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                    If the button doesn't work, you can copy and paste this link into your browser:
                </p>
                
                <p style="color: #007bff; font-size: 14px; word-break: break-all;">
                    ${inviteUrl}
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    Once you've created your account, you can access the chatbot at:
                </p>
                
                <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center;">
                    <a href="http://www.fdichatbot.com/app" style="color: #007bff; text-decoration: none;">
                        http://www.fdichatbot.com/app
                    </a>
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    This invitation will expire in 30 days. If you didn't expect this invitation, 
                    you can safely ignore this email.
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - FDI Chatbot Platform
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