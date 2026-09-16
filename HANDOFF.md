# DND Backend Handoff

## Project State

- Project path: `c:\projects\dnd-backend`
- Stack: Node.js, Express, PostgreSQL, `pg`, `node-pg-migrate`
- Module system: CommonJS
- Git status: this folder is **not** a git repository (`.git` is missing)

## What Was Done

### 1. Minimal backend skeleton

Created the basic backend structure and startup files:

- `src/config/env.js`
- `src/app.js`
- `src/server.js`
- `.env`
- `.env.example`

Current backend startup:

- dev: `npm run dev`
- start: `npm start`

### 2. PostgreSQL connection setup

Added PostgreSQL connection via `pg`:

- `src/db/pool.js`

Current pool uses explicit config fields:

- `host`
- `port`
- `database`
- `user`
- `password`

Values come from `src/config/env.js`.

### 3. Migrations

Created initial migration:

- `migrations/000001_create_users.js`

Migration does:

- creates extension `pgcrypto`
- creates table `users`
- adds role check constraint

Important migration fixes made during the session:

- removed `migrations/package.json`
- migrated file format to CommonJS (`exports.up`, `exports.down`)
- configured `node-pg-migrate` to use explicit DB config from `migration-config.json`

### 4. Docker Compose for PostgreSQL

Created:

- `docker-compose.yml`
- `migration-config.json`

Docker/Postgres details:

- image: `postgres:16`
- container: `dnd-postgres`
- external port: `55432`
- internal port: `5432`

### 5. Auth module

Created minimal auth module:

- `src/modules/auth/auth.routes.js`
- `src/modules/auth/auth.controller.js`
- `src/modules/auth/auth.service.js`

Connected auth routes in:

- `src/app.js`

## Current API Endpoints

### Health

- `GET /health`

Response:

```json
{
  "ok": true,
  "service": "dnd-backend",
  "env": "development"
}
```

### Register

- `POST /api/auth/register`

Input:

```json
{
  "email": "user@example.com",
  "password": "123456",
  "displayName": "User Name",
  "role": "player"
}
```

Rules:

- required: `email`, `password`, `displayName`, `role`
- email is normalized with `trim().toLowerCase()`
- allowed roles: `player`, `gm`
- duplicate email returns `409`
- password is hashed with `bcrypt`

Success response:

```json
{
  "ok": true,
  "user": {
    "id": "...",
    "email": "...",
    "displayName": "...",
    "role": "...",
    "language": "ru"
  }
}
```

### Login

- `POST /api/auth/login`

Input:

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

Rules:

- required: `email`, `password`
- email is normalized with `trim().toLowerCase()`
- user is loaded by email
- password is checked with `bcrypt.compare`
- wrong email or password returns `401`
- error message is unified: `Invalid email or password`

Success response:

```json
{
  "ok": true,
  "user": {
    "id": "...",
    "email": "...",
    "displayName": "...",
    "role": "...",
    "language": "ru"
  }
}
```

## Current Important Files

- `package.json`
- `.env`
- `.env.example`
- `migration-config.json`
- `docker-compose.yml`
- `src/config/env.js`
- `src/db/pool.js`
- `src/app.js`
- `src/server.js`
- `src/modules/auth/auth.routes.js`
- `src/modules/auth/auth.controller.js`
- `src/modules/auth/auth.service.js`
- `migrations/000001_create_users.js`

## Current Environment / DB Config

Expected local values:

- `PORT=4000`
- `PGHOST=localhost`
- `PGPORT=55432`
- `PGDATABASE=dnd_hub`
- `PGUSER=postgres`
- `PGPASSWORD=postgres`

Migration config is duplicated explicitly in:

- `migration-config.json`

## Commands That Should Work

Start backend:

```bash
npm run dev
```

Start docker postgres:

```bash
docker compose up -d
```

Run migrations:

```bash
npm run migrate:up
```

Rollback latest migration:

```bash
npm run migrate:down
```

## Known Results From This Session

- `npm run migrate:up` was fixed and successfully completed after:
  - moving to explicit migration config
  - removing `migrations/package.json`
  - converting migration file to CommonJS
- `users` table is already created
- backend auth endpoints were added
- frontend UI was **not implemented**, because no frontend/static files were found in this workspace
- commit/push was **not done**, because `c:\projects\dnd-backend` is not a git repo

## Files Created Or Changed During Session

Created:

- `.env`
- `.env.example`
- `docker-compose.yml`
- `migration-config.json`
- `src/config/env.js`
- `src/app.js`
- `src/server.js`
- `src/db/pool.js`
- `src/modules/auth/auth.routes.js`
- `src/modules/auth/auth.controller.js`
- `src/modules/auth/auth.service.js`
- `migrations/000001_create_users.js`

Deleted:

- `migrations/package.json`

Updated multiple times during debugging:

- `package.json`
- `.env`
- `.env.example`
- `src/config/env.js`
- `migrations/000001_create_users.js`

## Recommended Next Steps

1. Add JWT-based auth issuance on successful login.
2. Add refresh token strategy and secure cookie flow.
3. Add request validation helpers to avoid repeating controller/service checks.
4. Add auth-related tests for register and login.
5. Add frontend registration/login page in the actual frontend project or serve a temporary static page from backend if desired.
6. Initialize git in this folder or move the project into the real repository before committing.

## Quick Resume Prompt

If continuing in a new session, use something like:

> Read `HANDOFF.md` in `c:\projects\dnd-backend` and continue from the current backend state. The backend already has register/login, Docker Postgres on port 55432, migrations working, and no git repo is initialized in this folder.

## 2026-09-16 — Track T5 «Персонажи» (ветка track/t5, волна 2)

- `user_characters`: лист персонажа теперь в `sheet` jsonb (+`portrait_path`),
  `notes` — обычные заметки; миграция `1789515327878` переносит старый JSON
  из notes (портрет-dataURL → `sheet.legacyPortrait`); чтение старого формата
  v1 из notes поддерживается на лету (`src/modules/profile/character-sheet.js`).
- Портреты — файлы в `uploads/portraits` (`POST/DELETE /api/profile/characters/:id/portrait`,
  multer 2МБ, статика `/uploads/portraits`); легаси data-URL конвертируется в
  файл при сохранении листа. `DELETE /api/profile/characters/:id` — удаление
  с каскадом привязок.
- `express.json` глобально 1mb; локальные исключения 12mb (`/api/community`,
  вложения-dataURL — убрать в T8) и 4mb (`/api/profile/me`, аватар — убрать в T3.5).
- Модуль `game-characters` (T5.4): `game_characters.state` jsonb (hp, hpMax,
  tempHp, level, inventory, notes) + `created_from_sheet` — независимая копия
  на стол; `POST /api/games/:gameId/characters/:characterId/link`,
  `GET|PATCH /api/games/:gameId/my-character`, `POST .../sync-to-template`.
  Ручки `/api/tabletop/games/:id/characters` не тронуты; их привязки без
  state дополняются лениво.
- Импортёр вики: `payload.meta` у классов (кость хитов, формулы хитов,
  владения, спасброски, навыки, стартовое снаряжение) — источник данных для
  листа и мастера создания на фронте. `payload.sections` не менялся.
- Метрики (T5.7): таблица `metrics_events`, событие `storage_limit_approach`
  при >80% лимита `STORAGE_LIMIT_MB` (.env, дефолт 100 МБ) — считает аватар +
  портреты + карты сцен мастера; дедуп 24 часа.
