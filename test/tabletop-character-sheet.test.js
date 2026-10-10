// Лист персонажа за столом: мастер игры читает и сохраняет лист игрока (вкладка «Персонаж»),
// другой игрок и мастер чужой игры — нет; замена персонажа игрока (добавить нового, убрать старого).
//
// Запуск: npm test (база должна быть поднята и мигрирована).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const pool = require('../src/db/pool');

let server;
let baseUrl;

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
  const email = `tt-sheet-${Date.now()}-${suffix}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Tt-Sheet-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', { email, password, displayName: `Sheet ${suffix}` });
  assert.equal(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
  await pool.query('UPDATE users SET email_confirmed_at = now() WHERE email = $1', [email]);
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200);
  return { token: login.json.token, user: login.json.user };
}

async function createGame(master) {
  const types = await api('GET', '/api/game-types');
  const created = await api('POST', '/api/games', {
    title: `Sheet ${Date.now()}`,
    description: 'Тест листа за столом',
    gameTypeId: types.json.items[0].id,
    startsAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
    maxPlayers: 4,
    language: 'ru',
    playerLevel: 'beginner',
    isPaid: false,
    priceAmount: null,
    format: 'online',
    location: null,
    creatorRole: 'gm',
    kind: 'one_shot',
    tableProfile: { style: '', expectedDuration: '', newcomerThreshold: '', requirements: '' }
  }, master.token);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.game.id;
}

async function joinAndApprove(gameId, master, player) {
  await api('POST', `/api/games/${gameId}/join`, { requestedRole: 'player', message: 'иду' }, player.token);
  const mem = await api('GET', `/api/games/${gameId}/memberships`, undefined, master.token);
  const pending = mem.json.items.find((m) => m.user.id === player.user.id);
  const ok = await api('PATCH', `/api/game-memberships/${pending.id}/approve`, {}, master.token);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
}

async function createCharacter(player, name) {
  const res = await api('POST', '/api/profile/characters', {
    name, level: 3, className: 'Волшебник', gameSystem: 'D&D 5e', status: 'active',
    sheet: { abilities: { int: 16 }, favorites: [{ type: 'spellattack' }] }
  }, player.token);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.character.id;
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('лист за столом: мастер правит лист игрока, чужие — нет; замена персонажа', async () => {
  const master = await registerAndLogin('master');
  const player = await registerAndLogin('player');
  const other = await registerAndLogin('other');
  const strangerGm = await registerAndLogin('stranger');
  const gameId = await createGame(master);
  const strangerGame = await createGame(strangerGm);
  await joinAndApprove(gameId, master, player);
  await joinAndApprove(gameId, master, other);

  const charId = await createCharacter(player, 'Мерлин');
  const link = await api('POST', `/api/tabletop/games/${gameId}/characters`, { characterId: charId }, player.token);
  assert.equal(link.status, 201, JSON.stringify(link.json));

  // Мастер читает лист и сохраняет правку: уровень, хиты, избранное.
  const read = await api('GET', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, undefined, master.token);
  assert.equal(read.status, 200, JSON.stringify(read.json));
  const item = read.json.item;
  const body = {
    name: item.name,
    gameSystem: item.gameSystem,
    className: item.className,
    level: 4,
    race: item.race || '',
    campaignName: item.campaignName || '',
    background: item.background || '',
    notes: 'Мастер дописал заметку',
    status: 'active',
    sheet: { ...item.sheet, combat: { ...item.sheet.combat, hpMax: 27, hpCurrent: 20 }, favorites: [{ type: 'check', key: 'int' }] }
  };
  const saved = await api('PUT', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, body, master.token);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.item.level, 4);
  assert.equal(saved.json.item.isOwner, false);

  // Игрок видит правку мастера в своём персонаже (тот же шаблон из мастерской).
  const mine = await api('GET', '/api/profile/characters', undefined, player.token);
  const own = mine.json.items.find((c) => c.id === charId);
  assert.equal(own.level, 4);
  assert.equal(own.notes, 'Мастер дописал заметку');
  assert.equal(own.sheet.combat.hpMax, 27);
  assert.deepEqual(own.sheet.favorites, [{ type: 'check', key: 'int' }]);
  assert.equal(own.userId || player.user.id, player.user.id);

  // Другой игрок той же игры и мастер чужой игры сохранить не могут.
  const byOther = await api('PUT', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, body, other.token);
  assert.equal(byOther.status, 403);
  const byStranger = await api('PUT', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, body, strangerGm.token);
  assert.equal(byStranger.status, 403);
  const wrongGame = await api('PUT', `/api/tabletop/games/${strangerGame}/characters/${charId}/sheet`, body, strangerGm.token);
  assert.equal(wrongGame.status, 404);
  // Мусор в листе — 400, а не порча данных.
  const bad = await api('PUT', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, { ...body, level: 99 }, master.token);
  assert.equal(bad.status, 400);

  // Замена персонажа: игрок приводит нового и убирает старого; в списке — время привязки.
  const newId = await createCharacter(player, 'Гэндальф');
  const add = await api('POST', `/api/tabletop/games/${gameId}/characters`, { characterId: newId }, player.token);
  assert.equal(add.status, 201);
  const list = await api('GET', `/api/tabletop/games/${gameId}/characters`, undefined, player.token);
  const oldLink = list.json.items.find((c) => c.characterId === charId);
  assert.ok(oldLink.linkedAt, 'нет времени привязки');
  const removed = await api('DELETE', `/api/tabletop/games/${gameId}/characters/${oldLink.id}`, undefined, player.token);
  assert.equal(removed.status, 200);
  const after = await api('GET', `/api/tabletop/games/${gameId}/characters`, undefined, player.token);
  assert.deepEqual(after.json.items.map((c) => c.name), ['Гэндальф']);
  // Убранного из игры персонажа мастер больше не правит.
  const gone = await api('PUT', `/api/tabletop/games/${gameId}/characters/${charId}/sheet`, body, master.token);
  assert.equal(gone.status, 404);
});
