// Сцены стола: одинаковые названия запрещены, переименование, дублирование со всем
// содержимым, удаление (не активную и не единственную), права мастера.
//
// Запуск: npm test (база должна быть поднята и мигрирована).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const pool = require('../src/db/pool');

let server;
let baseUrl;

const unwrap = (json) => (json && json.data) || json;

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
  const email = `tt-scenes-${Date.now()}-${suffix}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Tt-Scenes-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', { email, password, displayName: `Scenes ${suffix}` });
  assert.equal(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
  await pool.query('UPDATE users SET email_confirmed_at = now() WHERE email = $1', [email]);
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200);
  return { token: login.json.token, user: login.json.user };
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

test('сцены: уникальные названия, переименование, дубликат, удаление, права', async () => {
  const master = await registerAndLogin('master');
  const player = await registerAndLogin('player');
  const types = await api('GET', '/api/game-types');
  const created = await api('POST', '/api/games', {
    title: `Scenes ${Date.now()}`,
    description: 'Тест сцен',
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
  const gameId = created.json.game.id;
  await api('POST', `/api/games/${gameId}/join`, { requestedRole: 'player', message: 'иду' }, player.token);
  const mem = await api('GET', `/api/games/${gameId}/memberships`, undefined, master.token);
  const pending = mem.json.items.find((m) => m.user.id === player.user.id);
  await api('PATCH', `/api/game-memberships/${pending.id}/approve`, {}, master.token);

  const scenes = `/api/tabletop/games/${gameId}/scenes`;
  const bundle0 = unwrap((await api('GET', `/api/tabletop/games/${gameId}`, undefined, master.token)).json);
  const mainId = bundle0.activeSceneId;
  assert.ok(mainId, 'нет сцены по умолчанию');

  // Создание: имя подрезается, одинаковое (даже в другом регистре и с пробелами) — 409.
  const tavern = await api('POST', scenes, { name: '  Таверна   «Пьяный   дракон» ' }, master.token);
  assert.equal(tavern.status, 201, JSON.stringify(tavern.json));
  assert.equal(tavern.json.scene.name, 'Таверна «Пьяный дракон»');
  assert.equal(tavern.json.scene.isActive, false);
  const dup = await api('POST', scenes, { name: 'таверна «пьяный дракон»' }, master.token);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'SCENE_NAME_TAKEN');
  const sameAsMain = await api('POST', scenes, { name: 'main' }, master.token);
  assert.equal(sameAsMain.status, 409, 'сцена по умолчанию «Main» тоже занимает имя');
  const byPlayer = await api('POST', scenes, { name: 'Подвал' }, player.token);
  assert.equal(byPlayer.status, 403);

  // Переименование: в занятое — 409, в своё же имя — можно, пустое — 400.
  const tavernId = tavern.json.scene.id;
  const renameTaken = await api('POST', `${scenes}/${tavernId}/rename`, { name: 'MAIN' }, master.token);
  assert.equal(renameTaken.status, 409);
  assert.equal(renameTaken.json.code, 'SCENE_NAME_TAKEN');
  const renameSame = await api('POST', `${scenes}/${tavernId}/rename`, { name: 'Таверна «Пьяный дракон»' }, master.token);
  assert.equal(renameSame.status, 200);
  const renameEmpty = await api('POST', `${scenes}/${tavernId}/rename`, { name: '   ' }, master.token);
  assert.equal(renameEmpty.status, 400);
  const renamed = await api('POST', `${scenes}/${tavernId}/rename`, { name: 'Таверна' }, master.token);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.scene.name, 'Таверна');
  const renameByPlayer = await api('POST', `${scenes}/${tavernId}/rename`, { name: 'Чужое' }, player.token);
  assert.equal(renameByPlayer.status, 403);

  // Наполняем «Таверну»: черновик и опубликованное отличаются; музыка играет, линейка натянута.
  const draftPatch = await api('PATCH', `${scenes}/${tavernId}`, {
    target: 'draft',
    patch: {
      grid: { enabled: true, cellPx: 64 },
      tokens: [{ id: 't1', x: 100, y: 120, size: 64, label: 'Гоблин', gmNote: 'трус' }],
      fog: { enabled: true },
      drawings: { add: [{ id: 'd1', kind: 'circle', x: 10, y: 10, r: 20, stroke: '#ff0000' }] }
    }
  }, master.token);
  assert.equal(draftPatch.status, 200, JSON.stringify(draftPatch.json));
  const pubPatch = await api('PATCH', `${scenes}/${tavernId}`, {
    target: 'published',
    patch: {
      tokens: [{ id: 'p1', x: 5, y: 5, size: 48, label: 'Старый' }],
      measure: { active: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
    }
  }, master.token);
  assert.equal(pubPatch.status, 200, JSON.stringify(pubPatch.json));

  // Дубликат: имя «(копия)», затем «(копия 2)»; содержимое обеих частей скопировано,
  // линейка и воспроизведение музыки сброшены; копия не активна и стоит в конце.
  const copy1 = await api('POST', `${scenes}/${tavernId}/duplicate`, {}, master.token);
  assert.equal(copy1.status, 201, JSON.stringify(copy1.json));
  assert.equal(copy1.json.scene.name, 'Таверна (копия)');
  assert.equal(copy1.json.scene.isActive, false);
  assert.notEqual(copy1.json.scene.id, tavernId);
  const d = copy1.json.scene.draftState;
  assert.equal(d.grid.enabled, true);
  assert.equal(d.grid.cellPx, 64);
  assert.equal(d.tokens.length, 1);
  assert.equal(d.tokens[0].label, 'Гоблин');
  assert.equal(d.tokens[0].gmNote, 'трус');
  assert.equal(d.fog.enabled, true);
  assert.equal(d.drawings.length, 1);
  const p = copy1.json.scene.publishedStateGmView;
  assert.equal(p.tokens[0].label, 'Старый');
  assert.deepEqual(p.measure.points, [], 'линейка в копию не переносится');
  const copy2 = await api('POST', `${scenes}/${tavernId}/duplicate`, {}, master.token);
  assert.equal(copy2.json.scene.name, 'Таверна (копия 2)');
  const copyOfCopy = await api('POST', `${scenes}/${copy1.json.scene.id}/duplicate`, {}, master.token);
  assert.equal(copyOfCopy.json.scene.name, 'Таверна (копия 3)', 'копия копии не плодит «(копия) (копия)»');
  const dupByPlayer = await api('POST', `${scenes}/${tavernId}/duplicate`, {}, player.token);
  assert.equal(dupByPlayer.status, 403);
  const list = unwrap((await api('GET', `/api/tabletop/games/${gameId}`, undefined, master.token)).json).scenes;
  assert.deepEqual(list.map((s) => s.name), ['Main', 'Таверна', 'Таверна (копия)', 'Таверна (копия 2)', 'Таверна (копия 3)']);

  // Удаление: активную нельзя, игроку нельзя, остальные — можно; единственную — нельзя.
  const delActive = await api('DELETE', `${scenes}/${mainId}`, undefined, master.token);
  assert.equal(delActive.status, 409);
  assert.equal(delActive.json.code, 'SCENE_ACTIVE');
  const delByPlayer = await api('DELETE', `${scenes}/${tavernId}`, undefined, player.token);
  assert.equal(delByPlayer.status, 403);
  for (const s of [copy1, copy2, copyOfCopy]) {
    const del = await api('DELETE', `${scenes}/${s.json.scene.id}`, undefined, master.token);
    assert.equal(del.status, 200, JSON.stringify(del.json));
  }
  const delMissing = await api('DELETE', `${scenes}/${copy1.json.scene.id}`, undefined, master.token);
  assert.equal(delMissing.status, 404);
  // Делаем «Таверну» активной и удаляем «Main»; остаётся одна — её удалить нельзя.
  await api('POST', `${scenes}/${tavernId}/active`, {}, master.token);
  const delMain = await api('DELETE', `${scenes}/${mainId}`, undefined, master.token);
  assert.equal(delMain.status, 200);
  const after = unwrap((await api('GET', `/api/tabletop/games/${gameId}`, undefined, master.token)).json);
  assert.deepEqual(after.scenes.map((s) => s.name), ['Таверна']);
  assert.equal(after.activeSceneId, tavernId);
  // Единственная сцена одновременно и активная — код про активную важнее, стол не остаётся пустым.
  const delLast = await api('DELETE', `${scenes}/${tavernId}`, undefined, master.token);
  assert.equal(delLast.status, 409);
  // Имя удалённой сцены снова свободно.
  const reuse = await api('POST', scenes, { name: 'Main' }, master.token);
  assert.equal(reuse.status, 201);
  // Игрок видит список сцен без черновиков.
  const playerView = unwrap((await api('GET', `/api/tabletop/games/${gameId}`, undefined, player.token)).json);
  assert.equal(playerView.scenes.length, 2);
  assert.ok(playerView.scenes.every((s) => s.draftState === undefined));
});
