const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  plateNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  driverName: {
    type: String,
    required: true,
    trim: true
  },
  contact: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{11}$/.test(v);
      },
      message: props => `${props.value} is not a valid 11-digit contact number!`
    }
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  operator: {
    type: String,
    required: true,
    trim: true
  },
  operatorAddress: {
    type: String,
    required: true,
    trim: true
  },
  route: {
    type: String,
    required: true,
    trim: true
  },
  FD: {
    type: String,
    default: null
  },
  ltfrb: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{12}$/.test(v);
      },
      message: props => `${props.value} is not a valid 12-digit LTFRB number!`
    }
  },
  motorNo: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{12}$/.test(v);
      },
      message: props => `${props.value} is not a valid 12-digit motor number!`
    }
  },
  yearModel: {
    type: Number,
    required: true,
    min: 1900,
    max: new Date().getFullYear()
  },
  model: {
    type: String,
    required: true,
    trim: true
  },
  registrationDate: {
    type: Date,
    required: true
  },
  expiryDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['Ok', 'Expired'], // Removed 'Penalty' from here
    default: 'Ok'
  },
  penaltyStatus: {
    type: String,
    enum: ['None', 'Penalty', 'Lifted'], // New penalty status field
    default: 'None'
  },
  rfid: {
    type: String,
    trim: true,
    default: null,
    required: false
  },
  images: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    data: Buffer,
    contentType: String,
    filename: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }]
  
}, {
  timestamps: true // This adds createdAt AND updatedAt automatically
});

// Pre-save middleware: Assign FD based on the route before saving
vehicleSchema.pre('save', function(next) {
  const fdMapping = {
    "SanJose - Cabanatuan City": "FD1",
    "SanJose - Carranglan": "FD2",
    "SanJose - Rizal": "FD3",
    "SanJose - Baguio": "FD4"
  };

  this.FD = fdMapping[this.route] || "Unknown";
  next();
});

module.exports = mongoose.model('Vehicle', vehicleSchema);