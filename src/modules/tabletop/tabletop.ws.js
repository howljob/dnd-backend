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
  /** T6.6: кто сейчас «оффлайн» в игре (после обрыва, до возврата). */
  /** @type {Map<string, Set<string>>} */
  const offlineByGame = new Map();

  function hasOtherConnections(gameId, userId, exceptClient) {
    const set = subscribersByGame.get(gameId);
    if (!set) return false;
    for (const c of set) {
      if (c !== exceptClient && c.userId === userId && c.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  async function emitPresence(gameId, type, userId) {
    try {
      const event = await tabletopService.createPresenceEvent(gameId, type, userId);
      broadcastEvent(gameId, event);
    } catch (e) {
      // Лента присутствия не должна ронять сокет-сервер.
      // eslint-disable-next-line no-console
      console.error('presence event failed:', e?.message || e);
    }
  }

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

  /**
   * T6.1: рассылка события ленты подписчикам игры.
   * Приватное событие уходит только мастерам и автору.
   */
  function broadcastEvent(gameId, event) {
    const set = subscribersByGame.get(gameId);
    if (!set) return;
    for (const client of set) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (event.isPrivate && !client.isGm && client.userId !== event.actorUserId) continue;
      client.ws.send(JSON.stringify({ type: 'event', item: event }));
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

  wss.on('connection', (ws) => {
    // T6.5: токен НЕ принимается в query-строке (утекал в логи прокси и историю
    // браузера). Авторизация — только первым кадром {type:'auth', token}.
    /** @type {{ ws: import('ws'), userId: string, gameId: string | null, isGm: boolean }} */
    const client = { ws, userId: '', gameId: null, isGm: false };

    // 5 секунд на auth-кадр, иначе соединение закрывается.
    const authDeadline = setTimeout(() => {
      if (!client.userId) {
        try {
          ws.close(4401, 'Auth timeout');
        } catch (e) {
          /* ignore */
        }
      }
    }, 5000);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || ''));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (msg.type === 'auth') {
        const framePayload = verifyWsToken(msg.token);
        const frameUserId = typeof framePayload?.sub === 'string' ? framePayload.sub : null;
        if (!frameUserId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized', code: 401 }));
          ws.close(4401, 'Unauthorized');
          return;
        }
        clearTimeout(authDeadline);
        client.userId = frameUserId;
        ws.send(JSON.stringify({ type: 'authOk' }));
        return;
      }

      // До успешного auth никакие другие кадры не принимаются.
      if (!client.userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized', code: 401 }));
        ws.close(4401, 'Unauthorized');
        return;
      }

      const auth = { userId: client.userId };

      try {
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (msg.type === 'subscribe' && isUuid(msg.gameId)) {
          if (client.gameId) {
            removeSubscriber(client.gameId, client);
          }
          const membership = await tabletopService.getMyMembership(auth, msg.gameId);
          client.gameId = msg.gameId;
          client.isGm = Boolean(membership.isGm);
          addSubscriber(msg.gameId, client);
          const bundle = await tabletopService.getTabletopBundle(auth, msg.gameId);
          ws.send(JSON.stringify({ type: 'bundle', data: bundle }));
          // История ленты: последние 100 событий (мастеру — включая приватные).
          const events = await tabletopService.listTableEvents(auth, msg.gameId, { limit: 100 });
          ws.send(JSON.stringify({ type: 'events', items: events }));
          // T6.6: возвращение после обрыва — событие в ленту, контроль снова у владельца.
          const offline = offlineByGame.get(msg.gameId);
          if (offline && offline.has(client.userId)) {
            offline.delete(client.userId);
            if (offline.size === 0) offlineByGame.delete(msg.gameId);
            void emitPresence(msg.gameId, 'playerReconnected', client.userId);
          }
          return;
        }

        if (msg.type === 'rollDice' && client.gameId) {
          const event = await tabletopService.createRollEvent(auth, client.gameId, {
            formula: msg.formula,
            label: msg.label,
            mode: msg.mode,
            private: msg.private
          });
          broadcastEvent(client.gameId, event);
          return;
        }

        if (msg.type === 'action' && client.gameId) {
          const event = await tabletopService.createActionEvent(auth, client.gameId, {
            actionType: msg.actionType,
            source: msg.source,
            target: msg.target,
            detail: msg.detail,
            character: msg.character,
            spellLevel: msg.spellLevel,
            rolls: msg.rolls
          });
          broadcastEvent(client.gameId, event);
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
      clearTimeout(authDeadline);
      if (!client.gameId) return;
      const { gameId, userId } = client;
      removeSubscriber(gameId, client);
      // T6.6: обрыв соединения участника — событие в ленту (если это была
      // его последняя вкладка). Мастер и так может двигать любой токен
      // (patchSceneState для GM не ограничен владельцем).
      if (userId && !hasOtherConnections(gameId, userId, client)) {
        if (!offlineByGame.has(gameId)) offlineByGame.set(gameId, new Set());
        offlineByGame.get(gameId).add(userId);
        void emitPresence(gameId, 'playerDisconnected', userId);
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
