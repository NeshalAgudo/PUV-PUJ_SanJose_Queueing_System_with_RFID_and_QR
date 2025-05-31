const Reservation = require('../models/Reservation');
const Vehicle = require('../models/Vehicle'); // Assuming this model exists
const Queueing = require('../models/Queueing');
const { startOfDay, endOfDay, addDays, format } = require('date-fns');

// Get reservations for tomorrow and day after tomorrow
exports.getUpcomingReservations = async (req, res) => {
  try {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const dayAfterTomorrow = addDays(today, 2);
    
    // Get tomorrow's reservations
    const tomorrowStart = startOfDay(tomorrow);
    const tomorrowEnd = endOfDay(tomorrow);
    
    const tomorrowReservations = await Reservation.find({
      reservation_date: {
        $gte: tomorrowStart,
        $lte: tomorrowEnd
      },
      status: 'Reserved'
    }).sort({ queueingNumber: 1 });
    
    // Get day after tomorrow's reservations
    const dayAfterTomorrowStart = startOfDay(dayAfterTomorrow);
    const dayAfterTomorrowEnd = endOfDay(dayAfterTomorrow);
    
    const dayAfterTomorrowReservations = await Reservation.find({
      reservation_date: {
        $gte: dayAfterTomorrowStart,
        $lte: dayAfterTomorrowEnd
      },
      status: 'Reserved'
    }).sort({ queueingNumber: 1 });
    
    res.status(200).json({
      success: true,
      data: {
        tomorrow: {
          date: format(tomorrow, 'yyyy-MM-dd'),
          dayName: format(tomorrow, 'EEEE'),
          reservations: tomorrowReservations
        },
        dayAfterTomorrow: {
          date: format(dayAfterTomorrow, 'yyyy-MM-dd'),
          dayName: format(dayAfterTomorrow, 'EEEE'),
          reservations: dayAfterTomorrowReservations
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching upcoming reservations',
      error: error.message
    });
  }
};

// Create a new reservation
exports.createReservation = async (req, res) => {
  try {
    const { driverName, plateNumber, reservation_date } = req.body;
    
    // Check if the vehicle exists and get its status
    const vehicle = await Vehicle.findOne({ plateNumber });
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }
    
    // Check if vehicle has appropriate status
    if (vehicle.status !== 'Ok' || typeof vehicle.rfid !== 'string' || vehicle.rfid.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle has restrictions and cannot be reserved',
          vehicleStatus: vehicle.status,
          hasRfid: !!vehicle.rfid,
          rfidType: typeof vehicle.rfid,
          rfidLength: vehicle.rfid?.length || 0
        });
      }
    
    // Check for duplicate reservation on the same date
    const resDate = new Date(reservation_date);
    const dateStart = startOfDay(resDate);
    const dateEnd = endOfDay(resDate);
    
    const existingReservation = await Reservation.findOne({
      plateNumber,
      reservation_date: {
        $gte: dateStart,
        $lte: dateEnd
      },
      status: 'Reserved'
    });
    
    if (existingReservation) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle already has a reservation for this date'
      });
    }
    
    // Get the next queueing number for this date
    const nextQueueingNumber = await Reservation.getNextQueueingNumber(resDate);
    
    // Create the reservation
    const newReservation = await Reservation.create({
      queueingNumber: nextQueueingNumber,
      driverName,
      plateNumber,
      route: vehicle.route, // Auto-populate from vehicle data
      reservation_date: resDate,
      status: 'Reserved'
    });
    
    res.status(201).json({
      success: true,
      data: newReservation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating reservation',
      error: error.message
    });
  }
};

// Cancel a reservation
exports.cancelReservation = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete the reservation
    const result = await Reservation.findByIdAndDelete(id);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Reservation cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error cancelling reservation',
      error: error.message
    });
  }
};

// Transfer tomorrow's reservations to queueing
exports.transferToQueueing = async (req, res) => {
  try {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    
    // Get tomorrow's reservations
    const tomorrowStart = startOfDay(tomorrow);
    const tomorrowEnd = endOfDay(tomorrow);
    
    const tomorrowReservations = await Reservation.find({
      reservation_date: {
        $gte: tomorrowStart,
        $lte: tomorrowEnd
      },
      status: 'Reserved'
    });
    
    // Create queueing entries for each reservation
    const queueingEntries = [];
    
    for (const reservation of tomorrowReservations) {
      // Fetch vehicle details to get FD and status
      const vehicle = await Vehicle.findOne({ plateNumber: reservation.plateNumber });
      
      const queueEntry = await Queueing.create({
        queueingNumber: reservation.queueingNumber,
        driverName: reservation.driverName,
        plateNumber: reservation.plateNumber,
        FD: vehicle ? vehicle.FD : null,
        Pass: 'PILA',
        status: vehicle ? vehicle.status : null,
        fromReservation: true
      });
      
      queueingEntries.push(queueEntry);
      
      // Update reservation status
      await Reservation.findByIdAndUpdate(reservation._id, {
        status: 'Transferred'
      });
    }
    
    res.status(200).json({
      success: true,
      message: `${queueingEntries.length} reservations transferred to queueing successfully`,
      data: queueingEntries
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error transferring reservations to queueing',
      error: error.message
    });
  }
};

// Get past reservations with filtering
exports.getPastReservations = async (req, res) => {
  try {
    const { date, plateNumber, driverName } = req.query;
    const today = new Date();
    
    // Build filter query
    const filterQuery = {
      reservation_date: { $lt: startOfDay(today) }
    };
    
    if (date) {
      const filterDate = new Date(date);
      filterQuery.reservation_date = {
        $gte: startOfDay(filterDate),
        $lte: endOfDay(filterDate)
      };
    }
    
    if (plateNumber) {
      filterQuery.plateNumber = { $regex: plateNumber, $options: 'i' };
    }
    
    if (driverName) {
      filterQuery.driverName = { $regex: driverName, $options: 'i' };
    }
    
    const pastReservations = await Reservation.find(filterQuery)
      .sort({ reservation_date: -1, queueingNumber: 1 });
    
    res.status(200).json({
      success: true,
      count: pastReservations.length,
      data: pastReservations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching past reservations',
      error: error.message
    });
  }
};

// Get vehicle status while typing plate number (for autocomplete)
exports.getVehicleStatus = async (req, res) => {
  try {
    const { plateNumber } = req.query;
    
    if (!plateNumber || plateNumber.length < 2) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }
    
    const vehicles = await Vehicle.find({
      plateNumber: { $regex: plateNumber, $options: 'i' }
    }).select('plateNumber driverName route status rfid');
    
    const formattedResults = vehicles.map(vehicle => ({
      plateNumber: vehicle.plateNumber,
      driverName: vehicle.driverName,
      route: vehicle.route,
      status: vehicle.status,
      rfid: vehicle.rfid || '', 
      isValid: vehicle.status === 'Ok' && typeof vehicle.rfid === 'string' && vehicle.rfid.length > 0
    }));
    
    res.status(200).json({
      success: true,
      data: formattedResults
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching vehicle status',
      error: error.message
    });
  }
};