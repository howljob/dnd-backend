const pool = require('../../db/pool');
const { recordActivityEvent } = require('../community/community-activity.service');
const { createNotification } = require('../community/community-notifications.service');
const ALLOWED_REQUESTED_ROLES = ['player', 'gm'];
const DEFAULT_REQUESTED_ROLE = 'player';

const MEMBERSHIP_SELECT = `
  SELECT
    m.id,
    m.game_id,
    m.user_id,
    m.member_role,
    m.status,
    m.application_message,
    m.character_concept,
    m.created_at,
    m.updated_at,
    u.display_name AS user_display_name,
    u.role AS user_role,
    g.creator_id,
    g.title AS game_title,
    g.max_players,
    gs.slug AS game_status_slug
  FROM game_memberships m
  INNER JOIN users u ON u.id = m.user_id
  INNER JOIN games g ON g.id = m.game_id
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

function validateRequestedRole(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const rawRequestedRole = typeof payload.requestedRole === 'string' ? payload.requestedRole.trim().toLowerCase() : '';

  if (rawRequestedRole && !ALLOWED_REQUESTED_ROLES.includes(rawRequestedRole)) {
    throw createHttpError(400, 'Invalid requestedRole');
  }

  return rawRequestedRole || DEFAULT_REQUESTED_ROLE;
}

function validateOptionalText(value, fieldName, maxLength) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, `Invalid ${fieldName}`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long`);
  }

  return trimmed || null;
}

function mapMembershipRow(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    memberRole: row.member_role,
    status: row.status,
    message: row.application_message || '',
    characterConcept: row.character_concept || '',
    user: {
      id: row.user_id,
      displayName: row.user_display_name,
      role: row.user_role
    },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function createSummary(rows, maxPlayers) {
  const approvedPlayers = rows.filter(
    (row) => row.member_role === 'player' && row.status === 'approved'
  ).length;

  const hasApprovedGm = rows.some(
    (row) => row.member_role === 'gm' && row.status === 'approved'
  );

  return {
    approvedPlayers,
    maxPlayers,
    isFull: approvedPlayers >= maxPlayers,
    hasApprovedGm
  };
}

async function getGameForMemberships(gameId) {
  const result = await pool.query(
    `SELECT
      g.id,
      g.creator_id,
      g.title,
      g.max_players,
      gs.slug AS status_slug
    FROM games g
    INNER JOIN game_statuses gs ON gs.id = g.status_id
    WHERE g.id = $1
    LIMIT 1`,
    [gameId]
  );

  return result.rows[0] || null;
}

async function getMembershipByGameAndUser(gameId, userId) {
  const result = await pool.query(
    'SELECT id, status FROM game_memberships WHERE game_id = $1 AND user_id = $2 LIMIT 1',
    [gameId, userId]
  );

  return result.rows[0] || null;
}

async function getMembershipById(membershipId) {
  const result = await pool.query(
    `${MEMBERSHIP_SELECT}
     WHERE m.id = $1
     LIMIT 1`,
    [membershipId]
  );

  return result.rows[0] || null;
}

async function getMembershipRowsByGameId(gameId) {
  const result = await pool.query(
    `${MEMBERSHIP_SELECT}
     WHERE m.game_id = $1
     ORDER BY m.created_at ASC`,
    [gameId]
  );

  return result.rows;
}

async function getApprovedGmMembership(gameId, excludedMembershipId) {
  const values = [gameId];
  let excludedSql = '';

  if (excludedMembershipId) {
    values.push(excludedMembershipId);
    excludedSql = 'AND id <> $2';
  }

  const result = await pool.query(
    `SELECT id
    FROM game_memberships
    WHERE game_id = $1
      AND member_role = 'gm'
      AND status = 'approved'
      ${excludedSql}
    LIMIT 1`,
    values
  );

  return result.rows[0] || null;
}

async function countApprovedPlayers(gameId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS approved_players
    FROM game_memberships
    WHERE game_id = $1
      AND member_role = 'player'
      AND status = 'approved'`,
    [gameId]
  );

  return result.rows[0].approved_players;
}

async function listMembershipsByGameId(gameId) {
  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const game = await getGameForMemberships(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  const rows = await getMembershipRowsByGameId(gameId);

  return {
    items: rows.map(mapMembershipRow),
    summary: createSummary(rows, game.max_players)
  };
}

async function joinGame(auth, gameId, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const game = await getGameForMemberships(gameId);

  if (!game) {
    throw createHttpError(404, 'Game not found');
  }

  if (game.status_slug !== 'active') {
    throw createHttpError(400, 'Game is not active');
  }

  if (auth.userId === game.creator_id) {
    throw createHttpError(409, 'Creator is already a member');
  }

  const existingMembership = await getMembershipByGameAndUser(gameId, auth.userId);

  // T8.3: исключённый мастером участник не может вернуться за стол.
  if (existingMembership?.status === 'kicked') {
    throw createHttpError(403, 'You were removed from this game by the master');
  }

  if (existingMembership) {
    throw createHttpError(409, 'Membership already exists');
  }

  const memberRole = validateRequestedRole(data);
  const payload = data && typeof data === 'object' ? data : {};
  const applicationMessage = validateOptionalText(payload.message, 'message', 2000);
  const characterConcept = validateOptionalText(payload.characterConcept, 'characterConcept', 500);

  try {
    const insertResult = await pool.query(
      `INSERT INTO game_memberships (game_id, user_id, member_role, status, application_message, character_concept)
      VALUES ($1, $2, $3, 'pending', $4, $5)
      RETURNING id`,
      [gameId, auth.userId, memberRole, applicationMessage, characterConcept]
    );

    const membership = await getMembershipById(insertResult.rows[0].id);
    await recordActivityEvent({
      actorUserId: auth.userId,
      eventType: 'game.join_requested',
      entityType: 'game',
      entityId: gameId,
      payload: {
        requestedRole: memberRole
      }
    });

    // Уведомление мастеру (создателю игры) о новой заявке.
    await createNotification({
      userId: game.creator_id,
      actorUserId: auth.userId,
      type: 'game_join_requested',
      entityType: 'game',
      entityId: gameId,
      payload: {
        gameTitle: game.title,
        requestedRole: memberRole
      }
    });

    return mapMembershipRow(membership);
  } catch (error) {
    if (error.code === '23505') {
      throw createHttpError(409, 'Membership already exists');
    }

    throw error;
  }
}

async function approveMembership(auth, membershipId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(membershipId)) {
    throw createHttpError(400, 'Invalid membership id');
  }

  const membership = await getMembershipById(membershipId);

  if (!membership) {
    throw createHttpError(404, 'Membership not found');
  }

  if (auth.role !== 'admin' && auth.userId !== membership.creator_id) {
    throw createHttpError(403, 'Forbidden');
  }

  if (membership.status !== 'pending') {
    throw createHttpError(400, 'Membership is not pending');
  }

  if (membership.member_role === 'gm') {
    const approvedGm = await getApprovedGmMembership(membership.game_id, membership.id);

    if (approvedGm) {
      throw createHttpError(409, 'Approved GM already exists');
    }
  }

  if (membership.member_role === 'player') {
    const approvedPlayers = await countApprovedPlayers(membership.game_id);

    if (approvedPlayers >= membership.max_players) {
      throw createHttpError(409, 'No player slots available');
    }
  }

  try {
    await pool.query(
      `UPDATE game_memberships
      SET status = 'approved', updated_at = now()
      WHERE id = $1`,
      [membershipId]
    );
  } catch (error) {
    if (error.code === '23505') {
      throw createHttpError(409, 'Approved GM already exists');
    }

    throw error;
  }

  const updatedMembership = await getMembershipById(membershipId);
  await recordActivityEvent({
    actorUserId: membership.user_id,
    eventType: 'game.join_approved',
    entityType: 'game',
    entityId: membership.game_id,
    payload: {
      approvedRole: membership.member_role,
      approvedBy: auth.userId
    }
  });

  // Уведомление игроку: заявка одобрена.
  await createNotification({
    userId: membership.user_id,
    actorUserId: auth.userId,
    type: 'game_join_approved',
    entityType: 'game',
    entityId: membership.game_id,
    payload: {
      gameTitle: membership.game_title,
      approvedRole: membership.member_role
    }
  });

  return mapMembershipRow(updatedMembership);
}

async function rejectMembership(auth, membershipId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(membershipId)) {
    throw createHttpError(400, 'Invalid membership id');
  }

  const membership = await getMembershipById(membershipId);

  if (!membership) {
    throw createHttpError(404, 'Membership not found');
  }

  if (auth.role !== 'admin' && auth.userId !== membership.creator_id) {
    throw createHttpError(403, 'Forbidden');
  }

  if (membership.status !== 'pending') {
    throw createHttpError(400, 'Membership is not pending');
  }

  await pool.query(
    `UPDATE game_memberships
    SET status = 'rejected', updated_at = now()
    WHERE id = $1`,
    [membershipId]
  );

  // Уведомление игроку: заявка отклонена.
  await createNotification({
    userId: membership.user_id,
    actorUserId: auth.userId,
    type: 'game_join_rejected',
    entityType: 'game',
    entityId: membership.game_id,
    payload: {
      gameTitle: membership.game_title
    }
  });

  const updatedMembership = await getMembershipById(membershipId);
  return mapMembershipRow(updatedMembership);
}

async function cancelMembership(auth, membershipId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(membershipId)) {
    throw createHttpError(400, 'Invalid membership id');
  }

  const membership = await getMembershipById(membershipId);

  if (!membership) {
    throw createHttpError(404, 'Membership not found');
  }

  if (auth.role !== 'admin' && auth.userId !== membership.user_id) {
    throw createHttpError(403, 'Forbidden');
  }

  if (!['pending', 'approved'].includes(membership.status)) {
    throw createHttpError(400, 'Membership cannot be cancelled');
  }

  await pool.query(
    `UPDATE game_memberships
    SET status = 'cancelled', updated_at = now()
    WHERE id = $1`,
    [membershipId]
  );

  const updatedMembership = await getMembershipById(membershipId);
  return mapMembershipRow(updatedMembership);
}

// T8.3: мастер удаляет участника из игры; тот получает уведомление
// и больше не может ни войти за стол, ни подать заявку повторно.
async function kickMembership(auth, membershipId) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(membershipId)) {
    throw createHttpError(400, 'Invalid membership id');
  }

  const membership = await getMembershipById(membershipId);

  if (!membership) {
    throw createHttpError(404, 'Membership not found');
  }

  if (auth.role !== 'admin' && auth.userId !== membership.creator_id) {
    throw createHttpError(403, 'Only the game master can remove participants');
  }

  if (membership.user_id === membership.creator_id) {
    throw createHttpError(400, 'The game master cannot be kicked');
  }

  if (!['pending', 'approved'].includes(membership.status)) {
    throw createHttpError(400, 'Membership cannot be kicked');
  }

  await pool.query(
    `UPDATE game_memberships
    SET status = 'kicked', updated_at = now()
    WHERE id = $1`,
    [membershipId]
  );

  await recordActivityEvent({
    actorUserId: auth.userId,
    eventType: 'game.member_kicked',
    entityType: 'game',
    entityId: membership.game_id,
    payload: {
      kickedUserId: membership.user_id
    }
  });

  // Уведомление участнику: вас исключили из игры.
  await createNotification({
    userId: membership.user_id,
    actorUserId: auth.userId,
    type: 'game_kicked',
    entityType: 'game',
    entityId: membership.game_id,
    payload: {
      gameTitle: membership.game_title
    }
  });

  const updatedMembership = await getMembershipById(membershipId);
  return mapMembershipRow(updatedMembership);
}

module.exports = {
  listMembershipsByGameId,
  joinGame,
  approveMembership,
  rejectMembership,
  cancelMembership,
  kickMembership
};
