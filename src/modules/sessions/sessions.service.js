const pool = require('../../db/pool');

const ALLOWED_STATUSES = ['scheduled', 'live', 'finished', 'cancelled'];
const DEFAULT_UPCOMING_HOURS = 48;
const MAX_UPCOMING_HOURS = 24 * 60; // не отдавать «ближайшие сессии» дальше, чем на 60 дней

const SESSION_SELECT = `
  SELECT
    s.id,
    s.game_id,
    s.starts_at,
    s.duration_minutes,
    s.status,
    s.created_at,
    g.title AS game_title,
    g.kind AS game_kind,
    g.creator_id AS game_creator_id,
    gs.slug AS game_status_slug
  FROM game_sessions s
  INNER JOIN games g ON g.id = s.game_id
  INNER JOIN game_statuses gs ON gs.id = g.status_id
`;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSessionRow(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    startsAt: toIsoString(row.starts_at),
    durationMinutes: row.duration_minutes === null || row.duration_minutes === undefined
      ? null
      : Number(row.duration_minutes),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    game: {
      id: row.game_id,
      title: row.game_title,
      kind: row.game_kind
    }
  };
}

function parseStartsAt(value, { forbidPast = false } = {}) {
  if (value === null || value === undefined || value === '') {
    throw createHttpError(400, 'startsAt is required');
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, 'Invalid startsAt');
  }

  if (forbidPast && date.getTime() < Date.now()) {
    throw createHttpError(400, 'startsAt must not be in the past');
  }

  return date;
}

function parseDurationMinutes(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const duration = Number(value);

  if (!Number.isInteger(duration) || duration <= 0 || duration > 24 * 60) {
    throw createHttpError(400, 'Invalid durationMinutes');
  }

  return duration;
}

async function getGameForSessions(gameId) {
  const result = await pool.query(
    `SELECT
      g.id,
      g.creator_id,
      g.title,
      gs.slug AS status_slug
    FROM games g
    INNER JOIN game_statuses gs ON gs.id = g.status_id
    WHERE g.id = $1
    LIMIT 1`,
    [gameId]
  );

  return result.rows[0] || null;
}

async function getSessionRowById(sessionId) {
  const result = await pool.query(
    `${SESSION_SELECT}
     WHERE s.id = $1
     LIMIT 1`,
    [sessionId]
  );

  return result.rows[0] || null;
}

// Проверка владения: изменять сессии может только создатель игры (или админ) —
// тот же паттерн, что в games.service/profile.service.
function assertGameOwnership(auth, creatorId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (auth.role !== 'admin' && auth.userId !== creatorId) {
    throw createHttpError(403, 'Forbidden');
  }
}

async function createSession(auth, gameId, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const game = await getGameForSessions(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  assertGameOwnership(auth, game.creator_id);

  const payload = data && typeof data === 'object' ? data : {};
  const startsAt = parseStartsAt(payload.startsAt, { forbidPast: true });
  const durationMinutes = parseDurationMinutes(payload.durationMinutes);

  const insertResult = await pool.query(
    `INSERT INTO game_sessions (game_id, starts_at, duration_minutes, status)
    VALUES ($1, $2, $3, 'scheduled')
    RETURNING id`,
    [gameId, startsAt, durationMinutes]
  );

  const row = await getSessionRowById(insertResult.rows[0].id);
  return mapSessionRow(row);
}

async function updateSession(auth, sessionId, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(sessionId)) {
    throw createHttpError(400, 'Invalid session id');
  }

  const row = await getSessionRowById(sessionId);

  if (!row) {
    throw createHttpError(404, 'Session not found');
  }

  assertGameOwnership(auth, row.game_creator_id);

  const payload = data && typeof data === 'object' ? data : {};
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'startsAt')) {
    if (row.status !== 'scheduled') {
      throw createHttpError(400, 'Only scheduled sessions can be rescheduled');
    }

    updates.starts_at = parseStartsAt(payload.startsAt, { forbidPast: true });
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'durationMinutes')) {
    if (!['scheduled', 'live'].includes(row.status)) {
      throw createHttpError(400, 'Session duration can no longer be changed');
    }

    updates.duration_minutes = parseDurationMinutes(payload.durationMinutes);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';

    if (!ALLOWED_STATUSES.includes(status)) {
      throw createHttpError(400, 'Invalid status');
    }

    // Через PATCH разрешаем только отмену; запуск/завершение — отдельные экшены.
    if (status !== 'cancelled') {
      throw createHttpError(400, 'Use start/finish actions to change session status');
    }

    if (!['scheduled', 'live'].includes(row.status)) {
      throw createHttpError(400, 'Session cannot be cancelled');
    }

    updates.status = status;
  }

  const fields = Object.keys(updates);

  if (fields.length === 0) {
    throw createHttpError(400, 'Nothing to update');
  }

  const setSql = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const values = [sessionId, ...fields.map((field) => updates[field])];

  await pool.query(
    `UPDATE game_sessions SET ${setSql} WHERE id = $1`,
    values
  );

  const updatedRow = await getSessionRowById(sessionId);
  return mapSessionRow(updatedRow);
}

async function transitionSession(auth, sessionId, action) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(sessionId)) {
    throw createHttpError(400, 'Invalid session id');
  }

  const row = await getSessionRowById(sessionId);

  if (!row) {
    throw createHttpError(404, 'Session not found');
  }

  assertGameOwnership(auth, row.game_creator_id);

  let nextStatus;

  if (action === 'start') {
    if (row.status !== 'scheduled') {
      throw createHttpError(400, 'Only scheduled sessions can be started');
    }

    nextStatus = 'live';
  } else if (action === 'finish') {
    if (row.status !== 'live') {
      throw createHttpError(400, 'Only live sessions can be finished');
    }

    nextStatus = 'finished';
  } else {
    throw createHttpError(400, 'Unknown session action');
  }

  await pool.query(
    'UPDATE game_sessions SET status = $2 WHERE id = $1',
    [sessionId, nextStatus]
  );

  const updatedRow = await getSessionRowById(sessionId);
  return mapSessionRow(updatedRow);
}

async function listSessionsByGameId(gameId) {
  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const game = await getGameForSessions(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  const result = await pool.query(
    `${SESSION_SELECT}
     WHERE s.game_id = $1
     ORDER BY s.starts_at ASC`,
    [gameId]
  );

  return result.rows.map(mapSessionRow);
}

async function listUpcomingSessions(query = {}) {
  const rawHours = query.hours === undefined ? DEFAULT_UPCOMING_HOURS : Number(query.hours);

  if (!Number.isFinite(rawHours) || rawHours <= 0) {
    throw createHttpError(400, 'Invalid hours');
  }

  const hours = Math.min(Math.floor(rawHours), MAX_UPCOMING_HOURS);

  const result = await pool.query(
    `${SESSION_SELECT}
     WHERE s.status = 'scheduled'
       AND gs.slug = 'active'
       AND s.starts_at >= now()
       AND s.starts_at <= now() + make_interval(hours => $1)
     ORDER BY s.starts_at ASC`,
    [hours]
  );

  return result.rows.map(mapSessionRow);
}

module.exports = {
  createSession,
  updateSession,
  transitionSession,
  listSessionsByGameId,
  listUpcomingSessions
};
