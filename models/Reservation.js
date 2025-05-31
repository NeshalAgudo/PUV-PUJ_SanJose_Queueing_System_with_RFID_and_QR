const mongoose = require('mongoose');

const ReservationSchema = new mongoose.Schema({
  queueingNumber: {
    type: Number,
    required: true
  },
  driverName: {
    type: String,
    required: true
  },
  plateNumber: {
    type: String,
    required: true,
    ref: 'Vehicle'
  },
  route: {
    type: String,
    required: true
  },
  reservation_date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Reserved', 'Cancelled', 'Transferred'],
    default: 'Reserved'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Static method to get the next queueing number for a specific date
ReservationSchema.statics.getNextQueueingNumber = async function(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  // Find all reservations for the given date
  const reservations = await this.find({
    reservation_date: {
      $gte: startOfDay,
      $lte: endOfDay
    }
  }).sort({ queueingNumber: -1 });
  
  // If no reservations exist, start with 1
  if (reservations.length === 0) {
    return 1;
  }
  
  // Return the highest queueing number + 1
  return reservations[0].queueingNumber + 1;
};

module.exports = mongoose.model('Reservation', ReservationSchema);