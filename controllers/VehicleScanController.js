const Vehicle = require('../models/Vehicle');
const Queueing = require('../models/Queueing');
// const { printTicket } = require('../services/printService');
const { printThermalTicket } = require('../services/thermalPrintService');
const { broadcast } = require('../websocket/websocket');

const vehicleController = {
  // Search vehicle by RFID or plate number
  searchVehicle: async (req, res) => {
    try {
      const { identifier } = req.params;
      
      // Search by RFID first
      let vehicle = await Vehicle.findOne({ rfid: identifier });
      
      // If not found by RFID, search by plate number
      if (!vehicle) {
        vehicle = await Vehicle.findOne({ plateNumber: identifier.toUpperCase() });
      }
      
      if (!vehicle) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Handle vehicle entry
  handleEntry: async (req, res) => {
    try {
      const { plateNumber, isReserved } = req.body;
      
      // Find vehicle
      const vehicle = await Vehicle.findOne({ plateNumber });
      if (!vehicle) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      
      // Check if vehicle is already in queue (not exited)
      const existingQueue = await Queueing.findOne({ 
        plateNumber, 
        Time_Out: null 
      });
      
      if (existingQueue) {
        return res.status(400).json({ 
          message: 'Vehicle is already in the queue' 
        });
      }
      
      // For FD1 vehicles that need queue number assignment
      if (vehicle.FD === 'FD1' && !isReserved) {
        // Return vehicle info and indicate queue number needed
        return res.json({
          vehicle,
          needsQueueNumber: true,
          isReserved: false
        });
      }
      
      // For reserved FD1 or non-FD1 vehicles
      let queueData = {
        queueingNumber: isReserved ? req.body.queueNumber : null,
        driverName: vehicle.driverName,
        plateNumber: vehicle.plateNumber,
        FD: vehicle.FD,
        Pass: isReserved ? 'PILA' : vehicle.FD,
        Time_In: new Date(),
        status: 'Waiting',
        fromReservation: isReserved
      };
      
      // For non-FD1 vehicles, auto-create queue entry
      if (vehicle.FD !== 'FD1') {
        const newQueue = new Queueing(queueData);
        await newQueue.save();
        
        // Broadcast update to all clients
        broadcast('queue_update', await Queueing.find().sort({ Time_In: 1 }));
        
        return res.json({
          vehicle,
          queueInfo: newQueue,
          message: `${vehicle.FD} recorded`
        });
      }
      
      // For FD1 reserved, just return info (frontend will handle confirmation)
      res.json({
        vehicle,
        isReserved: true,
        queueNumber: req.body.queueNumber
      });
      
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Assign queue number to FD1 vehicle
  assignQueueNumber: async (req, res) => {
    try {
      const { plateNumber, passType } = req.body;
      
      // Find vehicle
      const vehicle = await Vehicle.findOne({ plateNumber });
      if (!vehicle) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      
      // Get last queue number
      const lastQueue = await Queueing.findOne({ FD: 'FD1' })
        .sort('-queueingNumber');
      
      const nextNumber = lastQueue ? lastQueue.queueingNumber + 1 : 1;
      
      // Create queue entry
      const newQueue = new Queueing({
        queueingNumber: passType === 'Taxi' ? null : nextNumber,
        driverName: vehicle.driverName,
        plateNumber: vehicle.plateNumber,
        FD: vehicle.FD,
        Pass: passType,
        Time_In: new Date(),
        status: passType === 'Taxi' ? 'Taxi' : 'Waiting'
      });
      
      await newQueue.save();
      
      // Print ticket
      await printThermalTicket ({
        plateNumber: vehicle.plateNumber,
        driverName: vehicle.driverName,
        route: vehicle.route,
        FD: vehicle.FD,
        pass: passType,
        queueNumber: passType === 'Taxi' ? 'N/A' : nextNumber,
        timeIn: new Date()
      });
      
      await printTicket(ticketData);
      
      // Broadcast update to all clients
      broadcast('queue_update', await Queueing.find().sort({ Time_In: 1 }));
      
      res.json({
        success: true,
        queueInfo: newQueue,
        ticketData
      });
      
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Handle vehicle exit
  handleExit: async (req, res) => {
    try {
      const { plateNumber, newFD } = req.body;
      
      // Find active queue entry
      const queueEntry = await Queueing.findOne({ 
        plateNumber, 
        Time_Out: null 
      });
      
      if (!queueEntry) {
        return res.status(404).json({ message: 'No active queue entry found' });
      }
      
      // Update queue entry with exit time
      queueEntry.Time_Out = new Date();
      queueEntry.status = 'Exited';
      
      // Handle special pass if needed
      if (req.body.specialPass) {
        queueEntry.Pass = 'Special Pass';
        queueEntry.FD = newFD;
      }
      
      await queueEntry.save();
      
      // Print exit ticket
      const ticketData = {
        plateNumber: queueEntry.plateNumber,
        driverName: queueEntry.driverName,
        route: (await Vehicle.findOne({ plateNumber })).route,
        FD: queueEntry.FD,
        pass: queueEntry.Pass,
        queueNumber: queueEntry.queueingNumber || 'N/A',
        timeIn: queueEntry.Time_In,
        timeOut: queueEntry.Time_Out
      };
      
      await printTicket(ticketData);
      
      // Broadcast update to all clients
      broadcast('queue_update', await Queueing.find().sort({ Time_In: 1 }));
      
      res.json({
        success: true,
        queueInfo: queueEntry,
        ticketData
      });
      
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get current queue
  getCurrentQueue: async (req, res) => {
    try {
      const queue = await Queueing.find().sort({ Time_In: 1 });
      res.json(queue);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Get vehicle details
  getVehicleDetails: async (req, res) => {
    try {
      const { plateNumber } = req.params;
      const vehicle = await Vehicle.findOne({ plateNumber });
      
      if (!vehicle) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
};

module.exports = vehicleController;