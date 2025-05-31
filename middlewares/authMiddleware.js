const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Authentication middleware - verifies JWT token
// middleware/authMiddleware.js
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No valid token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Important: Make sure to use the same field name ('id' or '_id') as your token uses
    const user = await User.findOne({ _id: decoded.id }).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Attach the full user object to the request
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    res.status(401).json({ message: 'Not authenticated' });
  }
};

// Authorization middleware - checks user role
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    // If roles is a string, convert to array
    if (typeof roles === 'string') {
      roles = [roles];
    }

    // Check if user has required role
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    next();
  };
};

// Admin-specific middleware
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ 
      message: 'Not authenticated',
      debug: {
        headers: req.headers,
        receivedToken: req.header('Authorization')?.split(' ')[1]
      }
    });
  }

  if (req.user.role.toLowerCase() !== 'admin') {
    return res.status(403).json({ 
      message: 'Admin access required',
      yourRole: req.user.role
    });
  }

  next();
};

// Staff-specific middleware
const staffOnly = (req, res, next) => {
  const staffRoles = ['admin', 'Staff_1', 'FD1_Staff', 'FD2_Staff', 'FD3_Staff', 'FD4_Staff'];
  if (!req.user || !staffRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Staff access required' });
  }
  next();
};

// Terminal/Booth-specific middleware
const terminalOnly = (req, res, next) => {
  const terminalRoles = ['terminal', 'booth'];
  if (!req.user || !terminalRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Terminal/Booth access required' });
  }
  next();
};

// Self or Admin middleware - allows users to access their own data or admin to access any
const selfOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  // Allow if admin or accessing own data
  const isSelf = req.user._id.toString() === req.params.id;
  const isAdmin = req.user.role === 'Admin';
  
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ message: 'Unauthorized access' });
  }

  next();
};

// Activity logger middleware
const activityLogger = async (req, res, next) => {
  try {
    if (req.user) {
      // Update last activity timestamp
      await User.findByIdAndUpdate(req.user._id, { 
        lastActive: new Date() 
      });
    }
    next();
  } catch (error) {
    console.error('Activity logging error:', error);
    next(); // Don't block request if logging fails
  }
};

module.exports = {
  authenticate,
  authorize,
  adminOnly,
  staffOnly,
  terminalOnly,
  selfOrAdmin,
  activityLogger
};