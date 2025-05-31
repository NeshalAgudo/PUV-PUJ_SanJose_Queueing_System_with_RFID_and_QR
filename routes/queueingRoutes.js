const express = require('express');
const router = express.Router();
const { 
  getTodayQueueing,
  createQueueingEntry,
  updateTimeOut
} = require('../controllers/queueingController');

// Get today's queueing list
router.get('/today', getTodayQueueing);

// Create a new queueing entry (for walk-ins)
router.post('/', createQueueingEntry);

// Update Time_Out for a queueing entry
router.put('/:id/time-out', updateTimeOut);

module.exports = router;