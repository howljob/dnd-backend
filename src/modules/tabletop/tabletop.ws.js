const { WebSocketServer, WebSocket } = require('ws');
const { authenticateAccessToken } = require('../../middleware/auth.middleware');
const tabletopService = require('./tabletop.service');

const MAX_WS_MESSAGE_BYTES = 64 * 1024;

let tabletopWss = null;

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function sendError(socket, message) {
  sendJson(socket, {
    type: 'error',
    message
  });
}

function getRequestToken(request) {
  const url = new URL(request.url, 'http://localhost');
  return url.searchParams.get('token') || '';
}

async function sendLatestBundle(socket) {
  if (!socket.tabletopGameId || !socket.tabletopAuth) {
    return;
  }

  const data = await tabletopService.getBundle(socket.tabletopAuth, socket.tabletopGameId, {
    createDefaultForGm: false
  });
  sendJson(socket, { type: 'bundle', data });
}

async function handleSubscribe(socket, message) {
  const gameId = typeof message.gameId === 'string' ? message.gameId.trim() : '';
  const data = await tabletopService.getBundle(socket.tabletopAuth, gameId);

  socket.tabletopGameId = data.gameId;
  sendJson(socket, { type: 'bundle', data });
}

async function handlePatchScene(socket, message) {
  if (!socket.tabletopGameId) {
    throw Object.assign(new Error('Not subscribed'), { statusCode: 400 });
  }

  await tabletopService.patchScene(socket.tabletopAuth, socket.tabletopGameId, message.sceneId, {
    target: message.target,
    baseVersion: message.baseVersion,
    patch: message.patch
  });
  await broadcastGameBundle(socket.tabletopGameId);
}

async function handlePublishScene(socket, message) {
  if (!socket.tabletopGameId) {
    throw Object.assign(new Error('Not subscribed'), { statusCode: 400 });
  }

  await tabletopService.publishScene(
    socket.tabletopAuth,
    socket.tabletopGameId,
    message.sceneId
  );
  await broadcastGameBundle(socket.tabletopGameId);
}

async function handleMessage(socket, rawMessage) {
  if (rawMessage.length > MAX_WS_MESSAGE_BYTES) {
    sendError(socket, 'Message is too large');
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage.toString('utf8'));
  } catch (error) {
    sendError(socket, 'Invalid JSON message');
    return;
  }

  try {
    if (message.type === 'subscribe') {
      await handleSubscribe(socket, message);
      return;
    }

    if (message.type === 'patchScene') {
      await handlePatchScene(socket, message);
      return;
    }

    if (message.type === 'publishScene') {
      await handlePublishScene(socket, message);
      return;
    }

    sendError(socket, 'Unknown message type');
  } catch (error) {
    sendError(socket, error.statusCode === 409 ? 'Stale baseVersion' : error.message);
    if (error.statusCode === 409) {
      try {
        await sendLatestBundle(socket);
      } catch (bundleError) {
        sendError(socket, bundleError.message);
      }
    }
  }
}

function initializeTabletopWebSocketServer(server) {
  if (tabletopWss) {
    return tabletopWss;
  }

  tabletopWss = new WebSocketServer({
    server,
    path: '/ws/tabletop'
  });

  tabletopWss.on('connection', async (socket, request) => {
    try {
      const token = getRequestToken(request);
      socket.tabletopAuth = await authenticateAccessToken(token);
    } catch (error) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    socket.on('message', (rawMessage) => {
      handleMessage(socket, rawMessage).catch((error) => {
        sendError(socket, error.message || 'Internal server error');
      });
    });
  });

  return tabletopWss;
}

async function broadcastGameBundle(gameId) {
  if (!tabletopWss) {
    return;
  }

  const sockets = Array.from(tabletopWss.clients)
    .filter((socket) => socket.readyState === WebSocket.OPEN && socket.tabletopGameId === gameId);

  await Promise.all(sockets.map(async (socket) => {
    try {
      await sendLatestBundle(socket);
    } catch (error) {
      sendError(socket, error.message);
      if (error.statusCode === 401 || error.statusCode === 403) {
        socket.close(1008, 'Forbidden');
      }
    }
  }));
}

module.exports = {
  initializeTabletopWebSocketServer,
  broadcastGameBundle
};
