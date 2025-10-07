const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const captchaChallenges = new Map();

// Add to authController.js
// In authController.js - update the verifyToken function
exports.verifyToken = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ valid: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ valid: false, message: 'User not found' });
    }

    if (user.disabled) {
      return res.status(401).json({ valid: false, message: 'Account disabled' });
    }

    res.json({ 
      valid: true, 
      user: { 
        id: user._id, 
        role: user.role, 
        username: user.username 
      } 
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ valid: false, message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }
    res.status(500).json({ valid: false, message: 'Server error' });
  }
};

// Generate CAPTCHA challenge
exports.generateCaptcha = async (req, res) => {
  try {
    const num1 = Math.floor(Math.random() * 10);
    const num2 = Math.floor(Math.random() * 10);
    const answer = num1 + num2;
    const captchaId = Math.random().toString(36).substring(2, 15);
    
    // Store challenge with expiration (5 minutes)
    captchaChallenges.set(captchaId, {
      answer,
      expires: Date.now() + 5 * 60 * 1000
    });
    
    // Clean up expired challenges
    for (const [id, challenge] of captchaChallenges.entries()) {
      if (challenge.expires < Date.now()) {
        captchaChallenges.delete(id);
      }
    }
    
    res.json({
      captchaId,
      question: `${num1} + ${num2}`
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
    try {
            const { username, password, captchaAnswer, captchaId } = req.body;
    
    // Input validation
    if (!username || !password || !captchaAnswer || !captchaId) {
      return res.status(400).json({ message: "All fields are required" });
    }
    
    // Verify CAPTCHA first
    const challenge = captchaChallenges.get(captchaId);
    if (!challenge) {
      return res.status(400).json({ message: "Invalid or expired CAPTCHA" });
    }
    
    // Clean up used CAPTCHA
    captchaChallenges.delete(captchaId);
    
    if (challenge.expires < Date.now()) {
      return res.status(400).json({ message: "CAPTCHA expired" });
    }
    
    if (parseInt(captchaAnswer) !== challenge.answer) {
      return res.status(400).json({ message: "Incorrect CAPTCHA answer" });
    }
        const user = await User.findOne({ username });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
            // Check if user is disabled
    if (user.disabled) {
      return res.status(403).json({ message: 'Account is disabled' });
    }

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
        res.json({ token, role: user.role });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};



// In controllers/authController.js
exports.logout = async (req, res) => {
  try {
    // Mark user as offline
    await User.findByIdAndUpdate(req.user._id, { 
      isOnline: false,
      socketId: null
    });
    
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error logging out', error: error.message });
  }
};

exports.forgotPassword = async (req, res) => {
    res.json({ message: "Forgot password - feature not implemented yet" });
};

exports.resetPassword = async (req, res) => {
    res.json({ message: "Reset password - feature not implemented yet" });
};
