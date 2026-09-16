const pool = require('../../db/pool');
const { createNotification } = require('../community/community-notifications.service');

const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 2000;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReportRow(row) {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetUserId: row.target_user_id,
    gameId: row.game_id,
    reason: row.reason,
    status: row.status,
    createdAt: toIso(row.created_at)
  };
}

// Участник игры = создатель или участник со статусом approved/kicked.
// «kicked» включён сознательно: исключённый игрок должен иметь возможность
// пожаловаться на мастера — иначе кик закрывает рот жертве.
async function getGameParticipantIds(gameId, creatorId) {
  const result = await pool.query(
    `SELECT user_id
     FROM game_memberships
     WHERE game_id = $1
       AND status IN ('approved', 'kicked')`,
    [gameId]
  );
  const ids = new Set(result.rows.map((row) => row.user_id));
  ids.add(creatorId);

  return ids;
}

async function createReport(auth, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  const payload = data && typeof data === 'object' ? data : {};
  const targetUserId = typeof payload.targetUserId === 'string' ? payload.targetUserId.trim() : '';
  const gameId = typeof payload.gameId === 'string' ? payload.gameId.trim() : '';
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';

  if (!isUuid(targetUserId)) {
    throw createHttpError(400, 'Invalid target user id');
  }

  if (targetUserId === auth.userId) {
    throw createHttpError(400, 'You cannot report yourself');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  if (reason.length < MIN_REASON_LENGTH) {
    throw createHttpError(400, 'Report reason is too short');
  }

  if (reason.length > MAX_REASON_LENGTH) {
    throw createHttpError(400, 'Report reason is too long');
  }

  const gameResult = await pool.query(
    'SELECT id, creator_id, title FROM games WHERE id = $1 LIMIT 1',
    [gameId]
  );
  const game = gameResult.rows[0];

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  const participantIds = await getGameParticipantIds(gameId, game.creator_id);

  if (!participantIds.has(auth.userId)) {
    throw createHttpError(403, 'Only game participants can send reports');
  }

  if (!participantIds.has(targetUserId)) {
    throw createHttpError(400, 'Target user is not a participant of this game');
  }

  const insertResult = await pool.query(
    `INSERT INTO reports (reporter_id, target_user_id, game_id, reason)
    VALUES ($1, $2, $3, $4)
    RETURNING id, reporter_id, target_user_id, game_id, reason, status, created_at`,
    [auth.userId, targetUserId, gameId, reason]
  );
  const report = insertResult.rows[0];

  // Уведомление каждому администратору: новая жалоба.
  const adminsResult = await pool.query(
    "SELECT id FROM users WHERE role = 'admin'"
  );

  const targetNameResult = await pool.query(
    'SELECT display_name FROM users WHERE id = $1 LIMIT 1',
    [targetUserId]
  );

  for (const admin of adminsResult.rows) {
    await createNotification({
      userId: admin.id,
      actorUserId: auth.userId,
      type: 'report_created',
      entityType: 'report',
      entityId: report.id,
      payload: {
        gameTitle: game.title,
        targetName: targetNameResult.rows[0]?.display_name || ''
      }
    });
  }

  return mapReportRow(report);
}

module.exports = {
  createReport
};
