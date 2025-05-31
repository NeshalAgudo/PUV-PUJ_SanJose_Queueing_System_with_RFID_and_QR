const Queueing = require('../models/Queueing');
const Vehicle = require('../models/Vehicle'); // Assuming this model exists
const { startOfDay, endOfDay } = require('date-fns');

// Get today's queueing list
exports.getTodayQueueing = async (req, res) => {
  try {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    
    const queueingList = await Queueing.find({
      queueDate: {
        $gte: todayStart,
        $lte: todayEnd
      }
    }).sort({ queueingNumber: 1 });
    
    res.status(200).json({
      success: true,
      count: queueingList.length,
      data: queueingList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s queueing list',
      error: error.message
    });
  }
};

// Create a new queueing entry (for walk-ins, not from reservation)
exports.createQueueingEntry = async (req, res) => {
  try {
    const { driverName, plateNumber } = req.body;
    
    // Check if the vehicle exists
    const vehicle = await Vehicle.findOne({ plateNumber });
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }
    
    // Get the latest queueing number for today
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    
    const latestQueue = await Queueing.findOne({
      queueDate: {
        $gte: todayStart,
        $lte: todayEnd
      }
    }).sort({ queueingNumber: -1 });
    
    const nextQueueingNumber = latestQueue ? latestQueue.queueingNumber + 1 : 1;
    
    // Create queueing entry
    const newQueueEntry = await Queueing.create({
      queueingNumber: nextQueueingNumber,
      driverName,
      plateNumber,
      FD: vehicle.FD,
      status: vehicle.status,
      Time_In: new Date(),
      fromReservation: false
    });
    
    res.status(201).json({
      success: true,
      data: newQueueEntry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating queueing entry',
      error: error.message
    });
  }
};

// Update Time_Out for a queueing entry
exports.updateTimeOut = async (req, res) => {
  try {
    const { id } = req.params;
    
    const queueEntry = await Queueing.findByIdAndUpdate(
      id,
      { Time_Out: new Date() },
      { new: true }
    );
    
    if (!queueEntry) {
      return res.status(404).json({
        success: false,
        message: 'Queueing entry not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: queueEntry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating time out',
      error: error.message
    });
  }
};