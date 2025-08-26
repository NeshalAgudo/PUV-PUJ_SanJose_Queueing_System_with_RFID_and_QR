const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");


exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
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
