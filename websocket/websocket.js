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

// Function to get penalty data
async function getPenaltyData() {
  try {
    const penaltyVehicles = await Vehicle.find({ 
      penaltyStatus: { $in: ['Penalty', 'Lifted'] } 
    }).lean();

    // Get latest entry log for each penalty vehicle
    const penaltyData = await Promise.all(
      penaltyVehicles.map(async (vehicle) => {
        const latestLog = await EntryLog.findOne({ 
          plateNumber: vehicle.plateNumber 
        }).sort({ timeOut: -1 }).lean();

        return {
          plateNumber: vehicle.plateNumber,
          status: vehicle.status,
          penaltyStatus: vehicle.penaltyStatus,
          reason: latestLog?.touchdown || vehicle.status,
          timeOut: latestLog?.timeOut,
          entryLogId: latestLog?._id,
          vehicleId: vehicle._id,
          isLifted: vehicle.penaltyStatus === 'Lifted',
          penaltyLiftedAt: vehicle.penaltyLiftedAt,
          isLiftedToday: vehicle.penaltyStatus === 'Lifted' && 
                        vehicle.penaltyLiftedAt && 
                        new Date().getTime() - new Date(vehicle.penaltyLiftedAt).getTime() < 24 * 60 * 60 * 1000
        };
      })
    );

    return penaltyData;
  } catch (error) {
    console.error('Error getting penalty data:', error);
    return [];
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

// Function to broadcast to specific client
function sendToClient(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
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
      sendToClient(ws, {
        type: 'system_update',
        data: currentState
      });
      
      // Send penalty data on connection
      const penaltyData = await getPenaltyData();
      sendToClient(ws, {
        type: 'penalty_data',
        data: penaltyData
      });
      
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

            case 'penalty_lifted':
              // Handle penalty lifted notification
              const { plateNumber, vehicleId } = data;
              broadcastToAllClients({
                type: 'penalty_lifted',
                plateNumber,
                vehicleId,
                timestamp: new Date().toISOString(),
                message: `Penalty lifted for ${plateNumber}`
              });
              break;

            case 'request_penalty_update':
              // Send current penalty data to requesting client
              const currentPenaltyData = await getPenaltyData();
              sendToClient(ws, {
                type: 'penalty_data',
                data: currentPenaltyData
              });
              break;

            case 'vehicle_update':
              // Handle vehicle status updates
              broadcastToAllClients({
                type: 'vehicle_update',
                data: data.data,
                timestamp: new Date().toISOString()
              });
              break;
              
            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
          sendToClient(ws, {
            type: 'error',
            message: 'Failed to process message'
          });
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

// Function to notify all clients of penalty updates
async function notifyPenaltyUpdate() {
  const penaltyData = await getPenaltyData();
  broadcastToAllClients({
    type: 'penalty_update',
    data: penaltyData
  });
}

// Function to notify specific penalty lift
function notifyPenaltyLifted(plateNumber, vehicleId) {
  broadcastToAllClients({
    type: 'penalty_lifted',
    plateNumber,
    vehicleId,
    timestamp: new Date().toISOString(),
    message: `Penalty lifted for ${plateNumber}`
  });
}

// Function to notify vehicle updates
function notifyVehicleUpdate(vehicleData) {
  broadcastToAllClients({
    type: 'vehicle_update',
    data: vehicleData,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  setupWebSocket,
  notifySystemUpdate,
  notifyEntryLogsUpdate,
  notifyPenaltyUpdate,
  notifyPenaltyLifted,
  notifyVehicleUpdate,
  getPenaltyData
};