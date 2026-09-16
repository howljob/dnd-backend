// T6.1: тест серверного лога событий стола.
// Два WS-клиента (мастер и игрок): бросок игрока приходит мастеру за ≤1 с,
// приватный бросок мастера игроку не приходит, история доступна по REST
// и при повторной подписке (переподключение).
//
// Запуск: npm test (база должна быть поднята и мигрирована).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

const app = require('../src/app');
const pool = require('../src/db/pool');
const { attachTabletopWs } = require('../src/modules/tabletop/tabletop.ws');

let server;
let baseUrl;
let wsUrl;

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // не-JSON ответ
  }
  return { status: res.status, json };
}

async function registerAndLogin(suffix) {
  const email = `t6-events-${Date.now()}-${suffix}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'T6-Events-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', {
    email,
    password,
    displayName: `T6 ${suffix}`
  });
  assert.equal(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
  // T3.2: создание игр требует подтверждённой почты — подтверждаем тестового пользователя напрямую
  await pool.query('UPDATE users SET email_confirmed_at = now() WHERE email = $1', [email]);
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200, `login: ${JSON.stringify(login.json)}`);
  return { token: login.json.token, user: login.json.user };
}

/**
 * Открывает WS, проходит auth-кадр и подписку, копит входящие сообщения.
 */
function openTableSocket(token, gameId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const waiters = [];

    const conn = {
      ws,
      messages,
      /** Ждёт первое сообщение, удовлетворяющее predicate, не дольше timeout мс. */
      waitFor(predicate, timeoutMs = 3000) {
        const existing = messages.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            rej(new Error(`waitFor timeout: ${messages.map((m) => m.type).join(',') || 'no messages'}`));
          }, timeoutMs);
          waiters.push({ predicate, resolve: res, timer });
        });
      },
      close() {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].predicate(msg)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      ws.send(JSON.stringify({ type: 'subscribe', gameId }));
      conn.waitFor((m) => m.type === 'bundle')
        .then(() => resolve(conn))
        .catch(reject);
    });
  });
}

test.before(async () => {
  server = http.createServer(app);
  attachTabletopWs(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws/tabletop`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// T6.5: до auth-кадра сервер не принимает другие кадры и закрывает соединение.
test('WS: кадр до авторизации приводит к закрытию соединения', async () => {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let gotError = false;
    const guard = setTimeout(() => reject(new Error('соединение не закрыто')), 4000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', gameId: '00000000-0000-4000-8000-000000000000' }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'error' && msg.code === 401) gotError = true;
    });
    ws.on('close', () => {
      clearTimeout(guard);
      try {
        assert.equal(gotError, true, 'не пришла ошибка 401');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    ws.on('error', reject);
  });
});

test('лог событий стола: рассылка, приватность, история', async () => {
  const master = await registerAndLogin('master');
  const player = await registerAndLogin('player');

  // Игра + одобренный игрок.
  const types = await api('GET', '/api/game-types');
  const gameTypeId = types.json.items[0].id;
  const created = await api('POST', '/api/games', {
    title: `T6 events ${Date.now()}`,
    description: 'Тест лога событий',
    gameTypeId,
    startsAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
    maxPlayers: 4,
    language: 'ru',
    playerLevel: 'beginner',
    isPaid: false,
    priceAmount: null,
    format: 'online',
    location: null,
    creatorRole: 'gm',
    kind: 'one_shot'
  }, master.token);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const gameId = created.json.game.id;

  const join = await api('POST', `/api/games/${gameId}/join`, { requestedRole: 'player' }, player.token);
  assert.ok([200, 201].includes(join.status), JSON.stringify(join.json));
  const memberships = await api('GET', `/api/games/${gameId}/memberships`, undefined, master.token);
  const pending = memberships.json.items.find((m) => m.status === 'pending');
  assert.ok(pending, 'нет pending-заявки');
  const approve = await api('PATCH', `/api/game-memberships/${pending.id}/approve`, {}, master.token);
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  const masterWs = await openTableSocket(master.token, gameId);
  const playerWs = await openTableSocket(player.token, gameId);

  try {
    // 1. Бросок игрока виден мастеру за ≤1 с.
    const started = Date.now();
    playerWs.ws.send(JSON.stringify({ type: 'rollDice', formula: '1d20+3', label: 'ЛОВ' }));
    const rollMsg = await masterWs.waitFor(
      (m) => m.type === 'event' && m.item?.type === 'roll',
      3000
    );
    const deliveryMs = Date.now() - started;
    assert.ok(deliveryMs <= 1000, `бросок дошёл за ${deliveryMs} мс (> 1000)`);
    assert.equal(rollMsg.item.payload.formula, '1d20+3');
    assert.ok(rollMsg.item.payload.total >= 4 && rollMsg.item.payload.total <= 23);
    assert.equal(rollMsg.item.isPrivate, false);
    // Автору тоже пришло.
    await playerWs.waitFor((m) => m.type === 'event' && m.item?.type === 'roll');

    // 2. Приватный бросок мастера игроку не приходит.
    masterWs.ws.send(JSON.stringify({ type: 'rollDice', formula: '1d20', private: true }));
    const privateMsg = await masterWs.waitFor(
      (m) => m.type === 'event' && m.item?.isPrivate === true
    );
    assert.equal(privateMsg.item.type, 'roll');
    await new Promise((resolve) => setTimeout(resolve, 700));
    const leaked = playerWs.messages.find((m) => m.type === 'event' && m.item?.isPrivate === true);
    assert.equal(leaked, undefined, 'приватный бросок мастера утёк игроку');

    // 2а. Игрок не может бросать приватно.
    playerWs.ws.send(JSON.stringify({ type: 'rollDice', formula: '1d20', private: true }));
    const denial = await playerWs.waitFor((m) => m.type === 'error');
    assert.equal(denial.code, 403);

    // 3. Действие-заклинание в ленте у обоих со всеми частями.
    playerWs.ws.send(JSON.stringify({
      type: 'action',
      actionType: 'spell',
      source: 'Огненный шар',
      target: 'Гоблин',
      spellLevel: 3,
      rolls: [{ kind: 'damage', formula: '8d6' }]
    }));
    const actionMsg = await masterWs.waitFor((m) => m.type === 'event' && m.item?.type === 'action');
    assert.equal(actionMsg.item.payload.actionType, 'spell');
    assert.equal(actionMsg.item.payload.source, 'Огненный шар');
    assert.equal(actionMsg.item.payload.target, 'Гоблин');
    assert.equal(actionMsg.item.payload.spellLevel, 3);
    assert.equal(actionMsg.item.payload.rolls.length, 1);
    assert.ok(actionMsg.item.payload.rolls[0].total >= 8 && actionMsg.item.payload.rolls[0].total <= 48);

    // 4. Мусорная формула отклоняется.
    playerWs.ws.send(JSON.stringify({ type: 'rollDice', formula: 'DROP TABLE users' }));
    const badFormula = await playerWs.waitFor(
      (m) => m.type === 'error' && m.code === 400
    );
    assert.ok(badFormula);

    // 5. REST-история: игрок не видит приватное событие мастера, мастер видит.
    const playerEvents = await api('GET', `/api/tabletop/games/${gameId}/events`, undefined, player.token);
    assert.equal(playerEvents.status, 200);
    assert.ok(playerEvents.json.items.length >= 2);
    assert.equal(
      playerEvents.json.items.find((e) => e.isPrivate),
      undefined,
      'приватное событие в истории игрока'
    );
    const masterEvents = await api('GET', `/api/tabletop/games/${gameId}/events`, undefined, master.token);
    assert.ok(masterEvents.json.items.some((e) => e.isPrivate), 'мастер не видит приватное в истории');

    // Пагинация ?before= отдаёт только более ранние события.
    const lastId = masterEvents.json.items[masterEvents.json.items.length - 1].id;
    const pageBefore = await api(
      'GET',
      `/api/tabletop/games/${gameId}/events?before=${lastId}`,
      undefined,
      master.token
    );
    assert.ok(pageBefore.json.items.every((e) => e.id < lastId));

    // 6. T6.6: обрыв соединения игрока → событие мастеру; возврат → событие
    // и докачка пропущенного через свежую подписку.
    playerWs.close();
    const gone = await masterWs.waitFor(
      (m) => m.type === 'event' && m.item?.type === 'playerDisconnected',
      3000
    );
    assert.equal(gone.item.actorUserId, player.user.id);

    // Пока игрок оффлайн, мастер бросает кубик — игрок должен получить это из истории.
    masterWs.ws.send(JSON.stringify({ type: 'rollDice', formula: '1d6', label: 'пока игрока нет' }));
    await masterWs.waitFor((m) => m.type === 'event' && m.item?.payload?.label === 'пока игрока нет');

    const reconnect = await openTableSocket(player.token, gameId);
    try {
      const back = await masterWs.waitFor(
        (m) => m.type === 'event' && m.item?.type === 'playerReconnected',
        3000
      );
      assert.equal(back.item.actorUserId, player.user.id);

      const history = await reconnect.waitFor((m) => m.type === 'events');
      assert.ok(history.items.length >= 2, 'история при переподключении пуста');
      assert.equal(history.items.find((e) => e.isPrivate), undefined);
      assert.ok(
        history.items.some((e) => e.payload?.label === 'пока игрока нет'),
        'пропущенный бросок не докачался'
      );
      assert.ok(
        history.items.some((e) => e.type === 'playerDisconnected'),
        'событие об уходе не в истории'
      );
    } finally {
      reconnect.close();
    }
  } finally {
    masterWs.close();
    playerWs.close();
  }
});
