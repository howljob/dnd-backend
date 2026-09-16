# DND Backend Handoff

## 2026-09-16 — Трек T6 «Игровой стол» (волна 2, ветка track/t6)

- **Лог событий стола:** таблица `table_events` (миграция `1789515229826`, id — bigserial для пагинации `?before=` и докачки `?after=`), привязка к live-сессии `game_sessions`, `is_private` для приватных бросков мастера. REST `GET /api/tabletop/games/:id/events`.
- **WS-протокол** (`tabletop.ws.js`): авторизация только auth-кадром (5 с, `?token=` удалён — T6.5); новые типы `rollDice` (формула пересчитывается сервером — `src/modules/tabletop/dice.js`, crypto.randomInt; режим advantage/disadvantage) и `action` (attack/spell/ability, структура PRD §5.4.6, `payload.character` — имя персонажа для ленты); при `subscribe` — последние 100 событий; события присутствия `playerDisconnected`/`playerReconnected` при обрыве/возврате (T6.6).
- **Консолидация T6.4:** роуты/сервис legacy `tabletop_rooms` удалены, `DROP TABLE` миграцией `1789559695575` (down восстанавливает структуру из 000017+000024).
- Тесты: `test/tabletop-events.test.js` (двухклиентская рассылка ≤1 с, приватность, действия, обрыв/возврат, история; auth-кадр). `npm test` — 5/5.
- Не тронуто по договорённости с треком T5: таблица `game_characters` и ручки `/api/tabletop/games/:id/characters`.

---

## 2026-09-16 — Трек T8 «Сообщество и доверие» (ветка track/t8)

- **T8.1** Оценки привязаны к сессии: `user_reputation_ratings.session_id` (миграция `1789515320000`), уникальность (author, target, session). `POST /api/profile/rating` требует `sessionId` завершённой сессии, где участвовали оба; роль контекста выводится сервером (мастер → gm); повтор → 409. `GET /api/profile/rating/session/:id` — участники для экрана «Оцените игру». Легаси-оценки без session_id остаются в среднем балле.
- **T8.2** `session_attendance` (миграция `1789515330000`): `GET/PUT /api/sessions/:id/attendance` — отмечает мастер после finish; в `GET /api/profile/rating` добавлен блок `attendance {present, total}`.
- **T8.3** Кик и жалобы (миграция `1789515340000`): статус `kicked` у memberships (повторная заявка → 403), `PATCH /api/game-memberships/:id/kick`; модуль `reports` (`POST /api/reports` — участник той же игры, включая мастера; кикнутый может жаловаться), модуль `admin-reports` (`GET /api/admin/reports`, `PATCH .../resolve|dismiss` + admin-audit); всем админам уведомление `report_created`.
- **T8.4** Передача игры (миграция `1789515350000`): `game_transfer_requests`, эндпойнты на `/api/games/:id/transfer-request` (create/get/approve/decline/complete). Complete — любым участником после `TRANSFER_TIMEOUT_DAYS` (из `.env`, дефолт 7, есть в `env.js`); раньше срока → 403 с датой. Передача: creator_id → кандидат, кандидат GM, старый мастер — участник; сессии/персонажи не трогаются.
- **T8.5** Новые типы уведомлений: `game_kicked`, `report_created`, `transfer_requested`, `transfer_declined`, `transfer_completed`, `session_finished_rate` (рассылается участникам при finish сессии).
- Проверки: `npm test` 3/3, e2e фронта 11/11 (включая новый `trust-smoke`).

*(ниже — исторический handoff первых итераций, во многом устарел)*


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


## 2026-09-16 — Track T3 «Аккаунт» (ветка track/t3)

- **Почта (T3.1):** `src/mail/mailer.js` (nodemailer) + `src/mail/templates.js` (русские шаблоны: подтверждение почты, сброс пароля). Без SMTP-переменных в `.env` — dev-режим: письмо пишется файлом в `var/outbox/<timestamp>-<тип>.html` (в `.gitignore`) + строка `[mail]` в лог. Значения-заглушки из `.env.example` считаются «не настроено». Инструкция для пользователя: `docs/email-setup.md`.
- **Подтверждение email (T3.2):** миграция `1789515492365_account-email-confirmation` — `users.email_confirmed_at` (существующие пользователи backfill'ом подтверждены) + таблица `auth_action_tokens` (SHA-256-хэш токена, тип `confirm_email`/`password_reset`, срок, `used_at`). Эндпоинты: `POST /api/auth/confirm-email`, `POST /api/auth/resend-confirmation` (лимит 3/час), `GET /api/auth/me`. Middleware `requireConfirmedEmail` стоит на `POST /api/games` и `POST /api/profile/rating` (403 c `code: EMAIL_NOT_CONFIRMED`).
- **Восстановление пароля (T3.3):** `POST /api/auth/forgot-password` (всегда 200, существование email не раскрывается, тихий лимит 3/час), `POST /api/auth/reset-password` (токен одноразовый, срок 1 час, отзыв ВСЕХ сессий).
- **OAuth (T3.4):** `auth.oauth.service|controller` — `GET /api/auth/providers`, `GET /api/auth/oauth/:provider`, `GET /api/auth/oauth/:provider/callback`. Google (code flow) и VK ID (OAuth 2.1 + PKCE S256) прямыми fetch-запросами без SDK; state в httpOnly-cookie против CSRF; связка по email или создание аккаунта с `email_confirmed_at = now()`. Провайдер включается ключами в `.env` (`GOOGLE_CLIENT_ID/SECRET`, `VKID_CLIENT_ID/SECRET`, `OAUTH_CALLBACK_BASE`) — см. `docs/oauth-setup.md`. Ключей нет — `/providers` пуст, кнопок на фронте нет.
- **Сессии и аватары (T3.5):** `POST /api/auth/logout` отзывает текущую сессию. `POST /api/profile/me/avatar` (multer, `uploads/avatars`, 2 МБ, только изображения; старый файл удаляется), статика `/uploads/avatars`, в базе относительный путь. `PATCH /api/profile/me` без поля `avatar` аватар не трогает; `avatar: null` удаляет (и файл тоже).
- ⚠️ Для прода: nginx должен раздавать/проксировать `/uploads` на бэкенд, иначе файловые аватары не видны.
- Тесты: `npm test` 3/3; e2e фронта `account-smoke.spec.js` покрывает весь цикл (читает письма из `var/outbox`).

---

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

