const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/VehicleScanController');

// Vehicle search
router.get('/search/:identifier', vehicleController.searchVehicle);

// Vehicle entry/exit operations
router.post('/entry', vehicleController.handleEntry);
router.post('/assign-queue', vehicleController.assignQueueNumber);
router.post('/exit', vehicleController.handleExit);

// Data retrieval
router.get('/queue', vehicleController.getCurrentQueue);
router.get('/details/:plateNumber', vehicleController.getVehicleDetails);

module.exports = router;