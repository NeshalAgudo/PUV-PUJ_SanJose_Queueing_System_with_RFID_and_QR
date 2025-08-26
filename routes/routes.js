// routes.js
const express = require('express');
const router = express.Router();
const entranceController = require('../controllers/EntranceController');
const vehicleController  = require('../controllers/vehicleController');
const userController = require('../controllers/userController');

const { authenticate, adminOnly } = require("../middlewares/authMiddleware");

// Vehicle search route
router.post('/api/vehicles/search', entranceController.searchVehicle);
router.post('/api/vehicles/clear', entranceController.clearVehicle);
// Add to your routes file
router.get('/entryLogs', entranceController.getEntryLogs);

router.get('/queue/next', entranceController.getNextQueueNumber);
router.post('/vehicles/updatePass', entranceController.updateVehiclePass);

router.post('/entryLogs/updateEntryLogFd', entranceController.updateEntryLogFd);




//fd1 qr scanning function route
// In routes/entranceRoutes.js
router.post('/validateQr', entranceController.validateQrCode);
router.post('/entryLogs/updateVehicleStatus', entranceController.updateVehicleStatus);

//fd2 qr scanning function route
// In your routes file
router.post('/validateQrFD2', entranceController.validateQrCodeFD2);
router.post('/entryLogs/validateQrFD2', entranceController.validateQrCodeFD2);

//fd3 qr scanning function route
// In your routes file
router.post('/validateQrFD3', entranceController.validateQrCodeFD3);
router.post('/entryLogs/validateQrFD3', entranceController.validateQrCodeFD3);

//fd4 qr scanning function route
// In your routes file
router.post('/validateQrFD4', entranceController.validateQrCodeFD4);
router.post('/entryLogs/validateQrFD4', entranceController.validateQrCodeFD4);



//Prevent entry if penalty
router.post('/vehicles/checkStatus', entranceController.checkVehicleStatus);
router.get('/system/state', entranceController.getSystemState);

//---- Admin dashboard
// In your routes file (usually routes.js or similar)
router.get('/entryLogs/dashboardCounts', entranceController.getDashboardCounts);
router.get('/vehicles/penaltyCount', entranceController.getPenaltyCount);


//admin vehicleController.js for fetch and update details vehicle_managfement.dart
router.get('/api/vehicles', vehicleController.getAllVehicles);
router.put('/api/vehicles/:id', vehicleController.updateVehicle);

// User management routes
// In your routes file
router.get('/users', authenticate, adminOnly, userController.getAllUsers);
router.post('/', authenticate, adminOnly, userController.createUser);
router.put('/:id', authenticate, adminOnly, userController.updateUser);
// router.delete('/:id', authenticate, adminOnly, userController.deleteUser);
router.patch('/users/:id/disable', authenticate, adminOnly, userController.disableUser);
router.patch('/users/:id/enable', authenticate, adminOnly, userController.enableUser);
router.get('/entryLogs/active', entranceController.getActiveVehicles);
module.exports = router;