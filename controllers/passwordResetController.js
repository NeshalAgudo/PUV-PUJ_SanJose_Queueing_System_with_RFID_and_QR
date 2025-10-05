// controllers/passwordResetController.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendOTPEmail } = require('../services/emailServiceBrevo');

// Generate secure 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Initiate password reset
exports.initiateReset = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        message: 'Email is required' 
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    if (!user) {
      // For security, don't reveal if email exists
      return res.status(200).json({ 
        message: 'If an account with that email exists, a reset code has been sent.' 
      });
    }

    // Generate OTP and set expiration (10 minutes)
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    user.passwordResetOTP = {
      code: await bcrypt.hash(otp, 10),
      expiresAt,
      attempts: 0,
      verified: false
    };
    
    await user.save();
    
    // Send email using Resend
    try {
      await sendOTPEmail(user.email, otp);
      console.log(`OTP sent to ${user.email}: ${otp}`);
      
      res.status(200).json({ 
        message: 'If an account with that email exists, a reset code has been sent.' 
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      
      // Clear the OTP since email failed
      user.passwordResetOTP = undefined;
      await user.save();
      
      return res.status(500).json({ 
        message: 'Failed to send email. Please try again later.' 
      });
    }
  } catch (error) {
    console.error('Password reset initiation error:', error);
    res.status(500).json({ 
      message: 'An error occurred while processing your request' 
    });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !user.passwordResetOTP?.code) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Check expiration
    if (new Date() > user.passwordResetOTP.expiresAt) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    // Verify OTP
    const isValid = await bcrypt.compare(otp, user.passwordResetOTP.code);
    
    if (!isValid) {
      user.passwordResetOTP.attempts += 1;
      await user.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Mark as verified and save
    user.passwordResetOTP.verified = true;
    await user.save();

    res.status(200).json({ 
      success: true,
      message: 'OTP verified successfully' 
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !user.passwordResetOTP?.code) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Double verification
    const isValid = await bcrypt.compare(otp, user.passwordResetOTP.code);
    if (!isValid || !user.passwordResetOTP.verified) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Update password and clear OTP data
    user.password = await bcrypt.hash(newPassword, 12);
    user.passwordResetOTP = undefined;
    await user.save();

    res.status(200).json({ 
      success: true,
      message: 'Password reset successfully' 
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: error.message });
  }
};