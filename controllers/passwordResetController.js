// controllers/passwordResetController.js
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Generate secure 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: `"Queuing System" <${process.env.EMAIL_USER}>`, 
    to: email,
    subject: 'Password Reset OTP',
    text: `Your password reset OTP is: ${otp}\nThis code will expire in 10 minutes.`,
    html: `<p>Your password reset OTP is: <strong>${otp}</strong></p><p>This code will expire in 10 minutes.</p>`
  };

  await transporter.sendMail(mailOptions);
};

// Initiate password reset
// controllers/passwordResetController.js
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
            return res.status(404).json({ 
                message: 'No account found with this email' 
            });
        }

        // Generate OTP and set expiration (10 minutes)
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        user.passwordResetOTP = {
            code: await bcrypt.hash(otp, 10),
            expiresAt,
            attempts: 0
        };
        
        await user.save();
        await sendOTPEmail(user.email, otp);

        res.status(200).json({ 
            message: 'Reset code has been sent to your email' 
        });
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
        await user.save(); // Make sure this save operation completes

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