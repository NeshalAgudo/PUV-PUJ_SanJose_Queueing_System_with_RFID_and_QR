// websocket/websocket.js
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const EntryLog = require('../models/EntryLog');
const Vehicle = require('../models/Vehicle');

let wss;

// Function to get current system state from database
async function getCurrentSystemState() {
  try {
    // Get active entry and exit vehicles
    const activeEntry = await EntryLog.findOne({ 
      action: 'entry',
      cleared: { $ne: true }
    }).populate('vehicle');
    
    const activeExit = await EntryLog.findOne({
      action: 'exit', 
      cleared: { $ne: true }
    }).populate('vehicle');

    // Get queued vehicles
    const queuedEntries = await EntryLog.find({
      action: 'entry',
      status: 'queued'
    }).sort({ timestamp: 1 }).populate('vehicle');

    const queuedExits = await EntryLog.find({
      action: 'exit',
      status: 'queued' 
    }).sort({ timestamp: 1 }).populate('vehicle');

    // Format function
    const formatVehicle = (log) => {
      if (!log) return null;
      
      return {
        plateNumber: log.plateNumber,
        driverName: log.vehicle?.driverName || '',
        route: log.route || log.vehicle?.route || '',
        FD: log.FD || log.vehicle?.FD || '',
        status: log.vehicle?.status || 'Ok',
        queueNumber: log.queueing_number,
        pass: log.Pass || log.vehicle?.Pass || (log.FD === 'FD1' ? 'Pila' : 'Taxi'),
        timeIn: log.timeIN
      };
    };

    return {
      entryVehicle: activeEntry ? formatVehicle(activeEntry) : null,
      exitVehicle: activeExit ? formatVehicle(activeExit) : null,
      entryQueue: queuedEntries.map(formatVehicle),
      exitQueue: queuedExits.map(formatVehicle)
    };
  } catch (error) {
    console.error('Error getting system state:', error);
    return {
      entryVehicle: null,
      exitVehicle: null,
      entryQueue: [],
      exitQueue: []
    };
  }
}

// Function to broadcast to all connected clients
function broadcastToAllClients(message) {
  if (!wss) return;
  
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Setup WebSocket server
function setupWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });
  
  wss.on('connection', async function connection(ws, req) {
    console.log('Client connected');
    
    try {
      // Extract token from query parameters
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }
      
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log(`User ${decoded.id} connected via WebSocket`);
      
      // Send current state on connection
      const currentState = await getCurrentSystemState();
      ws.send(JSON.stringify({
        type: 'system_update',
        data: currentState
      }));
      
      ws.on('message', async function incoming(message) {
        try {
          const data = JSON.parse(message);
          
          // Handle different message types
          switch (data.type) {
            case 'state_change':
              // When a client reports a state change, broadcast updated state to all
              const updatedState = await getCurrentSystemState();
              broadcastToAllClients({
                type: 'system_update',
                data: updatedState
              });
              break;
              
            case 'entry_logs_update':
              // Broadcast that entry logs need refreshing
              broadcastToAllClients({
                type: 'entry_logs_update'
              });
              break;
              
            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });
      
      ws.on('close', function close() {
        console.log('Client disconnected');
      });
      
      ws.on('error', function error(err) {
        console.error('WebSocket error:', err);
      });
      
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      ws.close(1008, 'Authentication failed');
    }
  });
  
  console.log('WebSocket server setup complete');
}

// Function to notify all clients of system changes
async function notifySystemUpdate() {
  const currentState = await getCurrentSystemState();
  broadcastToAllClients({
    type: 'system_update',
    data: currentState
  });
}

// Function to notify all clients of entry logs changes
function notifyEntryLogsUpdate() {
  broadcastToAllClients({
    type: 'entry_logs_update'
  });
}

module.exports = {
  setupWebSocket,
  notifySystemUpdate,
  notifyEntryLogsUpdate
};