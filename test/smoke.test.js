// Дымовой тест бэкенда: поднимает приложение на свободном порту и проверяет
// базовые сценарии против реальной базы из .env. Без внешних зависимостей —
// только встроенный node:test.
//
// Запуск: npm test  (перед этим база должна быть поднята и мигрирована:
// docker compose up -d && npm run migrate:up)

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
    // не-JSON ответ — оставим null
  }
  return { status: res.status, json };
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

test('GET /health отвечает {ok:true}', async () => {
  const { status, json } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('регистрация и вход через /api/auth', async () => {
  const email = `smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Smoke-Test-Passw0rd!';

  const reg = await api('POST', '/api/auth/register', {
    email,
    password,
    displayName: 'Smoke Test'
  });
  assert.equal(reg.status, 201, `регистрация: ${JSON.stringify(reg.json)}`);
  assert.equal(reg.json.ok, true);
  assert.equal(reg.json.user.email, email);

  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200, `логин: ${JSON.stringify(login.json)}`);
  assert.equal(login.json.ok, true);
  assert.ok(login.json.token, 'логин должен вернуть JWT-токен');

  // Токен действительно работает: защищённый маршрут отвечает 200
  const me = await api('GET', '/api/protected/me', undefined, login.json.token);
  assert.equal(me.status, 200, `защищённый маршрут: ${JSON.stringify(me.json)}`);
});

test('GET /api/games отвечает 200', async () => {
  const { status, json } = await api('GET', '/api/games');
  assert.equal(status, 200);
  assert.ok(json, 'ответ должен быть JSON');
});
