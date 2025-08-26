const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: [true, 'Username is required'],
    unique: true,
    trim: true
  },
  email: { 
    type: String, 
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  password: { 
    type: String, 
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  role: { 
    type: String, 
    enum: [
      "Admin", 
      "Staff_1",
      "FD1_Staff",
      "FD2_Staff",
      "FD3_Staff",
      "FD4_Staff",
      "booth",
      "terminal"
    ], 
    required: [true, 'Role is required'],
    default: "terminal"
  },
  twoFactorEnabled: { 
    type: Boolean, 
    default: false 
  },
  twoFactorSecret: { 
    type: String,
    select: false
  },
  resetToken: { 
    type: String,
    select: false
  },
  resetTokenExpiry: { 
    type: Date,
    select: false
  },
    passwordResetOTP: {
    code: String,
    expiresAt: Date,
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false }
  },
  lastActive: {
    type: Date
  },
    disabled: {
    type: Boolean,
    default: false
  },
  disabledAt: {
    type: Date
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      delete ret.twoFactorSecret;
      delete ret.resetToken;
      delete ret.resetTokenExpiry;
      delete ret.passwordResetOTP;
      return ret;
    }
  }
});

module.exports = mongoose.model("User", UserSchema);