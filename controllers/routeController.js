// controllers/routeController.js
const Route = require('../models/Routes');

// Get all routes
// controllers/routeController.js
exports.getAllRoutes = async (req, res) => {
  try {
    const routes = await Route.find().select('ROute').lean();
    res.json({ success: true, data: routes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new route
exports.createRoute = async (req, res) => {
  try {
    const route = new Route(req.body);
    await route.save();
    res.status(201).json({
      success: true,
      data: route
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};