const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');


// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer with better error handling
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('Uploaded file mimetype:', file.mimetype);
  
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/octet-stream', // Some systems detect .xlsx as this
      'application/zip' // Some systems treat .xlsx as a zip file
    ];
  
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only CSV and Excel files are allowed`));
    }
  }
  
  
});

// Add error handling middleware
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  next();
};


const uploadimage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    files: 5 // Max 5 files
  }
});

// ... existing routes ...
router.post('/:id/images', uploadimage.array('images', 5), vehicleController.uploadVehicleImages);
router.get('/:id/images/:imageId', vehicleController.getVehicleImage);
router.delete('/:id/images/:imageId', vehicleController.deleteVehicleImage);


router.post('/register', vehicleController.registerVehicle);
router.post('/batch-import', upload.single('file'), handleUploadErrors, vehicleController.batchImport);
router.get('/', vehicleController.getAllVehicles);

module.exports = router;