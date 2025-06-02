const Vehicle = require('../models/Vehicle');
const EntryLog = require('../models/EntryLog');
const moment = require('moment');

// Helper to check if we need to reset queue numbers (after midnight)
const shouldResetQueueNumber = (lastEntry) => {
  if (!lastEntry) return true;
  
  const lastEntryDate = moment(lastEntry.timestamp);
  const currentDate = moment();
  
  return !lastEntryDate.isSame(currentDate, 'day');
};

// Get next queue number with daily reset
const getNextQueueNumber = async () => {
  const lastEntry = await EntryLog.findOne({ queueing_number: { $exists: true } })
    .sort({ timestamp: -1 })
    .limit(1);

  if (shouldResetQueueNumber(lastEntry)) {
    return 1; // Reset to 1 for new day
  }

  const highestQueue = await EntryLog.findOne({ queueing_number: { $exists: true } })
    .sort({ queueing_number: -1 })
    .limit(1);

  return highestQueue ? highestQueue.queueing_number + 1 : 1;
};

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
    if (vehicle.status === 'Penalty') {
      return res.json({
        success: false,
        message: 'Vehicle has penalty status',
        status: 'Penalty'
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
      // Create queued log entry - Include queue number if FD1 with Pila pass
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
        timeIN: nextAction === 'entry' ? new Date() : null
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
          queueing_number: queuedLog.queueing_number, // Include queue number in response
          timeIN: queuedLog.timeIN
        }
      });
    }

    if (shouldCreateNewLog) {
      // Create new log entry
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
        timeIN: nextAction === 'entry' ? new Date() : null
      });
      await newLog.save();
    } else {
      // Update existing entry for exit action
      await EntryLog.findByIdAndUpdate(lastLog._id, {
        action: 'exit',
        status: 'active',
        cleared: false,
        timestamp: new Date()
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
// Update clearVehicle to only update timeOut for exit actions
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
    );

    if (!clearedLog) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    

    // For exit actions, ensure we update the original entry log with timeOut
    if (isExit) {
      await EntryLog.findOneAndUpdate(
        { 
          plateNumber: plateNumber.toUpperCase(),
          action: 'entry',
          cleared: true
        },
        { $set: { timeOut: new Date(),
          ticket_id: ticketId,  // Add ticket_id to the original entry
            qr_code_data: qrData // Add QR code data to the original entry  
         } },
        { sort: { timestamp: -1 } }
      );
    }

    // Promote next queued vehicle
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
      const vehicle = await Vehicle.findOne({ plateNumber: nextQueued.plateNumber });
      const vehicleStatus = vehicle?.status || 'Ok';
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
           // Include ticket ID and QR data for promoted vehicles
           status: vehicleStatus, 
           ticket_id: isExit ? ticketId : undefined,
           qr_code_data: isExit ? qrData : undefined
        }
      });
    }

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
exports.updateEntryLogFd = async (req, res) => {
  try {
    const { plateNumber, fd } = req.body;
    
    // Only updates the active EntryLog entry
    const updatedLog = await EntryLog.findOneAndUpdate(
      { 
        plateNumber: plateNumber.toUpperCase(),
        cleared: { $ne: true } // Only active entries
      },
      { $set: { FD: fd } }, // Updates only this entry's FD
      { new: true }
    );

    if (!updatedLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Active entry log not found' // Updated message
      });
    }

    res.json({ 
      success: true,
      plateNumber: updatedLog.plateNumber,
      updatedFd: updatedLog.FD,
      message: 'Updated FD for current entry only'
    });
  } catch (error) {
    console.error('EntryLog FD update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update entry log FD' // Updated message
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
      ticket_id: ticketId,
      FD: fd
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle and FD' 
      });
    }


    // Check if already scanned
    if (!['ongoing', 'waiting', 'dispatch'].includes(entryLog.touchdown)) {
      return res.json({ 
        success: false, 
        message: 'Ticket already scanned',
        touchdown: entryLog.touchdown
      });
    }

    // Check if expired (more than 24 hours old)
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      // Update vehicle status to penalty
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      // Update entry log
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
      // Update entry log
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD - update vehicle status and entry log
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty',
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
//----------------------------------------fd1 scanning functions------------------------------------



//----------------------------------------fd2 scanning functions------------------------------------
// Add to entranceController.js
// In controllers/entranceController.js
exports.validateQrCodeFD2 = async (req, res) => {
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
      ticket_id: ticketId,
      FD: fd
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle and FD' 
      });
    }


    // Check if already scanned
    if (!['ongoing', 'waiting', 'dispatch'].includes(entryLog.touchdown)) {
      return res.json({ 
        success: false, 
        message: 'Ticket already scanned',
        touchdown: entryLog.touchdown
      });
    }

    // Check if expired (more than 24 hours old)
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      // Update vehicle status to penalty
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      // Update entry log
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
      // Update entry log
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD - update vehicle status and entry log
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty',
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
//----------------------------------------fd2 scanning functions end------------------------------------

//----------------------------------------fd3 scanning functions start------------------------------------
exports.validateQrCodeFD3 = async (req, res) => {
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
      ticket_id: ticketId,
      FD: fd
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle and FD' 
      });
    }


    // Check if already scanned
    if (!['ongoing', 'waiting', 'dispatch'].includes(entryLog.touchdown)) {
      return res.json({ 
        success: false, 
        message: 'Ticket already scanned',
        touchdown: entryLog.touchdown
      });
    }

    // Check if expired (more than 24 hours old)
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      // Update vehicle status to penalty
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      // Update entry log
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
      // Update entry log
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD - update vehicle status and entry log
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty',
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
      ticket_id: ticketId,
      FD: fd
    });

    if (!entryLog) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found for this vehicle and FD' 
      });
    }


    // Check if already scanned
    if (!['ongoing', 'waiting', 'dispatch'].includes(entryLog.touchdown)) {
      return res.json({ 
        success: false, 
        message: 'Ticket already scanned',
        touchdown: entryLog.touchdown
      });
    }

    // Check if expired (more than 24 hours old)
    const isExpired = moment().diff(entryLog.timeOut, 'hours') > 24;
    if (isExpired) {
      // Update vehicle status to penalty
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      // Update entry log
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
      // Update entry log
      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited Successfully' }
      });

      return res.json({ 
        success: true, 
        message: 'Exit Successfully',
        touchdown: 'Exited Successfully'
      });
    } else {
      // Wrong FD - update vehicle status and entry log
      await Vehicle.findOneAndUpdate(
        { plateNumber: plateNumber.toUpperCase() },
        { $set: { status: 'Penalty' } }
      );

      await EntryLog.findByIdAndUpdate(entryLog._id, {
        $set: { touchdown: 'Exited/Wrong Endpoint' }
      });

      return res.json({ 
        success: false, 
        message: 'Wrong FD, Penalty',
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
//----------------------------------------ADmin dashboard -----------------------------------------

