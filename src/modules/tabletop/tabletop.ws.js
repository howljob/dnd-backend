const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const tabletopService = require('./tabletop.service');

function verifyWsToken(token) {
  if (!token || !env.jwtAccessSecret) {
    return null;
  }
  try {
    return jwt.verify(String(token).trim(), env.jwtAccessSecret);
  } catch (e) {
    return null;
  }
}

let notifyTabletopGameImpl = null;

function attachTabletopWs(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });
  /** @type {Map<string, Set<{ ws: import('ws'), userId: string }>>} */
  const subscribersByGame = new Map();

  function addSubscriber(gameId, client) {
    if (!subscribersByGame.has(gameId)) {
      subscribersByGame.set(gameId, new Set());
    }
    subscribersByGame.get(gameId).add(client);
  }

  function removeSubscriber(gameId, client) {
    const set = subscribersByGame.get(gameId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      subscribersByGame.delete(gameId);
    }
  }

  async function broadcastBundle(gameId) {
    const set = subscribersByGame.get(gameId);
    if (!set) return;
    for (const client of set) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        const bundle = await tabletopService.getTabletopBundle(
          { userId: client.userId },
          gameId
        );
        client.ws.send(JSON.stringify({ type: 'bundle', data: bundle }));
      } catch (e) {
        client.ws.send(JSON.stringify({
          type: 'error',
          message: e?.message || 'Failed to load bundle'
        }));
      }
    }
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    const pathname = new URL(request.url, `http://${host}`).pathname;
    if (pathname !== '/ws/tabletop') {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  notifyTabletopGameImpl = (gameId) => broadcastBundle(gameId);

  wss.on('connection', (ws, request) => {
    const host = request.headers.host || 'localhost';
    const url = new URL(request.url, `http://${host}`);
    const token = url.searchParams.get('token') || '';
    const payload = verifyWsToken(token);
    const userId = typeof payload?.sub === 'string' ? payload.sub : null;

    /** @type {{ ws: import('ws'), userId: string, gameId: string | null }} */
    const client = { ws, userId: userId || '', gameId: null };

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || ''));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        return;
      }

      const auth = { userId };

      try {
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'subscribe' && isUuid(msg.gameId)) {
          if (client.gameId) {
            removeSubscriber(client.gameId, client);
          }
          await tabletopService.getMyMembership(auth, msg.gameId);
          client.gameId = msg.gameId;
          addSubscriber(msg.gameId, client);
          const bundle = await tabletopService.getTabletopBundle(auth, msg.gameId);
          ws.send(JSON.stringify({ type: 'bundle', data: bundle }));
          return;
        }

        if (msg.type === 'patchScene' && client.gameId && isUuid(msg.sceneId)) {
          const body = {
            target: msg.target === 'published' ? 'published' : 'draft',
            patch: msg.patch && typeof msg.patch === 'object' ? msg.patch : {}
          };
          await tabletopService.patchSceneState(auth, client.gameId, msg.sceneId, body);
          await broadcastBundle(client.gameId);
          return;
        }

        if (msg.type === 'publishScene' && client.gameId && isUuid(msg.sceneId)) {
          await tabletopService.publishScene(auth, client.gameId, msg.sceneId);
          await broadcastBundle(client.gameId);
          return;
        }

        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message' }));
      } catch (e) {
        const code = e?.statusCode || 500;
        ws.send(JSON.stringify({
          type: 'error',
          message: e?.message || 'Server error',
          code
        }));
      }
    });

    ws.on('close', () => {
      if (client.gameId) {
        removeSubscriber(client.gameId, client);
      }
    });
  });

  return wss;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function notifyTabletopGame(gameId) {
  if (typeof notifyTabletopGameImpl === 'function') {
    return notifyTabletopGameImpl(gameId);
  }
  return Promise.resolve();
}

module.exports = {
  attachTabletopWs,
  notifyTabletopGame
};
