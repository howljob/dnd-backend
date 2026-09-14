// Обёртка над node-pg-migrate: подключение к БД берётся из .env (src/config/env.js),
// а не из захардкоженного конфига. Это позволяет каждому треку (worktree) работать
// со своей базой (PGDATABASE=dnd_hub_<track>), а проду — со своей.
//
// Использование: node scripts/migrate.js up|down|create [аргументы node-pg-migrate]
// Дефолты (если переменные не заданы) совпадают со старым migration-config.json:
// localhost:55432, база dnd_hub, пользователь/пароль postgres.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('../src/config/env');

const databaseUrl =
  env.databaseUrl ||
  `postgres://${encodeURIComponent(env.pgUser || 'postgres')}:${encodeURIComponent(
    env.pgPassword || 'postgres'
  )}@${env.pgHost || 'localhost'}:${env.pgPort || 55432}/${env.pgDatabase || 'dnd_hub'}`;

const cliPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'node-pg-migrate',
  'bin',
  'node-pg-migrate.js'
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Использование: node scripts/migrate.js up|down|create [аргументы]');
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl }
});

process.exit(result.status === null ? 1 : result.status);
