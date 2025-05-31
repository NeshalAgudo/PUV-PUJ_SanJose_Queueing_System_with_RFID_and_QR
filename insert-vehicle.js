const mongoose = require('mongoose');
require('dotenv').config(); // Optional: for loading environment variables

// Define the Vehicle Schema matching your model exactly
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
    type: String,  // Added the rfid field
    trim: true
  }
}, { timestamps: true });

// Pre-save middleware
vehicleSchema.pre('save', function(next) {
  const fdMapping = {
    "SanJose - Cabanatuan City": "FD1",
    "SanJose- Cabanatuan City": "FD1", // Added to handle your data format
    "Cabanatuan - Gapan": "FD2",
    "Gapan - Pampanga": "FD3",
    "Manila - Baguio": "FD4"
  };

  this.FD = fdMapping[this.route] || "Unknown";
  next();
});

// Create the Vehicle model
const Vehicle = mongoose.model('Vehicle', vehicleSchema);

// Connect to your MongoDB database
async function connectToDatabase() {
  try {
    // Replace with your actual MongoDB connection string
    await mongoose.connect('mongodb://localhost:27017/queueing_system');
    
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
}

// Insert valid vehicle data
async function insertValidVehicleData() {
  try {
    // Create vehicle data that passes all validations
    const validVehicleData = {
      plateNumber: "OOO-1111",
      rfid: "55555555", // Added valid RFID string 02547784
      driverName: "Rfid3 Driver",
      contact: "09887766236", // 11 digits
      address: "Nueva Ecija",
      operator: "Rfid Operator",
      operatorAddress: "Nueva Ecija",
      route: "SanJose - Cabanatuan City",
      ltfrb: "000099890978", // 12 digits
      motorNo: "009989826543", // 12 digits
      yearModel: 2010,
      model: "Nissan",
      registrationDate: new Date("2024-04-28T16:00:00.000Z"),
      expiryDate: new Date("2026-01-19T16:00:00.000Z"),
      status: "Ok"
    };

    // Check if a vehicle with this plate number already exists
    const existingVehicle = await Vehicle.findOne({ plateNumber: validVehicleData.plateNumber });
    
    if (existingVehicle) {
      // Update the existing vehicle
      console.log(`Vehicle with plate number ${validVehicleData.plateNumber} already exists. Updating...`);
      await Vehicle.findOneAndUpdate(
        { plateNumber: validVehicleData.plateNumber }, 
        validVehicleData,
        { runValidators: true }
      );
      console.log('Vehicle data updated successfully!');
    } else {
      // Create a new vehicle
      const newVehicle = new Vehicle(validVehicleData);
      await newVehicle.save();
      console.log('Vehicle data inserted successfully!');
    }

    // Query the vehicle to verify it was saved correctly
    const savedVehicle = await Vehicle.findOne({ plateNumber: validVehicleData.plateNumber });
    console.log('Saved Vehicle Data:', savedVehicle);
    console.log('\nRFID Verification:');
    console.log('RFID type:', typeof savedVehicle.rfid);
    console.log('RFID value:', savedVehicle.rfid);
    console.log('RFID length:', savedVehicle.rfid ? savedVehicle.rfid.length : 'N/A');
    console.log('Status:', savedVehicle.status);
    
    // Check isValid based on your controller logic
    const isValid = savedVehicle.status === 'Ok' && 
                    typeof savedVehicle.rfid === 'string' && 
                    savedVehicle.rfid.length > 0;
    
    console.log('Is Valid:', isValid);
    
    // Now simulate your controller query to verify it works
    const vehicles = await Vehicle.find({
      plateNumber: { $regex: validVehicleData.plateNumber, $options: 'i' }
    }).select('plateNumber driverName route status rfid');
    
    const formattedResults = vehicles.map(vehicle => ({
      plateNumber: vehicle.plateNumber,
      driverName: vehicle.driverName,
      route: vehicle.route,
      status: vehicle.status,
      isValid: vehicle.status === 'Ok' && typeof vehicle.rfid === 'string' && vehicle.rfid.length > 0
    }));
    
    console.log('\nController Query Results:');
    console.log(JSON.stringify(formattedResults, null, 2));

  } catch (error) {
    console.error('Error inserting vehicle data:', error);
  } finally {
    // Close the database connection
    mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the script
async function run() {
  await connectToDatabase();
  await insertValidVehicleData();
}

run();