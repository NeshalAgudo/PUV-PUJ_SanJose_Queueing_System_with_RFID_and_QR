// services/passwordSetupEmailService.js - SIMPLER VERSION
const SibApiV3Sdk = require('@sendinblue/client');

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
apiInstance.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, 
  process.env.BREVO_API_KEY
);

const sendPasswordSetupEmail = async (email, username) => {
  try {
    console.log('Sending password setup email to:', email);
    
    const sendSmtpEmail = {
      to: [{ email: email }],
      sender: { 
        name: 'QSanJose',
        email: 'neshalagudo@gmail.com'
      },
      subject: 'Welcome to QSanJose - Set Your Password',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome to QSanJose!</h2>
          <p>Hello <strong>${username}</strong>,</p>
          <p>Your account has been created by an administrator. Your account is ready to use!</p>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">To get started:</h3>
            <ol>
              <li>Open the <strong>QSanJose mobile app</strong></li>
              <li>On the login screen, tap <strong>"Forgot Password"</strong></li>
              <li>Enter your email: <strong>${email}</strong></li>
              <li>Check your email for the password reset OTP</li>
              <li>Set your new password and login</li>
            </ol>
          </div>
          
          <p>If you encounter any issues, please contact your administrator.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Queuing System Team</p>
        </div>
      `,
      textContent: `
Welcome to QSanJose!

Hello ${username},

Your account has been created by an administrator. Your account is ready to use!

To get started:
1. Open the QSanJose mobile app
2. On the login screen, tap "Forgot Password" 
3. Enter your email: ${email}
4. Check your email for the password reset OTP
5. Set your new password and login

If you encounter any issues, please contact your administrator.

Queuing System Team
      `
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('✅ Password setup email sent successfully');
    return data;
  } catch (error) {
    console.error('❌ Password setup email error:', error);
    throw new Error(`Failed to send password setup email: ${error.message}`);
  }
};

module.exports = { sendPasswordSetupEmail };