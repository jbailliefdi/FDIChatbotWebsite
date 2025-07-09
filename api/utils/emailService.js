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
        subject: `You've been added to ${organizationName}'s subscription to TIA (Tax Intelligence Assistant)`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #333; text-align: center;">You've been added to an organisation!</h2>
                
                <p style="color: #666; font-size: 16px;">
                    You've been added to <strong>${organizationName}</strong>'s subscription to TIA (Tax Intelligence Assistant)!
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    Your account is currently <strong>pending activation</strong>. Once your administrator <strong>${adminEmail || 'your organization admin'}</strong> has activated your account in their dashboard, you'll be able to access TIA.
                </p>
                
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin: 20px 0;">
                    <p style="color: #666; font-size: 16px; margin: 0;">
                        <strong>Once activated by your administrator, you can access TIA at:</strong>
                    </p>
                    <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center; margin: 10px 0 0 0;">
                        <a href="https://fdichatbot.com/app" style="color: #007bff; text-decoration: none;">
                            fdichatbot.com/app
                        </a>
                    </p>
                </div>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #666; font-size: 14px; text-align: center;">
                    Questions? Contact ${adminEmail ? `your administrator at <strong>${adminEmail}</strong> or` : ''} our support team at <strong>support@fdichatbot.com</strong>
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendAccountActivatedEmail(recipientEmail, organizationName, adminEmail) {
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `Your TIA account has been activated - ${organizationName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #27ae60; text-align: center;">Your account has been activated!</h2>
                
                <p style="color: #666; font-size: 16px;">
                    Great news! Your TIA (Tax Intelligence Assistant) account for <strong>${organizationName}</strong> has been activated and is now ready to use.
                </p>
                
                <div style="background: #d4edda; padding: 1rem; border-radius: 6px; margin: 20px 0; border: 1px solid #c3e6cb;">
                    <p style="color: #155724; font-size: 16px; margin: 0;">
                        <strong>You can now access TIA at:</strong>
                    </p>
                    <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center; margin: 10px 0 0 0;">
                        <a href="https://fdichatbot.com/app" style="color: #007bff; text-decoration: none;">
                            fdichatbot.com/app
                        </a>
                    </p>
                </div>
                
                <p style="color: #666; font-size: 16px;">
                    Simply sign in with your Microsoft account to start using TIA for all your tax intelligence needs.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #666; font-size: 14px; text-align: center;">
                    Questions? Contact ${adminEmail ? `your administrator at <strong>${adminEmail}</strong> or` : ''} our support team at <strong>support@fdichatbot.com</strong>
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendAccountDeactivatedEmail(recipientEmail, organizationName, adminEmail) {
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `Your TIA account has been deactivated - ${organizationName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #e74c3c; text-align: center;">Your account has been deactivated</h2>
                
                <p style="color: #666; font-size: 16px;">
                    Your TIA (Tax Intelligence Assistant) account for <strong>${organizationName}</strong> has been deactivated and you no longer have access to the system.
                </p>
                
                <div style="background: #f8d7da; padding: 1rem; border-radius: 6px; margin: 20px 0; border: 1px solid #f5c6cb;">
                    <p style="color: #721c24; font-size: 16px; margin: 0;">
                        <strong>Access Removed:</strong> You can no longer sign in to TIA at fdichatbot.com/app
                    </p>
                </div>
                
                <p style="color: #666; font-size: 16px;">
                    If you believe this is an error or have questions about your account status, please contact your administrator.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #666; font-size: 14px; text-align: center;">
                    Questions? Contact ${adminEmail ? `your administrator at <strong>${adminEmail}</strong> or` : ''} our support team at <strong>support@fdichatbot.com</strong>
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendAdminPromotedEmail(recipientEmail, organizationName, adminEmail) {
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `You've been promoted to administrator - ${organizationName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #f39c12; text-align: center;">You've been promoted to administrator!</h2>
                
                <p style="color: #666; font-size: 16px;">
                    Congratulations! You've been promoted to administrator for <strong>${organizationName}</strong>'s TIA (Tax Intelligence Assistant) account.
                </p>
                
                <div style="background: #fff3cd; padding: 1rem; border-radius: 6px; margin: 20px 0; border: 1px solid #ffeaa7;">
                    <p style="color: #856404; font-size: 16px; margin: 0;">
                        <strong>New Administrative Access:</strong> You can now manage users, billing, and organization settings in the admin dashboard.
                    </p>
                </div>
                
                <p style="color: #666; font-size: 16px;">
                    Access your admin dashboard at:
                </p>
                
                <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center; margin: 20px 0;">
                    <a href="https://fdichatbot.com/dashboard" style="color: #007bff; text-decoration: none;">
                        fdichatbot.com/dashboard
                    </a>
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    You also continue to have full access to TIA at fdichatbot.com/app.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #666; font-size: 14px; text-align: center;">
                    Questions? Contact ${adminEmail ? `your administrator at <strong>${adminEmail}</strong> or` : ''} our support team at <strong>support@fdichatbot.com</strong>
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendAdminDemotedEmail(recipientEmail, organizationName, adminEmail) {
    const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: `Your administrator privileges have been removed - ${organizationName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <img src="https://fdichatbot.com/FDi_Logo_Final.png" alt="FD Intelligence Logo" style="max-width: 200px; height: auto;">
                </div>
                <h2 style="color: #6c757d; text-align: center;">Your administrator privileges have been removed</h2>
                
                <p style="color: #666; font-size: 16px;">
                    Your administrator privileges for <strong>${organizationName}</strong>'s TIA (Tax Intelligence Assistant) account have been removed.
                </p>
                
                <div style="background: #e2e3e5; padding: 1rem; border-radius: 6px; margin: 20px 0; border: 1px solid #d6d8db;">
                    <p style="color: #383d41; font-size: 16px; margin: 0;">
                        <strong>Access Changed:</strong> You no longer have access to the admin dashboard, but you can still use TIA as a regular user.
                    </p>
                </div>
                
                <p style="color: #666; font-size: 16px;">
                    You can continue to access TIA at:
                </p>
                
                <p style="color: #007bff; font-size: 16px; font-weight: bold; text-align: center; margin: 20px 0;">
                    <a href="https://fdichatbot.com/app" style="color: #007bff; text-decoration: none;">
                        fdichatbot.com/app
                    </a>
                </p>
                
                <p style="color: #666; font-size: 16px;">
                    If you have questions about this change, please contact your administrator.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="color: #666; font-size: 14px; text-align: center;">
                    Questions? Contact ${adminEmail ? `your administrator at <strong>${adminEmail}</strong> or` : ''} our support team at <strong>support@fdichatbot.com</strong>
                </p>
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    © FD Intelligence - TIA (Tax Intelligence Assistant)
                </p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendInviteEmail,
    sendAccountActivatedEmail,
    sendAccountDeactivatedEmail,
    sendAdminPromotedEmail,
    sendAdminDemotedEmail
};