// Библиотека стола и музыка: загрузка файлов трёх видов (карта, картинка токена, музыка),
// права мастера, состояние музыки в сцене (сервер ставит время старта), картинка токена,
// удаление файла убирает ссылки из сцены.
//
// Запуск: npm test (база должна быть поднята и мигрирована).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const pool = require('../src/db/pool');

let server;
let baseUrl;

/** Сборка стола приходит обёрнутой в { ok, data } — как читает фронт. */
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

async function upload(gameId, token, kind, { name, mime, bytes }) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([bytes], { type: mime }), name);
  const res = await fetch(`${baseUrl}/api/tabletop/games/${gameId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function registerAndLogin(suffix) {
  const email = `tt-files-${Date.now()}-${suffix}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Tt-Files-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', { email, password, displayName: `Files ${suffix}` });
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

// Минимальный PNG 1×1 — проверка типа идёт по MIME, размер читается из заголовка.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('библиотека стола: виды файлов, права, музыка в сцене, картинка токена, удаление', async () => {
  const master = await registerAndLogin('master');
  const player = await registerAndLogin('player');
  const types = await api('GET', '/api/game-types');
  const created = await api('POST', '/api/games', {
    title: `Files ${Date.now()}`,
    description: 'Тест библиотеки',
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

  // Музыка: mp3 грузится, картинка под видом музыки — нет, игрок — 403.
  const mp3 = Buffer.alloc(2048, 1);
  const audio = await upload(gameId, master.token, 'audio', { name: 'тема.mp3', mime: 'audio/mpeg', bytes: mp3 });
  assert.equal(audio.status, 201, JSON.stringify(audio.json));
  assert.equal(audio.json.kind, 'audio');
  assert.match(audio.json.url, /^\/uploads\/vtt\/[a-f0-9]{32}\.mp3$/);
  assert.equal(audio.json.name, 'тема.mp3');
  const badAudio = await upload(gameId, master.token, 'audio', { name: 'x.png', mime: 'image/png', bytes: PNG_1X1 });
  assert.equal(badAudio.status, 400);
  assert.equal(badAudio.json.code, 'INVALID_AUDIO_TYPE');
  const byPlayer = await upload(gameId, player.token, 'audio', { name: 'тема.mp3', mime: 'audio/mpeg', bytes: mp3 });
  assert.equal(byPlayer.status, 403);
  const unknownKind = await upload(gameId, master.token, 'video', { name: 'x.mp4', mime: 'video/mp4', bytes: mp3 });
  assert.equal(unknownKind.status, 400);

  // Картинка токена: PNG с размером, вид image.
  const image = await upload(gameId, master.token, 'image', { name: 'гоблин.png', mime: 'image/png', bytes: PNG_1X1 });
  assert.equal(image.status, 201, JSON.stringify(image.json));
  assert.equal(image.json.kind, 'image');
  assert.equal(image.json.width, 1);

  // Список библиотеки — с видами.
  const list = await api('GET', `/api/tabletop/games/${gameId}/files`, undefined, master.token);
  assert.deepEqual(list.json.items.map((f) => f.kind).sort(), ['audio', 'image']);

  // Сцена: музыка пишется мастером в опубликованное состояние, время старта ставит сервер.
  const bundle = await api('GET', `/api/tabletop/games/${gameId}`, undefined, master.token);
  const bundleData = unwrap(bundle.json);
  assert.ok(Number.isFinite(bundleData.serverNow), 'нет serverNow в сборке');
  const sceneId = bundleData.activeSceneId;
  const before = Date.now();
  const play = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published',
    patch: { music: { url: audio.json.url, fileId: audio.json.fileId, name: 'Тема', playing: true, loop: true, offset: 12.5, startedAt: 1 } }
  }, master.token);
  assert.equal(play.status, 200, JSON.stringify(play.json));
  const music = play.json.scene.publishedState.music;
  assert.equal(music.playing, true);
  assert.equal(music.loop, true);
  assert.equal(music.offset, 12.5);
  assert.ok(music.startedAt >= before, 'startedAt должен ставить сервер, а не клиент');

  // Пауза: позиция сохраняется, startedAt сбрасывается.
  const pause = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published', patch: { music: { playing: false, offset: 40 } }
  }, master.token);
  assert.equal(pause.json.scene.publishedState.music.playing, false);
  assert.equal(pause.json.scene.publishedState.music.startedAt, null);
  assert.equal(pause.json.scene.publishedState.music.offset, 40);

  // Игрок видит музыку в сборке, но менять не может.
  const playerBundle = await api('GET', `/api/tabletop/games/${gameId}`, undefined, player.token);
  const playerScene = unwrap(playerBundle.json).scenes.find((s) => s.id === sceneId);
  assert.equal(playerScene.publishedState.music.url, audio.json.url);
  const playerPatch = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published', patch: { music: { playing: true } }
  }, player.token);
  assert.equal(playerPatch.status, 403);

  // Чужой адрес музыкой не станет.
  const badUrl = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published', patch: { music: { url: 'https://evil.example/track.mp3', playing: true } }
  }, master.token);
  assert.equal(badUrl.json.scene.publishedState.music.url, null);
  assert.equal(badUrl.json.scene.publishedState.music.playing, false);

  // Токен с картинкой из библиотеки; левый адрес отбрасывается.
  const tokens = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published',
    patch: {
      tokensMode: 'replace',
      tokens: [
        { id: 't1', x: 10, y: 10, size: 48, label: 'Гоблин', imageUrl: image.json.url },
        { id: 't2', x: 20, y: 20, size: 48, label: 'Чужой', imageUrl: 'https://evil.example/a.png' }
      ]
    }
  }, master.token);
  const tokenById = Object.fromEntries(tokens.json.scene.publishedState.tokens.map((t) => [t.id, t]));
  assert.equal(tokenById.t1.imageUrl, image.json.url);
  assert.equal(tokenById.t2.imageUrl, null);

  // Удаление картинки убирает её с токена; удаление музыки останавливает и снимает трек.
  await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published', patch: { music: { url: audio.json.url, playing: true } }
  }, master.token);
  const delImage = await api('DELETE', `/api/tabletop/games/${gameId}/files/${image.json.fileId}`, undefined, master.token);
  assert.equal(delImage.status, 200);
  const delAudio = await api('DELETE', `/api/tabletop/games/${gameId}/files/${audio.json.fileId}`, undefined, master.token);
  assert.equal(delAudio.status, 200);
  const after = await api('GET', `/api/tabletop/games/${gameId}`, undefined, master.token);
  const scene = unwrap(after.json).scenes.find((s) => s.id === sceneId);
  assert.equal(scene.publishedState.tokens.find((t) => t.id === 't1').imageUrl, null);
  assert.equal(scene.publishedState.music.url, null);
  assert.equal(scene.publishedState.music.playing, false);
  const emptyList = await api('GET', `/api/tabletop/games/${gameId}/files`, undefined, master.token);
  assert.equal(emptyList.json.items.length, 0);

  // Общая библиотека мастера: трек из другой его игры виден с scope=all (с названием игры),
  // в обычном списке — нет; играть его можно, удалить из этой игры — нельзя.
  const otherGame = await api('POST', '/api/games', {
    title: `Files other ${Date.now()}`,
    description: 'Другая игра мастера',
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
  const otherId = otherGame.json.game.id;
  const otherAudio = await upload(otherId, master.token, 'audio', { name: 'таверна.mp3', mime: 'audio/mpeg', bytes: mp3 });
  assert.equal(otherAudio.status, 201);
  const own = await api('GET', `/api/tabletop/games/${gameId}/files`, undefined, master.token);
  assert.equal(own.json.items.length, 0, 'без scope — только файлы этой игры');
  const shared = await api('GET', `/api/tabletop/games/${gameId}/files?scope=all`, undefined, master.token);
  const sharedTrack = shared.json.items.find((f) => f.url === otherAudio.json.url);
  assert.ok(sharedTrack, 'трек из другой игры мастера не виден в общей библиотеке');
  assert.equal(sharedTrack.fromThisGame, false);
  assert.equal(sharedTrack.gameId, otherId);
  assert.ok(sharedTrack.gameTitle.startsWith('Files other'));
  const playShared = await api('PATCH', `/api/tabletop/games/${gameId}/scenes/${sceneId}`, {
    target: 'published', patch: { music: { url: otherAudio.json.url, fileId: otherAudio.json.fileId, name: 'Таверна', playing: true } }
  }, master.token);
  assert.equal(playShared.json.scene.publishedState.music.url, otherAudio.json.url);
  const delForeign = await api('DELETE', `/api/tabletop/games/${gameId}/files/${otherAudio.json.fileId}`, undefined, master.token);
  assert.equal(delForeign.status, 404, 'файл другой игры удалять отсюда нельзя');
  // Игрок общую библиотеку не видит.
  const byPlayerShared = await api('GET', `/api/tabletop/games/${gameId}/files?scope=all`, undefined, player.token);
  assert.equal(byPlayerShared.status, 403);
});
