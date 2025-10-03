const Vehicle = require('../models/Vehicle');
const EntryLog = require('../models/EntryLog');
const moment = require('moment');
const FdRoute = require('../models/FdRoute');
const { notifySystemUpdate, notifyEntryLogsUpdate } = require('../websocket/websocket');
const { notifyPenaltyLifted, notifyPenaltyUpdate } = require('../websocket/websocket');

// Helper to check if we need to reset queue numbers (after midnight)
const shouldResetQueueNumber = (lastEntry) => {
  if (!lastEntry) return true;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return lastEntry.timestamp < today;
};

// Get next queue number with daily reset
const getNextQueueNumber = async () => {
  // Get the most recent entry log (regardless of whether it has a queue number)
  const lastEntry = await EntryLog.findOne()
    .sort({ timestamp: -1 })
    .limit(1);

  // Get today's date at midnight
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // If no entries exist or last entry was before today, reset to 1
  if (!lastEntry || lastEntry.timestamp < today) {
    return 1;
  }

  // Otherwise, get the highest queue number from today
  const highestQueue = await EntryLog.findOne({
    queueing_number: { $exists: true },
    timestamp: { $gte: today }
  })
  .sort({ queueing_number: -1 })
  .limit(1);

  return highestQueue ? highestQueue.queueing_number + 1 : 1;
};

// Update searchVehicle to set initial touchdown status
exports.searchVehicle = async (req, res) => {
  try {
    const { identifier } = req.body;

    const vehicle = await Vehicle.findOne({
      $or: [
        { rfid: identifier },
        { plateNumber: identifier.toUpperCase() }
      ]
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    // Add this check at the beginning
    if (vehicle.penaltyStatus === 'Penalty') {
      return res.json({
        success: false,
        message: 'Vehicle has penalty status',
        penaltyStatus: 'Penalty'
      });
    }
    
    // Set default pass based on FD
    if (!vehicle.Pass) {
      vehicle.Pass = vehicle.FD === 'FD1' ? 'Pila' : 'Taxi';
      await vehicle.save();
    }

    // Find the most recent log for this vehicle (whether cleared or not)
    const lastLog = await EntryLog.findOne({ 
      vehicle: vehicle._id
    }).sort({ timestamp: -1 }).limit(1);

    let nextAction = 'entry';
    let shouldCreateNewLog = true;

    if (lastLog) {
      if (!lastLog.cleared) {
        // Vehicle is still active in the system
        return res.json({
          success: false,
          message: 'Vehicle already in system',
          existingAction: lastLog.action,
          vehicle: {
            plateNumber: vehicle.plateNumber,
            driverName: vehicle.driverName,
            route: vehicle.route,
            FD: vehicle.FD,
            Pass: lastLog.Pass,
            queueing_number: lastLog.queueing_number,
            timeIN: lastLog.timeIN,
            vehicleStatus: vehicle.status 
          }
        });
      }
      
      // Determine next action based on last log
      nextAction = lastLog.action === 'entry' ? 'exit' : 'entry';
      
      // For exit action, we'll update the existing entry rather than create new one
      shouldCreateNewLog = nextAction === 'entry';
    }

    // Handle FD1 queue number assignment (only for new entries)
    let queueNumber;
    if (nextAction === 'entry' && vehicle.FD === 'FD1' && vehicle.Pass === 'Pila') {
      queueNumber = await getNextQueueNumber();
    }

    // Check if section is occupied
    const activeLogSameSection = await EntryLog.findOne({ 
      action: nextAction,
      cleared: { $ne: true }
    });

    if (activeLogSameSection) {
      // Create queued log entry with processing status
      const queuedLog = new EntryLog({
        vehicle: vehicle._id,
        plateNumber: vehicle.plateNumber,
        action: nextAction,
        timestamp: new Date(),
        status: 'queued',
        route: vehicle.route,
        FD: vehicle.FD,
        Pass: vehicle.Pass,
        queueing_number: (nextAction === 'entry' && vehicle.FD === 'FD1' && vehicle.Pass === 'Pila') ? queueNumber : undefined,
        timeIN: nextAction === 'entry' ? new Date() : null,
      });
      await queuedLog.save();

      return res.json({
        success: false,
        message: 'Section occupied - Vehicle added to queue',
        action: nextAction,
        vehicle: {
          plateNumber: vehicle.plateNumber,
          driverName: vehicle.driverName,
          route: vehicle.route,
          FD: vehicle.FD,
          Pass: vehicle.Pass,
          queueing_number: queuedLog.queueing_number,
          timeIN: queuedLog.timeIN,
        }
      });
    }

    if (shouldCreateNewLog) {
      // Create new log entry with processing status
      const newLog = new EntryLog({
        vehicle: vehicle._id,
        plateNumber: vehicle.plateNumber,
        action: nextAction,
        timestamp: new Date(),
        status: 'active',
        route: vehicle.route,
        FD: vehicle.FD,
        Pass: vehicle.Pass,
        queueing_number: queueNumber,
        timeIN: nextAction === 'entry' ? new Date() : null,

      });
      await newLog.save();
    } else {
      // Update existing entry for exit action with processing status
      await EntryLog.findByIdAndUpdate(lastLog._id, {
        action: 'exit',
        status: 'active',
        cleared: false,
        timestamp: new Date(),
      });
    }

    // Get the updated/created log to return all data
    const currentLog = await EntryLog.findOne({
      vehicle: vehicle._id,
      cleared: { $ne: true }
    });

    res.json({
      success: true,
      action: nextAction,
      vehicle: {
        plateNumber: vehicle.plateNumber,
        driverName: vehicle.driverName,
        route: vehicle.route,
        FD: vehicle.FD,
        Pass: currentLog?.Pass || vehicle.Pass,
        queueing_number: currentLog?.queueing_number,
        timeIN: currentLog?.timeIN,
        status: vehicle.status,
      }
    });
    notifySystemUpdate();

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update clearVehicle to handle timeOut updates
exports.clearVehicle = async (req, res) => {
  try {
    const { plateNumber, isExit } = req.body;

    // Generate ticket ID once to ensure consistency
    const ticketId = isExit ? await generateTicketId() : null;
    const qrData = isExit ? `vehicle:${plateNumber}|ticket:${ticketId}|time:${Date.now()}` : null;
    
    // First find the active log to clear
    const clearedLog = await EntryLog.findOneAndUpdate(
      { 
        plateNumber: plateNumber.toUpperCase(),
        cleared: { $ne: true }
      },
      { 
        $set: { 
          cleared: true,
          status: 'inactive',
          ...(isExit && { 
            timeOut: new Date(),
            action: 'exit',
            ticket_id: ticketId,
            qr_code_data: qrData
          })
        } 
      },
      { new: true }
    ).populate('vehicle');

    if (!clearedLog) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    // Update touchdown status - THIS IS THE KEY FIX
    if (isExit) {
      // Determine the correct touchdown status based on FD and Pass
      let touchdownStatus;
      if (clearedLog.FD === 'FD1' && clearedLog.Pass === 'Pila') {
        touchdownStatus = 'dispatch';
      } else {
        touchdownStatus = 'ongoing';
      }

      // Update the CURRENT entry log (the one we just cleared) with touchdown status
      await EntryLog.findByIdAndUpdate(
        clearedLog._id,
        { 
          $set: { 
            touchdown: touchdownStatus // Set the correct touchdown status for exit
          } 
        }
      );

      // Also update the original entry log for consistency
      await EntryLog.findOneAndUpdate(
        { 
          plateNumber: plateNumber.toUpperCase(),
          action: 'entry',
          cleared: true
        },
        { 
          $set: { 
            timeOut: new Date(),
            ticket_id: ticketId,
            qr_code_data: qrData,
            touchdown: touchdownStatus
          } 
        },
        { sort: { timestamp: -1 } }
      );
    } else {
      // For entry actions: set to waiting after confirmation
      // Update the CURRENT entry log
      await EntryLog.findByIdAndUpdate(
        clearedLog._id,
        { 
          $set: { 
            touchdown: 'waiting' // Set to waiting when entry is confirmed
          } 
        }
      );

      // Also update the original entry log for consistency
      await EntryLog.findOneAndUpdate(
        { 
          plateNumber: plateNumber.toUpperCase(),
          action: 'entry',
          cleared: true
        },
        { 
          $set: { 
            touchdown: 'waiting'
          } 
        },
        { sort: { timestamp: -1 } }
      );
    }

    // Promote next queued vehicle and set proper touchdown status
    const nextQueued = await EntryLog.findOneAndUpdate(
      { 
        action: clearedLog.action,
        status: 'queued',
        cleared: { $ne: true }
      },
      { $set: { status: 'active' } },
      { sort: { timestamp: 1 }, new: true }
    ).populate('vehicle');

    const responseData = {
      success: true,
      promoted: nextQueued != null,
      ...(isExit && {
        ticket_id: ticketId,
        qr_code_data: qrData
      })
    };

    if (nextQueued) {
      // Get the vehicle details to ensure we have the correct status
      const promotedVehicle = await Vehicle.findOne({ plateNumber: nextQueued.plateNumber });
      const vehicleStatus = promotedVehicle?.status || 'Ok';
      // Get the original entry log for timeIN
      const originalEntry = await EntryLog.findOne({
        plateNumber: nextQueued.plateNumber,
        action: 'entry',
        cleared: true
      }).sort({ timestamp: -1 });

      return res.json({
        success: true,
        promoted: true,
        vehicle: {
          plateNumber: nextQueued.plateNumber,
          driverName: nextQueued.vehicle?.driverName || '',
          route: nextQueued.route || nextQueued.vehicle?.route || '',
          FD: nextQueued.FD || nextQueued.vehicle?.FD || '',
          queueing_number: nextQueued.queueing_number,
          Pass: nextQueued.Pass || nextQueued.vehicle?.Pass || (nextQueued.FD === 'FD1' ? 'Pila' : 'Taxi'),
          timeIN: originalEntry?.timeIN || nextQueued.timeIN,
          status: vehicleStatus, 
          ticket_id: isExit ? ticketId : undefined,
          qr_code_data: isExit ? qrData : undefined
        }
      });
    }
    notifySystemUpdate();

    res.json({ success: true, promoted: false });
  } catch (error) {
    console.error('Clear error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// Helper function to generate ticket IDs
const generateTicketId = async () => {
  // Get the highest ticket ID from the database
  const highestTicket = await EntryLog.findOne({ ticket_id: { $exists: true } })
    .sort({ ticket_id: -1 })
    .limit(1);
  
  let nextId = 1;
  if (highestTicket && highestTicket.ticket_id) {
    nextId = parseInt(highestTicket.ticket_id) + 1;
  }
  
  return nextId.toString().padStart(8, '0');
};


  // Add to entranceController.js
  exports.getEntryLogs = async (req, res) => {
    try {
      const logs = await EntryLog.find({})
        .populate('vehicle', 'route FD Pass') // Populate these fields from Vehicle
        .select('-status -cleared -action -__v')
        .sort({ timeIN: -1 })
        .limit(50);
  
      // Map the results to include vehicle fields if they exist
      const formattedLogs = logs.map(log => ({
        ...log.toObject(),
        route: log.route || (log.vehicle?.route || null),
        FD: log.FD || (log.vehicle?.FD || null),
        Pass: log.Pass || (log.vehicle?.Pass || null)
      }));
  
      res.json(formattedLogs);
    } catch (error) {
      console.error('Get entry logs error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };

  exports.getNextQueueNumber = async (req, res) => {
    try {
      const nextNumber = await getNextQueueNumber();
      res.json({ 
        success: true, 
        queueNumber: nextNumber 
      });
    } catch (error) {
      console.error('Queue number error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to get next queue number' 
      });
    }
  };
  
  exports.updateVehiclePass = async (req, res) => {
    try {
      const { plateNumber, pass, queueNumber } = req.body;
      
      const updateData = { Pass: pass };
      if (pass === 'Pila' && queueNumber) {
        updateData.queueing_number = queueNumber;
      } else if (pass === 'Taxi' || pass === 'SP') {
        updateData.queueing_number = null;
      }
  
      const updatedLog = await EntryLog.findOneAndUpdate(
        { 
          plateNumber: plateNumber.toUpperCase(),
          cleared: { $ne: true }
        },
        { $set: updateData },
        { new: true }
      );
  
      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Active vehicle log not found' 
        });
      }
      notifySystemUpdate();
  
      res.json({ 
        success: true,
        pass: updatedLog.Pass,
        queueNumber: updatedLog.queueing_number
      });
    } catch (error) {
      console.error('Update pass error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update vehicle pass' 
      });
    } 
  };

  // Add to your vehicleController.js
// In entranceController.js
// In entranceController.js
// Renamed to updateEntryLogFd to be explicit
// Update your updateEntryLogFd function in entranceController.js
exports.updateEntryLogFd = async (req, res) => {
  try {
    const { plateNumber, fd } = req.body;
    
    // Validate that the FD route exists and is active
    const validRoute = await FdRoute.findOne({ 
      code: fd, 
      isActive: true 
    });
    
    if (!validRoute) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid FD route' 
      });
    }

    // Update the active EntryLog entry
    const updatedLog = await EntryLog.findOneAndUpdate(
      { 
        plateNumber: plateNumber.toUpperCase(),
        cleared: { $ne: true }
      },
      { $set: { FD: fd } },
      { new: true }
    );

    if (!updatedLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Active entry log not found'
      });
    }
    notifySystemUpdate();

    res.json({ 
      success: true,
      plateNumber: updatedLog.plateNumber,
      updatedFd: updatedLog.FD,
      message: 'Updated FD for current entry'
    });
  } catch (error) {
    console.error('EntryLog FD update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update entry log FD'
    });
  }
};



//----------------------------------------fd1 scanning functions------------------------------------
// Add to entranceController.js
// In controllers/entranceController.js
exports.validateQrCode = async (req, res) => {
  try {
    const { qrData } = req.body;
    
    // Parse the simplified QR format (vehicle:plate|ticket:id|fd:FD)
    const qrParts = qrData.split('|');
    if (qrParts.length !== 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid QR format. Expected vehicle:plate|ticket:id|fd:FD' 
      });
    }

    const plateNumber = qrParts[0].split(':')[1];
    const ticketId = qrParts[1].split(':')[1];
    const fd = qrParts[2].split(':')[1];

    // Find the entry log
    const entryLog = await EntryLog.findOne({
      plateNumber: plateNumber.toUpperCase(),
      ticket_id: ticketId
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle' 
      });
    }

    // Check if already scanned/exited
    if (entryLog.touchdown === 'Exited Successfully') {
      return res.json({ 
        success: false, 
        message: 'Vehicle already exited successfully',
        touchdown: entryLog.touchdown
      });
    }

    // Check if no ticket or no exit scan
    if (!entryLog.ticket_id || !entryLog.timeOut) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/No ticket or no exit' }
      });

      return res.json({ 
        success: false, 
        message: 'No ticket or no exit recorded, Penalty applied',
        touchdown: 'Exited/No ticket or no exit'
      });
    }

    // Check if expired (more than 24 hours old)
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Expired ticket' }
      });

      return res.json({ 
        success: false, 
        message: 'Expired ticket, Penalty applied',
        touchdown: 'Exited/Expired ticket'
      });
    }

    // Check if correct FD (FD1)
    if (entryLog.FD === 'FD1') {
      // Update entry log - exited successfully, NO penalty status change here
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD - update vehicle penalty status and entry log
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty applied',
        touchdown: 'Exited/Wrong Endpoint'
      });
    }
  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateVehicleStatus = async (req, res) => {
  try {
    const { plateNumber, touchdown, status, penaltyStatus, entryLogId } = req.body;
    
    const updateData = {};
    
    notifySystemUpdate();

    
    // Update penaltyStatus if provided
    if (penaltyStatus) {
      updateData.penaltyStatus = penaltyStatus;
    }
    
    // Update status if provided (for backward compatibility)
    if (status) {
      updateData.status = status;
    }

    // Validate required fields
    if (!plateNumber || !touchdown || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Update specific entry log if ID is provided
    if (entryLogId) {
      const updatedLog = await EntryLog.findByIdAndUpdate(
        entryLogId,
        { $set: { touchdown: touchdown } },
        { new: true }
      );

      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Entry log not found' 
        });
      }
    }

    // Update vehicle status
    const vehicleUpdate = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { $set: { status: status } },
      { new: true }
    );

    if (!vehicleUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Vehicle status updated successfully'
    });
  } catch (error) {
    console.error('Update vehicle status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update vehicle status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
//----------------------------------------fd1 scanning functions------------------------------------



//----------------------------------------fd2 scanning functions------------------------------------
// Add to entranceController.js
// In controllers/entranceController.js
exports.validateQrCodeFD2 = async (req, res) => {
  try {
    const { qrData } = req.body;
    
    const qrParts = qrData.split('|');
    if (qrParts.length !== 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid QR format. Expected vehicle:plate|ticket:id|fd:FD' 
      });
    }

    const plateNumber = qrParts[0].split(':')[1];
    const ticketId = qrParts[1].split(':')[1];
    const fd = qrParts[2].split(':')[1];

    const entryLog = await EntryLog.findOne({
      plateNumber: plateNumber.toUpperCase(),
      ticket_id: ticketId
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle' 
      });
    }

    // Check if already scanned/exited
    if (entryLog.touchdown === 'Exited Successfully') {
      return res.json({ 
        success: false, 
        message: 'Vehicle already exited successfully',
        touchdown: entryLog.touchdown
      });
    }

    // Check if no ticket or no exit scan
    if (!entryLog.ticket_id || !entryLog.timeOut) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/No ticket or no exit' }
      });

      return res.json({ 
        success: false, 
        message: 'No ticket or no exit recorded, Penalty applied',
        touchdown: 'Exited/No ticket or no exit'
      });
    }

    // Check if expired
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Expired ticket' }
      });

      return res.json({ 
        success: false, 
        message: 'Expired ticket, Penalty applied',
        touchdown: 'Exited/Expired ticket'
      });
    }

    // Check if correct FD (FD2)
    if (entryLog.FD === 'FD2') {
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty applied',
        touchdown: 'Exited/Wrong Endpoint'
      });
    }
  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



exports.updateVehicleStatus = async (req, res) => {
  try {
    const { plateNumber, touchdown, status, penaltyStatus, entryLogId } = req.body;

    const updateData = {};

    // Update penaltyStatus if provided
    if (penaltyStatus) {
      updateData.penaltyStatus = penaltyStatus;
    }
    
    // Update status if provided (for backward compatibility)
    if (status) {
      updateData.status = status;
    }
    
    // Validate required fields
    if (!plateNumber || !touchdown || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Update specific entry log if ID is provided
    if (entryLogId) {
      const updatedLog = await EntryLog.findByIdAndUpdate(
        entryLogId,
        { $set: { touchdown: touchdown } },
        { new: true }
      );

      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Entry log not found' 
        });
      }
    }

    // Update vehicle status
    const vehicleUpdate = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { $set: { status: status } },
      { new: true }
    );

    if (!vehicleUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Vehicle status updated successfully'
    });
  } catch (error) {
    console.error('Update vehicle status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update vehicle status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
//----------------------------------------fd2 scanning functions end------------------------------------

//----------------------------------------fd3 scanning functions start------------------------------------
exports.validateQrCodeFD3 = async (req, res) => {
  try {
    const { qrData } = req.body;
    
    const qrParts = qrData.split('|');
    if (qrParts.length !== 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid QR format. Expected vehicle:plate|ticket:id|fd:FD' 
      });
    }

    const plateNumber = qrParts[0].split(':')[1];
    const ticketId = qrParts[1].split(':')[1];
    const fd = qrParts[2].split(':')[1];

    const entryLog = await EntryLog.findOne({
      plateNumber: plateNumber.toUpperCase(),
      ticket_id: ticketId
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle' 
      });
    }

    // Check if already scanned/exited
    if (entryLog.touchdown === 'Exited Successfully') {
      return res.json({ 
        success: false, 
        message: 'Vehicle already exited successfully',
        touchdown: entryLog.touchdown
      });
    }

    // Check if no ticket or no exit scan
    if (!entryLog.ticket_id || !entryLog.timeOut) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/No ticket or no exit' }
      });

      return res.json({ 
        success: false, 
        message: 'No ticket or no exit recorded, Penalty applied',
        touchdown: 'Exited/No ticket or no exit'
      });
    }

    // Check if expired
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Expired ticket' }
      });

      return res.json({ 
        success: false, 
        message: 'Expired ticket, Penalty applied',
        touchdown: 'Exited/Expired ticket'
      });
    }

    // Check if correct FD (FD3)
    if (entryLog.FD === 'FD3') {
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty applied',
        touchdown: 'Exited/Wrong Endpoint'
      });
    }
  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateVehicleStatus = async (req, res) => {
  try {
    const { plateNumber, touchdown, status, entryLogId } = req.body;
    
    // Validate required fields
    if (!plateNumber || !touchdown || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Update specific entry log if ID is provided
    if (entryLogId) {
      const updatedLog = await EntryLog.findByIdAndUpdate(
        entryLogId,
        { $set: { touchdown: touchdown } },
        { new: true }
      );

      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Entry log not found' 
        });
      }
    }

    // Update vehicle status
    const vehicleUpdate = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { $set: { status: status } },
      { new: true }
    );

    if (!vehicleUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Vehicle status updated successfully'
    });
  } catch (error) {
    console.error('Update vehicle status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update vehicle status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
//----------------------------------------fd3 scanning functions end------------------------------------

//----------------------------------------fd4 scanning functions start------------------------------------
exports.validateQrCodeFD4 = async (req, res) => {
  try {
    const { qrData } = req.body;
    
    const qrParts = qrData.split('|');
    if (qrParts.length !== 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid QR format. Expected vehicle:plate|ticket:id|fd:FD' 
      });
    }

    const plateNumber = qrParts[0].split(':')[1];
    const ticketId = qrParts[1].split(':')[1];
    const fd = qrParts[2].split(':')[1];

    const entryLog = await EntryLog.findOne({
      plateNumber: plateNumber.toUpperCase(),
      ticket_id: ticketId
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle' 
      });
    }

    // Check if already scanned/exited
    if (entryLog.touchdown === 'Exited Successfully') {
      return res.json({ 
        success: false, 
        message: 'Vehicle already exited successfully',
        touchdown: entryLog.touchdown
      });
    }

    // Check if no ticket or no exit scan
    if (!entryLog.ticket_id || !entryLog.timeOut) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/No ticket or no exit' }
      });

      return res.json({ 
        success: false, 
        message: 'No ticket or no exit recorded, Penalty applied',
        touchdown: 'Exited/No ticket or no exit'
      });
    }

    // Check if expired
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Expired ticket' }
      });

      return res.json({ 
        success: false, 
        message: 'Expired ticket, Penalty applied',
        touchdown: 'Exited/Expired ticket'
      });
    }

    // Check if correct FD (FD4)
    if (entryLog.FD === 'FD4') {
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { penaltyStatus: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty applied',
        touchdown: 'Exited/Wrong Endpoint'
      });
    }
  } catch (error) {
    console.error('QR validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateVehicleStatus = async (req, res) => {
  try {
    const { plateNumber, touchdown, status, entryLogId } = req.body;
    
    // Validate required fields
    if (!plateNumber || !touchdown || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Update specific entry log if ID is provided
    if (entryLogId) {
      const updatedLog = await EntryLog.findByIdAndUpdate(
        entryLogId,
        { $set: { touchdown: touchdown } },
        { new: true }
      );

      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Entry log not found' 
        });
      }
    }

    // Update vehicle status
    const vehicleUpdate = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { $set: { status: status } },
      { new: true }
    );

    if (!vehicleUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Vehicle status updated successfully'
    });
  } catch (error) {
    console.error('Update vehicle status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update vehicle status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
//----------------------------------------fd4 scanning functions end------------------------------------
// Add this new method to your EntranceController.js
exports.applyVehiclePenalty = async (req, res) => {
  try {
    const { plateNumber, touchdown, entryLogId } = req.body;
    
    // Validate required fields
    if (!plateNumber || !touchdown) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Update entry log touchdown
    if (entryLogId) {
      const updatedLog = await EntryLog.findByIdAndUpdate(
        entryLogId,
        { $set: { touchdown: touchdown } },
        { new: true }
      );

      if (!updatedLog) {
        return res.status(404).json({ 
          success: false, 
          message: 'Entry log not found' 
        });
      }
    }

    // Update vehicle penalty status to 'Penalty'
    const vehicleUpdate = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { 
        $set: { 
          penaltyStatus: 'Penalty',
          status: 'Ok' // Keep status as Ok, only penaltyStatus changes
        } 
      },
      { new: true }
    );

    if (!vehicleUpdate) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }
    
    res.json({ 
      success: true,
      message: 'Penalty applied successfully'
    });
  } catch (error) {
    console.error('Apply penalty error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to apply penalty',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
////---------------------------Prevent entry if Penalty start--------------------------------------------
// In entranceController.js
exports.checkVehicleStatus = async (req, res) => {
  try {
    const { identifier } = req.body;
    
    const vehicle = await Vehicle.findOne({
      $or: [
        { rfid: identifier },
        { plateNumber: identifier.toUpperCase() }
      ]
    });

    if (!vehicle) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }

    res.json({
      success: true,
      status: vehicle.status || 'Ok',
       penaltyStatus: vehicle.penaltyStatus || 'None',
      plateNumber: vehicle.plateNumber
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during status check'
    });
  }
};

// In entranceController.js
exports.getSystemState = async (req, res) => {
  try {
    const activeEntry = await EntryLog.findOne({ 
      action: 'entry',
      cleared: { $ne: true }
    }).populate('vehicle');
    
    const activeExit = await EntryLog.findOne({
      action: 'exit', 
      cleared: { $ne: true }
    }).populate('vehicle');

    const queuedEntries = await EntryLog.find({
      action: 'entry',
      status: 'queued'
    }).sort({ timestamp: 1 }).populate('vehicle');

    const queuedExits = await EntryLog.find({
      action: 'exit',
      status: 'queued' 
    }).sort({ timestamp: 1 }).populate('vehicle');

    res.json({
      entryOccupied: !!activeEntry,
      exitOccupied: !!activeExit,
      entryVehicle: activeEntry ? formatVehicle(activeEntry) : null,
      exitVehicle: activeExit ? formatVehicle(activeExit) : null,
      entryQueue: queuedEntries.map(formatVehicle),
      exitQueue: queuedExits.map(formatVehicle)
    });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to get system state'
    });
  }
};

function formatVehicle(log) {
  return {
    plateNumber: log.plateNumber,
    driverName: log.vehicle?.driverName || '',
    route: log.route || log.vehicle?.route || '',
    FD: log.FD || log.vehicle?.FD || '',
    status: log.vehicle?.status || 'Ok',
    queueNumber: log.queueing_number,
    pass: log.Pass || log.vehicle?.Pass || (log.FD === 'FD1' ? 'Pila' : 'Taxi'),
    timeIn: log.timeIN
  };
}

////---------------------------Prevent entry if penalty end--------------------------------------------


//----------------------------------------ADmin dashboard -----------------------------------------
// Add to entranceController.js
exports.getDashboardCounts = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Total trips (completed today, not ongoing)
    const totalTrips = await EntryLog.countDocuments({
      timeOut: { $gte: today },
      touchdown: { $ne: 'ongoing' }
    });

    // Pila count (completed today, not ongoing, with Pila pass)
    const pilaCount = await EntryLog.countDocuments({
      timeOut: { $gte: today },
      touchdown: { $ne: 'ongoing' },
      Pass: 'Pila'
    });

    // Taxi count (completed today, not ongoing, with Taxi pass)
    const taxiCount = await EntryLog.countDocuments({
      timeOut: { $gte: today },
      touchdown: { $ne: 'ongoing' },
      Pass: 'Taxi'
    });

    // Special Pass count (completed today, not ongoing, with SP pass)
    const specialPassCount = await EntryLog.countDocuments({
      timeOut: { $gte: today },
      touchdown: { $ne: 'ongoing' },
      Pass: 'SP'
    });

    res.json({
      success: true,
      totalTrips,
      pilaCount,
      taxiCount,
      specialPassCount
    });
  } catch (error) {
    console.error('Dashboard counts error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get dashboard counts' 
    });
  }
};

// In your entranceController.js
exports.getEntryLogsByPlateAndTouchdown = async (req, res) => {
  try {
    const { plateNumber, touchdown } = req.query;
    const logs = await EntryLog.find({ 
      plateNumber: plateNumber.toUpperCase(),
      touchdown 
    }).sort({ timeOut: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// In your entranceController.js
exports.updateEntryLogTouchdown = async (req, res) => {
  try {
    const { id } = req.params;
    const { touchdown } = req.body;
    
    const updatedLog = await EntryLog.findByIdAndUpdate(
      id,
      { touchdown },
      { new: true }
    );
    
    if (!updatedLog) {
      return res.status(404).json({ message: 'Entry log not found' });
    }
    
    res.json(updatedLog);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};




// Add to entranceController.js
exports.getPenaltyCount = async (req, res) => {
  try {
    const count = await Vehicle.countDocuments({ status: 'Penalty' });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get penalty count' 
    });
  }
};

exports.getPenaltyVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: 'Penalty' })
      .select('plateNumber status createdAt')
      .sort({ createdAt: -1 })
      .lean();
    
    // Get latest entry log for each vehicle
    const result = await Promise.all(vehicles.map(async (vehicle) => {
      const log = await EntryLog.findOne({ plateNumber: vehicle.plateNumber })
        .sort({ timeOut: -1 })
        .lean();
      
      return {
        ...vehicle,
        reason: log?.touchdown || vehicle.status,
        timeOut: log?.timeOut,
        entryLogId: log?._id,
      };
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get penalty vehicles' 
    });
  }
};

// jc start
// Add to EntranceController.js
// Updated Trip Statistics function
exports.getTripStatistics = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Ongoing trips - Pila vehicles with touchdown 'waiting' and isPass 'pila'
    const ongoingTrips = await EntryLog.countDocuments({
      timeIN: { $gte: today },
      touchdown: 'waiting',
      Pass: 'Pila',
      FD: 'FD1' // Only FD1 vehicles for Pila
    });

    // Finished trips - Pila vehicles that successfully completed their trip
    const finishedTrips = await EntryLog.countDocuments({
      timeOut: { $gte: today },
      touchdown: 'Exited Successfully',
      Pass: 'Pila',
      FD: 'FD1'
    });

    res.json({
      success: true,
      ongoingTrips,
      finishedTrips,
      totalTripsToday: ongoingTrips + finishedTrips
    });
  } catch (error) {
    console.error('Trip statistics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get trip statistics' 
    });
  }
};

// Updated Penalty Statistics function
exports.getPenaltyStatistics = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Penalties today - fetch from EntryLogs using touchdown data
    const penaltiesToday = await EntryLog.countDocuments({
      timeOut: { $gte: today, $lt: tomorrow },
      touchdown: { 
        $in: [
          'Exited/Wrong Endpoint', 
          'Exited/No ticket or no exit', 
          'Exited/Expired ticket',
          'Flagdown'
        ] 
      }
    });

    // Get detailed list of penalties today for the frontend
    const penaltiesTodayList = await EntryLog.find({
      timeOut: { $gte: today, $lt: tomorrow },
      touchdown: { 
        $in: [
          'Exited/Wrong Endpoint', 
          'Exited/No ticket or no exit', 
          'Exited/Expired ticket',
          'Flagdown'
        ] 
      }
    })
    .select('plateNumber touchdown timeOut FD Pass route')
    .sort({ timeOut: -1 })
    .lean();

    // Penalties lifted today - fetch from EntryLogs using touchdown data
    const liftedTodayList = await EntryLog.find({
      timeOut: { $gte: today, $lt: tomorrow },
      $or: [
        { touchdown: 'Penalty lifted' },
        { touchdown: 'Penalty Lifted' },
        { touchdown: { $regex: 'penalty.*lifted', $options: 'i' } }
      ]
    })
    .select('plateNumber touchdown timeOut FD Pass route')
    .sort({ timeOut: -1 })
    .lean();

    const penaltiesLiftedToday = liftedTodayList.length;

    // Total active penalties (from Vehicle collection for reference)
    const totalPenalties = await Vehicle.countDocuments({
      penaltyStatus: 'Penalty'
    });

    res.json({
      success: true,
      penaltiesToday,
      penaltiesLiftedToday,
      totalPenalties,
      penaltiesTodayList: penaltiesTodayList.map(vehicle => ({
        plateNumber: vehicle.plateNumber,
        reason: vehicle.touchdown,
        timeOut: vehicle.timeOut?.toISOString(),
        FD: vehicle.FD,
        Pass: vehicle.Pass,
        route: vehicle.route
      })),
      liftedTodayList: liftedTodayList.map(vehicle => ({
        plateNumber: vehicle.plateNumber,
        penaltyLiftedAt: vehicle.timeOut?.toISOString(),
        FD: vehicle.FD,
        Pass: vehicle.Pass,
        route: vehicle.route
      }))
    });
  } catch (error) {
    console.error('Penalty statistics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get penalty statistics' 
    });
  }
};

// Add this function for getting penalty lifted vehicles specifically
exports.getPenaltyLiftedVehicles = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find entry logs with penalty lifted touchdown status from today
    const penaltyLiftedLogs = await EntryLog.find({
      timeOut: { $gte: today, $lt: tomorrow },
      $or: [
        { touchdown: 'Penalty lifted' },
        { touchdown: 'Penalty Lifted' },
        { touchdown: { $regex: 'penalty.*lifted', $options: 'i' } }
      ]
    })
    .select('plateNumber timeOut FD Pass route touchdown')
    .sort({ timeOut: -1 })
    .lean();

    // Get vehicle details for each log
    const result = await Promise.all(
      penaltyLiftedLogs.map(async (log) => {
        const vehicle = await Vehicle.findOne({ plateNumber: log.plateNumber });
        return {
          plateNumber: log.plateNumber,
          timeOut: log.timeOut,
          penaltyLiftedAt: log.timeOut,
          FD: log.FD,
          Pass: log.Pass,
          route: log.route,
          touchdown: log.touchdown,
          vehicleStatus: vehicle?.status || 'Unknown',
          penaltyStatus: vehicle?.penaltyStatus || 'None',
          entryLogId: log._id
        };
      })
    );

    res.json({
      success: true,
      count: result.length,
      vehicles: result
    });
  } catch (error) {
    console.error('Error fetching penalty lifted vehicles:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// jc end
//----------------------------------------ADmin dashboard -----------------------------------------

// Add to entranceController.js
// In entranceController.js
exports.getActiveVehicles = async (req, res) => {
  try {
    // Get all active (non-cleared) entry logs
    const activeLogs = await EntryLog.find({ 
      cleared: { $ne: true },
      status: 'active' // Only get active logs, not queued ones
    })
    .sort({ timestamp: 1 }) // Sort by oldest first
    .populate('vehicle');

    // Separate into entry and exit sections
    const entryLog = activeLogs.find(log => log.action === 'entry');
    const exitLog = activeLogs.find(log => log.action === 'exit');
    
    // Get queued vehicles
    const queuedEntries = await EntryLog.find({
      action: 'entry',
      status: 'queued'
    }).sort({ timestamp: 1 }).populate('vehicle');
    
    const queuedExits = await EntryLog.find({
      action: 'exit',
      status: 'queued'
    }).sort({ timestamp: 1 }).populate('vehicle');

    // Format the response - ensure all fields are strings
     const formatVehicle = (log) => {
      const timeIn = log.timeIN ? new Date(log.timeIN).toISOString() : null;
      
      return {
        plateNumber: log.plateNumber?.toString() || '',
        driverName: log.vehicle?.driverName?.toString() || '',
        route: (log.route || log.vehicle?.route)?.toString() || '',
        FD: (log.FD || log.vehicle?.FD)?.toString() || '',
        status: (log.vehicle?.status || 'Ok')?.toString(),
        queueNumber: log.queueing_number?.toString() || '',
        pass: (log.Pass || log.vehicle?.Pass || (log.FD === 'FD1' ? 'Pila' : 'Taxi'))?.toString(),
        timeIn: timeIn || ''
      };
    };

    res.json({
      success: true,
      entryVehicle: entryLog ? formatVehicle(entryLog) : null,
      exitVehicle: exitLog ? formatVehicle(exitLog) : null,
      entryQueue: queuedEntries.map(formatVehicle),
      exitQueue: queuedExits.map(formatVehicle)
    });
  } catch (error) {
    console.error('Get active vehicles error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get active vehicles',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// In your websocket handler on the backend, add:
const handlePenaltyUpdate = (ws, data) => {
  const { type, plateNumber, vehicleId } = data;
  
  if (type === 'penalty_lifted') {
    // Broadcast to all connected clients
    broadcastToAll({
      type: 'penalty_lifted',
      plateNumber,
      vehicleId,
      timestamp: new Date().toISOString(),
      message: `Penalty lifted for ${plateNumber}`
    });
  }
  
  if (type === 'request_penalty_update') {
    // Send current penalty data
    sendPenaltyData(ws);
  }
};

const sendPenaltyData = async (ws) => {
  try {
    const penaltyVehicles = await Vehicle.find({ 
      penaltyStatus: { $in: ['Penalty', 'Lifted'] } 
    });
    
    ws.send(JSON.stringify({
      type: 'penalty_data',
      data: penaltyVehicles,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error sending penalty data:', error);
  }
};



// In your vehicle controller, update the penalty lifting function
exports.liftVehiclePenalty = async (req, res) => {
  try {
    const { plateNumber, entryLogId } = req.body;
    
    // Update vehicle penalty status
    const updatedVehicle = await Vehicle.findOneAndUpdate(
      { plateNumber: plateNumber.toUpperCase() },
      { 
        $set: { 
          penaltyStatus: 'Lifted',
          penaltyLiftedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updatedVehicle) {
      return res.status(404).json({ 
        success: false, 
        message: 'Vehicle not found' 
      });
    }

    // Update entry log if provided - only set Penalty Lifted if it was a penalty status
    if (entryLogId) {
      const currentLog = await EntryLog.findById(entryLogId);
      if (currentLog && currentLog.touchdown.includes('Penalty') || currentLog.touchdown.includes('Exited/')) {
        await EntryLog.findByIdAndUpdate(entryLogId, {
          $set: { touchdown: 'Penalty Lifted' }
        });
      }
      // Don't overwrite ongoing, waiting, or dispatch statuses
    }

    // Notify all connected clients via WebSocket
    notifyPenaltyLifted(updatedVehicle.plateNumber, updatedVehicle._id);

    res.json({ 
      success: true,
      message: 'Penalty lifted successfully',
      vehicle: updatedVehicle
    });
  } catch (error) {
    console.error('Lift penalty error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to lift penalty' 
    });
  }
};