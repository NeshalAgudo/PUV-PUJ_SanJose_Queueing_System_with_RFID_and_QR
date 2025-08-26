// models/FdRoute.js
const mongoose = require('mongoose');

const fdRouteSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  label: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// ✅ Prevent OverwriteModelError
module.exports = mongoose.models.FdRoute || mongoose.model('FdRoute', fdRouteSchema);
