const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./config/db");
const path = require('path');
const http = require('http');
// const { setupWebSocket } = require('../queueing-system-backend/websocket/websocket');

// Load environment variables
dotenv.config();

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Setup WebSocket
// setupWebSocket(server);

// Connect to database
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(helmet());

// Static files (if needed)
// if (process.env.NODE_ENV === 'production') {
//   app.use(express.static(path.join(__dirname, '../client/build')));
// }

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/vehicles', require('./routes/vehicleRoutes'));
app.use('/api/reservations', require('./routes/reservationRoutes'));
app.use('/api/queueing', require('./routes/queueingRoutes'));
app.use('/api/scan', require('./routes/vehicleScanRoutes'));
app.use('/', require('./routes/routes'));
app.use('/api', require('./routes/routes'));
app.use('/api/users', require('./routes/routes'));

// Serve frontend in production
// if (process.env.NODE_ENV === 'production') {
//   app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
//   });
// }

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Endpoint not found' 
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});