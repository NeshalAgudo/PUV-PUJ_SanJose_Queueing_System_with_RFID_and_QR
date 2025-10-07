// routes/authRoutes.js
const express = require("express");
const { login, logout, generateCaptcha  } = require("../controllers/authController");
const { 
  initiateReset, 
  verifyOTP, 
  resetPassword 
} = require("../controllers/passwordResetController");

const router = express.Router();
const { authenticate } = require("../middlewares/authMiddleware");

router.get("/captcha", generateCaptcha);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", initiateReset);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);

// Add to authRoutes.js
router.get("/verify", authenticate, (req, res) => {
  res.json({ 
    valid: true, 
    user: { 
      id: req.user._id, 
      role: req.user.role, 
      username: req.user.username 
    } 
  });
});

module.exports = router;