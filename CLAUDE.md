# DnD-Hub — бэкенд

REST API и WebSocket для платформы DnD-Hub.
Фронтенд: `C:\projects\dnd` (отдельный git-репозиторий, ветка `main`).

## Стек

- Node.js + **Express 5**, **CommonJS** (`require`, не `import`).
- PostgreSQL 16 в Docker, порт **55432** (не 5432!), база `dnd_hub`.
- `pg` (пул, без ORM — сырой SQL), `bcrypt`, `jsonwebtoken`, `multer`, `nodemailer`, `ws`.
- Миграции — `node-pg-migrate`.
- Тестового фреймворка нет; проверка идёт e2e-тестами со стороны фронта.

## Запуск — строго в этом порядке

```bash
docker compose up -d            # Postgres на 55432, контейнер dnd-postgres
npm run migrate:up              # применить миграции
npm run dev                     # nodemon, http://localhost:4000
```

Проверка живости: `GET http://localhost:4000/health` → `{"ok":true,"service":"dnd-backend"}`.

Прочие скрипты: `wiki:import-srd` (SRD-контент в БД, повторный запуск безопасен — upsert), `wiki:import-reference` (markdown-ассеты), `admin:promote` (выдать роль администратора), `migrate:down`, `migrate:create`.

Конфигурация — `.env`, читается через [`src/config/env.js`](src/config/env.js). Дефолты: `PORT=4000`, `PGPORT=55432`, `FRONTEND_URL=http://127.0.0.1:8000`. **`.env` в `.gitignore` — не коммитить и не выводить его содержимое в чат.**

## Структура модуля — обязательный паттерн

```
src/modules/<name>/
  <name>.routes.js       express.Router(): пути + middleware, без логики
  <name>.controller.js   разбор req, вызов сервиса, формирование res
  <name>.service.js      SQL и бизнес-логика, единственное место работы с БД
```

Новый модуль обязательно регистрируется в [`src/app.js`](src/app.js) через `app.use('/api/<...>', router)` — иначе маршруты просто не существуют.

Прочее: `src/middleware/` (`auth.middleware.js`, `roles.middleware.js`), `src/db/pool.js`, `src/config/env.js`, `src/scripts/`, `src/routes/protected.routes.js`.

## Карта модулей

| Префикс API | Модуль | Домен |
|---|---|---|
| `/api/auth` | `auth` | регистрация, вход, JWT |
| `/api/game-types`, `/api/games` | `games` | игры и типы систем |
| `/api/games`, `/api/game-memberships` | `memberships` | заявки на вступление, LFG-набор |
| `/api/community` | `community` | посты, лента, уведомления, репутация |
| `/api/profile` | `profile` | профиль, **персонажи**, безопасность, достижения |
| `/api/wiki` | `wiki` | SRD-сущности в БД |
| `/api` | `wiki-reference` | расширенный справочный контент |
| `/api` | `tabletop` | виртуальный стол, сцены, лог событий стола (legacy «комнаты» удалены в T6.4) |
| `/api/admin` | `admin-*` (5 модулей) | админка и модерация — **разработка отложена** |
| `/api/protected` | — | проверка авторизации |

Есть также модуль `campaigns` и `admin-audit.service.js`.

## WebSocket — виртуальный стол

`tabletop.ws.js`, эндпойнт `/ws/tabletop`. **Авторизация — только первым кадром `{type:'auth', token}`** (5 секунд на auth, `?token=` в URL не поддерживается; до auth другие кадры закрывают соединение). Типы клиент→сервер: `auth`, `subscribe`, `patchScene`, `publishScene`, `rollDice`, `action`, `ping`; сервер→клиент: `authOk`, `bundle`, `events` (история при подписке), `event` (новое событие ленты), `pong`, `error`. Броски пересчитывает сервер (`dice.js`, crypto.randomInt) — клиентскому результату не доверять; события пишутся в `table_events` (приватные — только мастеру и автору). Статика загруженных карт раздаётся из `/uploads/vtt`.

## Миграции — самое опасное место

- **Новые миграции — только через `npm run migrate:create -- <имя>`**: файл получает timestamp-префикс (`1789405351685_имя.js`). Порядковые номера (`000027_...`) больше не использовать — параллельные треки будут спорить за номера.
- Подключение к БД миграции берут из `.env` через обёртку `scripts/migrate.js` (`migrate:up` / `migrate:down` / `migrate:create`). Захардкоженного `migration-config.json` больше нет.
- **⚠️ В нумерации дыра: после `000018_campaigns_vtt_scenes.js` сразу `000024_tabletop_rooms_game_id.js`.** Файлов 19–23 в git никогда не было, `000018` — намеренная пустышка. Разбор — в [`docs/migrations-history.md`](docs/migrations-history.md). Номера 19–23 не переиспользовать, пустышку не удалять до сверки с прод-базой.
- Каждая миграция обязана иметь рабочий `down`. Проверять откат до применения на реальных данных.
- `000015_create_wiki_entities.js` при `up` заливает SRD-seed из `wiki.seed.js`.
- Перед отладкой «пустых данных» на фронте — сначала убедиться, что миграции применены.

## Безопасность — на что смотреть в каждом изменении

- **Проверка владения объектом.** Персонажи, посты, игры: пользователь не должен получать чужие записи, подставив другой `id`. Паттерн уже есть в `profile.service.js` — следовать ему.
- Роли `user` / `moderator` / `admin` — через `roles.middleware.js`.
- Загрузки в `uploads/vtt` (multer) — валидировать тип и размер.
- `express.json({ limit: '12mb' })` — лимит повышен, потому что портрет персонажа хранится как data URL внутри JSON-поля `notes`. Это известный компромисс.
- CORS — белый список в `src/app.js` + `CORS_ORIGINS` (через запятую) в `.env`. Вне `NODE_ENV=production` любой `http://localhost:<порт>` разрешён автоматически (параллельные треки). На проде — только список.
- Порт задаётся `PORT` из окружения или `.env` (`$env:PORT=4100; npm run dev` для параллельного трека).

## Особенность хранения персонажей

Расширенные данные листа персонажа лежат в текстовом поле `notes` как JSON (`sheetVersion: 1`), включая портрет в виде data URL. Старые записи могли содержать обычный текст — поддерживается обратная совместимость. Переход на нормализованную схему потребует миграции данных и версионирования API — не делать походя.

## Правила работы

- Не коммитить и не пушить без явной команды пользователя.
- Не выводить содержимое `.env` в чат.
- Держать `HANDOFF.md` в актуальном состоянии после существенных изменений.

## Устаревшая копия

`C:\Users\Jeka5\OneDrive\Desktop\projects\dnd-backend` — **устаревшая копия, работать в ней нельзя.**
