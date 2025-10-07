// services/emailServiceBrevo.js
const SibApiV3Sdk = require('@sendinblue/client');
const { sendPasswordSetupEmail } = require('./passwordSetupEmailService');
// Initialize the API instance
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Set the API key - this uses the environment variable
apiInstance.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, 
  process.env.BREVO_API_KEY
);

const sendOTPEmail = async (email, otp) => {
  try {
    console.log('Attempting to send email via Brevo to:', email);
    
    const sendSmtpEmail = {
      to: [{ email: email }],
      sender: { 
        name: 'QSanJose',
        email: 'neshalagudo@gmail.com' // This can be any email address
      },
      subject: 'Password Reset OTP',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>Your password reset OTP is:</p>
          <div style="background: #f4f4f4; padding: 15px; text-align: center; margin: 20px 0;">
            <h1 style="margin: 0; color: #333; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p>This code will expire in <strong>10 minutes</strong>.</p>
          <p>If you didn't request this reset, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Queuing System Team</p>
        </div>
      `,
      textContent: `Your password reset OTP is: ${otp}. This code will expire in 10 minutes.`
    };

    console.log('Sending email');
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('✅ email sent successfully:', data);
    
    return data;
  } catch (error) {
    console.error('❌ email error:', error);
    
    // More detailed error logging
    if (error.response) {
      console.error(' API response error:', error.response.body);
    }
    
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = { 
  sendOTPEmail, 
  sendPasswordSetupEmail 
};