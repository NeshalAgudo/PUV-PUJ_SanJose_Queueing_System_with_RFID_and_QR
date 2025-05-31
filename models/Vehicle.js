// const mongoose = require('mongoose');

// const vehicleSchema = new mongoose.Schema({
//   plateNumber: {
//     type: String,
//     required: true,
//     unique: true,
//     uppercase: true,
//     trim: true
//   },
//   driverName: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   contact: {
//     type: String,
//     required: true,
//     validate: {
//       validator: function(v) {
//         return /^\d{11}$/.test(v);
//       },
//       message: props => `${props.value} is not a valid 11-digit contact number!`
//     }
//   },
//   address: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   operator: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   operatorAddress: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   route: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   ltfrb: {
//     type: String,
//     required: true,
//     validate: {
//       validator: function(v) {
//         return /^\d{12}$/.test(v);
//       },
//       message: props => `${props.value} is not a valid 12-digit LTFRB number!`
//     }
//   },
//   motorNo: {
//     type: String,
//     required: true,
//     validate: {
//       validator: function(v) {
//         return /^\d{12}$/.test(v);
//       },
//       message: props => `${props.value} is not a valid 12-digit motor number!`
//     }
//   },
//   yearModel: {
//     type: Number,
//     required: true,
//     min: 1900,
//     max: new Date().getFullYear()
//   },
//   model: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   registrationDate: {
//     type: Date,
//     required: true
//   },
//   expiryDate: {
//     type: Date,
//     required: true,
//     validate: {
//       validator: function(v) {
//         return v > this.registrationDate;
//       },
//       message: 'Expiry date must be after registration date!'
//     }
//   },
//   status: {
//     type: String,
//     enum: ['Ok', 'Expired', 'Penalty'], 
//     default: 'Ok' 
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// module.exports = mongoose.model('Vehicle', vehicleSchema);
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
    type: String,  // New FD field
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
    validate: {
      validator: function(v) {
        return v > this.registrationDate;
      },
      message: 'Expiry date must be after registration date!'
    }
  },
  status: {
    type: String,
    enum: ['Ok', 'Expired', 'Penalty'], 
    default: 'Ok' 
  },
  rfid: { 
    type: String, 
    trim: true, 
    default: null,
    required: false 
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 🛠️ Pre-save middleware: Assign FD based on the route before saving 
vehicleSchema.pre('save', function(next) {
  const fdMapping = {
    "SanJose - Cabanatuan City": "FD1",
    "SanJose - Carranglan": "FD2",
    "SanJose - Rizal": "FD3",
    "SanJose - Baguio": "FD4"
  };

  this.FD = fdMapping[this.route] || "Unknown"; // Assign FD based on route
  next();
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
