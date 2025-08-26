// routes/authRoutes.js
const express = require("express");
const { login, logout } = require("../controllers/authController");
const { 
  initiateReset, 
  verifyOTP, 
  resetPassword 
} = require("../controllers/passwordResetController");

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.post("/forgot-password", initiateReset);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);

module.exports = router;