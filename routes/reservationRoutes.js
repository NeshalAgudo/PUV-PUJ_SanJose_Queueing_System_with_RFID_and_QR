const express = require('express');
const router = express.Router();
const { 
  getUpcomingReservations,
  createReservation,
  cancelReservation,
  transferToQueueing,
  getPastReservations,
  getVehicleStatus
} = require('../controllers/reservationController');

// Get upcoming reservations (tomorrow and day after)
router.get('/upcoming', getUpcomingReservations);

// Create a new reservation
router.post('/', createReservation);

// Cancel a reservation
router.delete('/:id', cancelReservation);

// Transfer tomorrow's reservations to queueing
router.post('/transfer-to-queueing', transferToQueueing);

// Get past reservations with filtering
router.get('/past', getPastReservations);

// Get vehicle status for autocomplete
router.get('/vehicle-status', getVehicleStatus);

module.exports = router;