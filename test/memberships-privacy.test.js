// Приватность списка участников игры (GET /api/games/:id/memberships):
// тексты заявок и чужие неподтверждённые заявки видит только мастер;
// гость и посторонний игрок — только подтверждённый состав; автор — ещё и свою заявку.
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
  const email = `memberships-privacy-${Date.now()}-${suffix}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Privacy-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', { email, password, displayName: `Privacy ${suffix}` });
  assert.equal(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
  await pool.query('UPDATE users SET email_confirmed_at = now() WHERE email = $1', [email]);
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200, `login: ${JSON.stringify(login.json)}`);
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

test('список участников: тексты заявок видит только мастер и автор заявки', async () => {
  const master = await registerAndLogin('master');
  const applicant = await registerAndLogin('applicant');
  const member = await registerAndLogin('member');
  const outsider = await registerAndLogin('outsider');

  const types = await api('GET', '/api/game-types');
  const created = await api('POST', '/api/games', {
    title: `Privacy ${Date.now()}`,
    description: 'Тест приватности заявок',
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
    kind: 'one_shot'
  }, master.token);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const gameId = created.json.game.id;
  const path = `/api/games/${gameId}/memberships`;

  const secret = 'Секретный текст о себе';
  const concept = 'Секретный концепт';
  for (const user of [applicant, member]) {
    const join = await api('POST', `/api/games/${gameId}/join`, {
      requestedRole: 'player', message: secret, characterConcept: concept
    }, user.token);
    assert.equal(join.status, 201, JSON.stringify(join.json));
  }

  // Мастер видит всё и одобряет одного из двух.
  const forMaster = await api('GET', path, undefined, master.token);
  const pendingOfMember = forMaster.json.items.find((m) => m.user.id === member.user.id);
  assert.equal(forMaster.json.items.filter((m) => m.status === 'pending').length, 2);
  assert.equal(pendingOfMember.message, secret);
  assert.equal(pendingOfMember.characterConcept, concept);
  const approve = await api('PATCH', `/api/game-memberships/${pendingOfMember.id}/approve`, {}, master.token);
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  // Гость и посторонний: только подтверждённый состав, без текстов заявок.
  for (const token of [undefined, outsider.token]) {
    const res = await api('GET', path, undefined, token);
    assert.equal(res.status, 200);
    assert.ok(res.json.items.every((m) => m.status === 'approved'), 'видна неподтверждённая заявка');
    assert.ok(res.json.items.some((m) => m.user.id === member.user.id), 'не виден подтверждённый участник');
    assert.ok(!JSON.stringify(res.json).includes('Секретн'), 'утёк текст заявки');
    assert.equal(res.json.summary.approvedPlayers, 1);
  }

  // Автор заявки видит свою заявку со своим текстом, но не чужой текст.
  const forApplicant = await api('GET', path, undefined, applicant.token);
  const own = forApplicant.json.items.find((m) => m.user.id === applicant.user.id);
  assert.equal(own?.status, 'pending');
  assert.equal(own.message, secret);
  const other = forApplicant.json.items.find((m) => m.user.id === member.user.id);
  assert.equal(other.message, '');
  assert.equal(other.characterConcept, '');
});
