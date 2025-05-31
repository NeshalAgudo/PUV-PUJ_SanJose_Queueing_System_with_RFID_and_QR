const User = require('../models/User');
const { adminOnly } = require('../middlewares/authMiddleware');
const bcrypt = require('bcryptjs');

// Get all users (admin only)
// controllers/userController.js
// In your userController.js
exports.getAllUsers = async (req, res) => {
  try {
    // Case-insensitive exclusion of all admin variants
    const users = await User.find({
      role: { 
        $not: /admin/i // Excludes 'Admin', 'admin', 'ADMIN', etc.
      }
    }).select('-password -twoFactorSecret -resetToken -resetTokenExpiry');

    console.log('Filtered users:', users.map(u => u.username));
    
    res.json(users);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Create a new user (admin only)
exports.createUser = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

        // Prevent creating new admin users
    if (role === 'Admin') {
      return res.status(403).json({ message: 'Cannot create admin users' });
    }

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    user = new User({
      username,
      email,
      password,
      role
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save();

    // Return user without sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.twoFactorSecret;
    delete userResponse.resetToken;
    delete userResponse.resetTokenExpiry;

    res.status(201).json(userResponse);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update user (admin only)
exports.updateUser = async (req, res) => {
  try {
    const { username, email, role, password } = req.body;
    const userId = req.params.id;

        // Prevent changing role to admin
    if (role === 'Admin') {
      return res.status(403).json({ message: 'Cannot set role to admin' });
    }

    const updateFields = { username, email, role };

    // Only update password if provided
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true }
    ).select('-password -twoFactorSecret -resetToken -resetTokenExpiry');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deleting themselves
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get active sessions (users currently logged in)
// In userController.js
