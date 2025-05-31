// models/EntryLog.js
const mongoose = require('mongoose');

const entryLogSchema = new mongoose.Schema({
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  plateNumber: {
    type: String,
    required: true,
    uppercase: true
  },
  action: {
    type: String,
    enum: ['entry', 'exit'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'queued'],
    default: 'active'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  cleared: {
    type: Boolean,
    default: false
  },
  timeIN: {
    type: Date,
    default: Date.now
  },
  timeOut: {
    type: Date,
    default: null
  },
  route: {
    type: String,
    default: function() {
      return this.vehicle?.route || null; // Default to vehicle's route if available
    }
  },
  FD: {
    type: String,
    default: function() {
      return this.vehicle?.FD || null; // Default to vehicle's FD if available
    }
  },
  Pass: {
    type: String,
    default: function() {
      // Default to 'Pila' for FD1, 'Taxi' for others
      return this.vehicle?.FD === 'FD1' ? 'Pila' : 'Taxi';
    }
  },
  queueing_number: {
    type: Number,
    default: null
  },
  touchdown: {
    type: String,
     enum: [
      'ongoing',
      'waiting',
      'dispatch',      
      'Exited Successfully',
      'Exited/Wrong Endpoint',
      'Exited/Expired ticket',
      'Exited/No Ticket',
      'Exited/No Exit',
      'canceled',
      'processing', 
    ],
    default: 'processing'
  },
  ticket_id: {
    type: String,
    default: null
  }
});

module.exports = mongoose.model('EntryLog', entryLogSchema);