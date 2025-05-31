  const xlsx = require('xlsx');
  const fs = require('fs');
  const path = require('path');
  const Vehicle = require('../models/Vehicle');


  // Helper function to handle scientific notation and ensure 12 digits
  function formatNumberField(value) {
    if (typeof value === 'number') {
      // Convert scientific notation to full string
      value = value.toLocaleString('fullwide', { useGrouping: false });
    }
    return value.toString().replace(/\D/g, '').padStart(12, '0').slice(0, 12);
  }

  // Helper function to parse dates with multiple formats
  function parseDateField(dateValue) {
    if (!dateValue) return new Date();
    
    // Handle Excel numeric dates
    if (typeof dateValue === 'number') {
      return xlsx.SSF.parse_date_code(dateValue);
    }
    
    const strDate = dateValue.toString();
    
    // Try ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(strDate)) {
      return new Date(strDate);
    }
    
    // Try DD-MM-YYYY format
    if (/^\d{2}-\d{2}-\d{4}$/.test(strDate)) {
      const [day, month, year] = strDate.split('-');
      return new Date(`${year}-${month}-${day}`);
    }
    
    // Fallback to JS Date parsing
    return new Date(dateValue) || new Date();
  }

  // Single vehicle registration (unchanged)
  exports.registerVehicle = async (req, res) => {
    try {
      const vehicle = new Vehicle(req.body);
      await vehicle.save();
      res.status(201).json({ 
        success: true,
        message: 'Vehicle registered successfully',
        data: vehicle
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  };

  // Improved batch import with scientific notation and date handling
  exports.batchImport = async (req, res) => {
    let filePath;

    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          message: 'No file uploaded' 
        });
      }

      filePath = path.join(__dirname, '../uploads/', req.file.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(400).json({
          success: false,
          message: 'File upload failed'
        });
      }

      // Read file safely
      const workbook = xlsx.readFile(filePath, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet, { raw: false });

      console.log('Parsed Excel Data:', data);  // ✅ Fix reference

      if (!data || data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No data found in the file'
        });
      }

      const vehicles = [];
      const errors = [];

      for (const [index, item] of data.entries()) {
        try {
          const vehicleData = {
            plateNumber: (item['Plate Number'] || item['plateNumber'] || '').toString().trim(),
            driverName: (item['Driver Name'] || item['driverName'] || '').toString().trim(),
            contact: (item['Contact'] || item['contact'] || '').toString().trim(),
            address: (item['Address'] || item['address'] || '').toString().trim(),
            operator: (item['Operator'] || item['operator'] || '').toString().trim(),
            operatorAddress: (item['Operator Address'] || item['operatorAddress'] || '').toString().trim(),
            route: (item['Route'] || item['route'] || '').toString().trim(),
            ltfrb: formatNumberField((item['LTFRB'] || item['ltfrb'] || '').toString()),
            motorNo: formatNumberField((item['Motor No'] || item['motorNo'] || '').toString()),
            yearModel: parseInt(item['Year Model'] || item['yearModel'] || new Date().getFullYear()),
            model: (item['Model'] || item['model'] || '').toString().trim(),
            registrationDate: parseDateField(item['Registration Date'] || item['registrationDate']),
            expiryDate: parseDateField(item['Expiry Date'] || item['expiryDate'])
          };
    
          console.log(`Processed Vehicle Row ${index + 2}:`, vehicleData); // ✅ Debug processed data
    
          // Validate vehicle before pushing
          const vehicle = new Vehicle(vehicleData);
          await vehicle.validate();  // ❗️ This might be failing
    
          vehicles.push(vehicleData);
        } catch (error) {
          console.error(`Validation failed for Row ${index + 2}:`, error.message);
          errors.push(`Row ${index + 2}: ${error.message}`);
        }
    } 
    

      if (vehicles.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid vehicles found',
          errors
        });
      }

      // Insert valid vehicles
      const result = await Vehicle.insertMany(vehicles);

      return res.status(201).json({
        success: true,
        message: `Successfully imported ${result.length} vehicles`,
        importedCount: result.length,
        errorCount: errors.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('Import error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error during import',
        error: error.message
      });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  };



  // Get all vehicles (unchanged) for admin vehicle management
  exports.getAllVehicles = async (req, res) => {
    try {
      const vehicles = await Vehicle.find().sort({ createdAt: -1 });
      res.status(200).json({ 
        success: true,
        data: vehicles
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  };

  exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    const disallowedUpdates = ['status', 'registrationDate', 'expiryDate', 'createdAt'];
    disallowedUpdates.forEach(field => delete updates[field]);

    // Get current vehicle data
    const currentVehicle = await Vehicle.findById(id);
    if (!currentVehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // If route is being updated, update FD as well
    if (updates.route && updates.route !== currentVehicle.route) {
      const fdMapping = {
        "SanJose - Cabanatuan City": "FD1",
        "SanJose - Carranglan": "FD2",
        "SanJose - Rizal": "FD3",
        "SanJose - Baguio": "FD4"
      };
      updates.FD = fdMapping[updates.route] || "Unknown";
    }

    // Find and update the vehicle
    const vehicle = await Vehicle.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: vehicle
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

 /*
exports.getVehiclesByStatus = async (req, res) => {
  try {
    const { status } = req.query;
    const vehicles = await Vehicle.find({ status });
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// In your vehicleController.js
exports.updateVehicleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const updatedVehicle = await Vehicle.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );
    
    if (!updatedVehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }
    
    res.json(updatedVehicle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};*/