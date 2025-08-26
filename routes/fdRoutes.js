// routes/fdRoutes.js or add to existing routes
const express = require('express');
const router = express.Router();
const FdRoute = require('../models/FdRoute'); // You'll need to create this model

// Get all active FD routes
router.get('/fd-routes', async (req, res) => {
  try {
    const routes = await FdRoute.find({ isActive: true })
      .select('code label')
      .sort({ code: 1 });
    
    res.json({
      success: true,
      routes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FD routes'
    });
  }
});

module.exports = router;