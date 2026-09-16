const pool = require('../../db/pool');
const env = require('../../config/env');
const { recordActivityEvent } = require('../community/community-activity.service');
const { createNotification } = require('../community/community-notifications.service');

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
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function getTimeoutDays() {
  const days = Number(env.transferTimeoutDays);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

function getCompletableAt(createdAt) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return new Date(created.getTime() + getTimeoutDays() * 24 * 60 * 60 * 1000);
}

function mapRequestRow(row) {
  const completableAt = getCompletableAt(row.created_at);

  return {
    id: row.id,
    gameId: row.game_id,
    status: row.status,
    initiator: {
      id: row.initiated_by,
      displayName: row.initiator_display_name || ''
    },
    candidate: {
      id: row.candidate_user_id,
      displayName: row.candidate_display_name || ''
    },
    createdAt: toIso(row.created_at),
    resolvedAt: toIso(row.resolved_at),
    timeoutDays: getTimeoutDays(),
    completableAt: completableAt.toISOString(),
    canCompleteNow: row.status === 'pending' && completableAt.getTime() <= Date.now()
  };
}

const REQUEST_SELECT = `
  SELECT
    t.id,
    t.game_id,
    t.initiated_by,
    t.candidate_user_id,
    t.status,
    t.created_at,
    t.resolved_at,
    initiator.display_name AS initiator_display_name,
    candidate.display_name AS candidate_display_name
  FROM game_transfer_requests t
  INNER JOIN users initiator ON initiator.id = t.initiated_by
  INNER JOIN users candidate ON candidate.id = t.candidate_user_id
`;

async function getGameById(gameId) {
  const result = await pool.query(
    'SELECT id, creator_id, title FROM games WHERE id = $1 LIMIT 1',
    [gameId]
  );

  return result.rows[0] || null;
}

async function getApprovedMemberIds(gameId) {
  const result = await pool.query(
    `SELECT user_id
     FROM game_memberships
     WHERE game_id = $1
       AND status = 'approved'`,
    [gameId]
  );

  return new Set(result.rows.map((row) => row.user_id));
}

async function getRequestById(requestId) {
  const result = await pool.query(
    `${REQUEST_SELECT}
     WHERE t.id = $1
     LIMIT 1`,
    [requestId]
  );

  return result.rows[0] || null;
}

async function notifyTransferParticipants(game, request, type, actorUserId) {
  const memberIds = await getApprovedMemberIds(game.id);
  memberIds.add(game.creator_id);
  memberIds.add(request.initiated_by);
  memberIds.add(request.candidate_user_id);

  for (const userId of memberIds) {
    if (userId === actorUserId) continue;
    await createNotification({
      userId,
      actorUserId,
      type,
      entityType: 'game',
      entityId: game.id,
      payload: {
        gameTitle: game.title,
        candidateName: request.candidate_display_name || ''
      }
    });
  }
}

// T8.4: любой одобренный участник инициирует передачу игры кандидату из участников.
async function createTransferRequest(auth, gameId, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const payload = data && typeof data === 'object' ? data : {};
  const candidateUserId = typeof payload.candidateUserId === 'string' ? payload.candidateUserId.trim() : '';

  if (!isUuid(candidateUserId)) {
    throw createHttpError(400, 'Invalid candidate user id');
  }

  const game = await getGameById(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  if (auth.userId === game.creator_id) {
    throw createHttpError(400, 'The game master cannot request a transfer from themselves');
  }

  if (candidateUserId === game.creator_id) {
    throw createHttpError(400, 'The game already belongs to this user');
  }

  const memberIds = await getApprovedMemberIds(gameId);

  if (!memberIds.has(auth.userId)) {
    throw createHttpError(403, 'Only approved game members can request a transfer');
  }

  if (!memberIds.has(candidateUserId)) {
    throw createHttpError(400, 'Candidate must be an approved game member');
  }

  let insertResult;
  try {
    insertResult = await pool.query(
      `INSERT INTO game_transfer_requests (game_id, initiated_by, candidate_user_id)
      VALUES ($1, $2, $3)
      RETURNING id`,
      [gameId, auth.userId, candidateUserId]
    );
  } catch (error) {
    // Частичный уникальный индекс: не больше одного открытого запроса на игру.
    if (error.code === '23505') {
      throw createHttpError(409, 'A pending transfer request already exists for this game');
    }

    throw error;
  }

  const request = await getRequestById(insertResult.rows[0].id);

  await recordActivityEvent({
    actorUserId: auth.userId,
    eventType: 'game.transfer_requested',
    entityType: 'game',
    entityId: gameId,
    payload: {
      candidateUserId
    }
  });

  // Уведомление мастеру: группа просит передать игру.
  await createNotification({
    userId: game.creator_id,
    actorUserId: auth.userId,
    type: 'transfer_requested',
    entityType: 'game',
    entityId: gameId,
    payload: {
      gameTitle: game.title,
      candidateName: request.candidate_display_name || ''
    }
  });

  return mapRequestRow(request);
}

// Текущий открытый запрос по игре (для блока на странице игры).
async function getPendingTransferRequest(auth, gameId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const game = await getGameById(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  const memberIds = await getApprovedMemberIds(gameId);

  if (auth.role !== 'admin' && auth.userId !== game.creator_id && !memberIds.has(auth.userId)) {
    throw createHttpError(403, 'Forbidden');
  }

  const result = await pool.query(
    `${REQUEST_SELECT}
     WHERE t.game_id = $1
       AND t.status = 'pending'
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [gameId]
  );

  return result.rows[0] ? mapRequestRow(result.rows[0]) : null;
}

// Сама передача: creator_id → кандидат, старый мастер становится обычным
// участником. Персонажи и сессии не трогаются.
async function performTransfer(game, request, newStatus, actorUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Все одобренные GM-участники становятся игроками
    //    (частичный уникальный индекс «один approved gm» требует порядка операций).
    await client.query(
      `UPDATE game_memberships
      SET member_role = 'player', updated_at = now()
      WHERE game_id = $1
        AND member_role = 'gm'
        AND status = 'approved'`,
      [game.id]
    );

    // 2. Кандидат становится GM.
    await client.query(
      `UPDATE game_memberships
      SET member_role = 'gm', updated_at = now()
      WHERE game_id = $1
        AND user_id = $2
        AND status = 'approved'`,
      [game.id, request.candidate_user_id]
    );

    // 3. Игра переходит кандидату.
    await client.query(
      'UPDATE games SET creator_id = $2, updated_at = now() WHERE id = $1',
      [game.id, request.candidate_user_id]
    );

    // 4. Запрос закрывается.
    await client.query(
      `UPDATE game_transfer_requests
      SET status = $2, resolved_at = now()
      WHERE id = $1`,
      [request.id, newStatus]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Запись в ленту игры + уведомления всем участникам.
  await recordActivityEvent({
    actorUserId,
    eventType: 'game.transfer_completed',
    entityType: 'game',
    entityId: game.id,
    payload: {
      newMasterUserId: request.candidate_user_id,
      previousMasterUserId: game.creator_id
    }
  });

  await notifyTransferParticipants(game, request, 'transfer_completed', actorUserId);

  const updated = await getRequestById(request.id);
  return mapRequestRow(updated);
}

// Мастер соглашается передать игру.
async function approveTransferRequest(auth, gameId, requestId) {
  const { game, request } = await loadPendingRequestForGame(auth, gameId, requestId);

  if (auth.role !== 'admin' && auth.userId !== game.creator_id) {
    throw createHttpError(403, 'Only the game master can approve the transfer');
  }

  return performTransfer(game, request, 'approved', auth.userId);
}

// Мастер отклоняет запрос.
async function declineTransferRequest(auth, gameId, requestId) {
  const { game, request } = await loadPendingRequestForGame(auth, gameId, requestId);

  if (auth.role !== 'admin' && auth.userId !== game.creator_id) {
    throw createHttpError(403, 'Only the game master can decline the transfer');
  }

  await pool.query(
    `UPDATE game_transfer_requests
    SET status = 'declined', resolved_at = now()
    WHERE id = $1`,
    [request.id]
  );

  await notifyTransferParticipants(game, request, 'transfer_declined', auth.userId);

  const updated = await getRequestById(request.id);
  return mapRequestRow(updated);
}

// Мастер молчит N дней — любой одобренный участник завершает передачу.
async function completeTransferRequest(auth, gameId, requestId) {
  const { game, request } = await loadPendingRequestForGame(auth, gameId, requestId);

  const memberIds = await getApprovedMemberIds(gameId);

  if (auth.role !== 'admin' && !memberIds.has(auth.userId)) {
    throw createHttpError(403, 'Only approved game members can complete the transfer');
  }

  const completableAt = getCompletableAt(request.created_at);

  if (Date.now() < completableAt.getTime()) {
    const error = createHttpError(
      403,
      `The master still has time to answer: the transfer can be completed after ${completableAt.toISOString()} (${getTimeoutDays()} days from the request)`
    );
    error.completableAt = completableAt.toISOString();
    throw error;
  }

  return performTransfer(game, request, 'expired-completed', auth.userId);
}

async function loadPendingRequestForGame(auth, gameId, requestId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId) || !isUuid(requestId)) {
    throw createHttpError(400, 'Invalid id');
  }

  const game = await getGameById(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  const request = await getRequestById(requestId);

  if (!request || request.game_id !== gameId) {
    throw createHttpError(404, 'Transfer request not found');
  }

  if (request.status !== 'pending') {
    throw createHttpError(400, 'Transfer request is already resolved');
  }

  return { game, request };
}

module.exports = {
  createTransferRequest,
  getPendingTransferRequest,
  approveTransferRequest,
  declineTransferRequest,
  completeTransferRequest
};
