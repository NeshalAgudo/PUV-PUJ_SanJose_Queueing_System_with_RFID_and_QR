const mongoose = require('mongoose');

const QueueingSchema = new mongoose.Schema({
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
  FD: {
    type: String
  },
  Pass: {
    type: String,
    default: 'PILA'
  },
  Time_In: {
    type: Date,
    default: null
  },
  Time_Out: {
    type: Date,
    default: null
  },
  status: {
    type: String
  },
  queueDate: {
    type: Date,
    default: Date.now
  },
  fromReservation: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('Queueing', QueueingSchema);