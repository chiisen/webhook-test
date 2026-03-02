const WebSocket = require('ws');

const WS_PORT = parseInt(process.env.WS_PORT || '9998', 10);
const WS_ENABLED = process.env.WS_ENABLED === 'true';

let wss = null;
let clients = new Set();

const initWebSocket = (server) => {
  if (!WS_ENABLED) {
    console.log('WebSocket disabled');
    return null;
  }

  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 WebSocket client connected: ${clientIp}`);
    clients.add(ws);

    ws.on('message', (message) => {
      console.log(`📩 Received: ${message}`);
      try {
        const data = JSON.parse(message);
        handleClientMessage(ws, data);
      } catch (e) {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      console.log(`🔌 WebSocket client disconnected: ${clientIp}`);
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      clients.delete(ws);
    });

    ws.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to Webhook Server',
        timestamp: new Date().toISOString()
      })
    );
  });

  console.log(`🚀 WebSocket server running on port ${WS_PORT} at /ws`);

  return wss;
};

const handleClientMessage = (ws, data) => {
  switch (data.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    case 'subscribe':
      ws.subscriptions = data.channels || [];
      ws.send(
        JSON.stringify({
          type: 'subscribed',
          channels: ws.subscriptions
        })
      );
      break;
    default:
      ws.send(JSON.stringify({ error: 'Unknown message type' }));
  }
};

const broadcast = (type, data) => {
  if (!wss) return;

  const message = JSON.stringify({
    type,
    data,
    timestamp: new Date().toISOString()
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (e) {
        console.error('Broadcast error:', e.message);
      }
    }
  });
};

const broadcastAlert = (payload) => {
  broadcast('alert', payload);
};

const broadcastRequest = (request) => {
  broadcast('request', request);
};

const getClientCount = () => {
  return clients.size;
};

const closeWebSocket = () => {
  if (wss) {
    clients.forEach((client) => client.close());
    wss.close();
    wss = null;
    clients.clear();
  }
};

module.exports = {
  initWebSocket,
  broadcast,
  broadcastAlert,
  broadcastRequest,
  getClientCount,
  closeWebSocket,
  get isEnabled() {
    return WS_ENABLED;
  }
};
