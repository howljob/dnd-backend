const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');

const ALLOWED_MEMBERSHIP_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

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

function mapMembership(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    memberRole: row.member_role,
    status: row.status,
    user: {
      id: row.user_id,
      displayName: row.user_display_name,
      role: row.user_role
    },
    game: {
      title: row.game_title,
      maxPlayers: row.max_players
    },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listMemberships(query) {
  const params = [];
  const where = [];
  const status = typeof query?.status === 'string' ? query.status.trim().toLowerCase() : '';
  const gameId = typeof query?.gameId === 'string' ? query.gameId.trim() : '';
  const role = typeof query?.memberRole === 'string' ? query.memberRole.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  if (status) {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }

  if (gameId) {
    if (!isUuid(gameId)) {
      throw createHttpError(400, 'Invalid game id');
    }
    params.push(gameId);
    where.push(`m.game_id = $${params.length}`);
  }

  if (role) {
    params.push(role);
    where.push(`m.member_role = $${params.length}`);
  }

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT
      m.id,
      m.game_id,
      m.user_id,
      m.member_role,
      m.status,
      m.created_at,
      m.updated_at,
      g.title AS game_title,
      g.max_players,
      u.display_name AS user_display_name,
      u.role AS user_role
    FROM game_memberships m
    INNER JOIN games g ON g.id = m.game_id
    INNER JOIN users u ON u.id = m.user_id
    ${whereSql}
    ORDER BY m.created_at DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapMembership);
}

async function getMembershipById(membershipId) {
  const result = await pool.query(
    `SELECT
      m.id,
      m.game_id,
      m.user_id,
      m.member_role,
      m.status,
      m.created_at,
      m.updated_at,
      g.title AS game_title,
      g.max_players,
      u.display_name AS user_display_name,
      u.role AS user_role
    FROM game_memberships m
    INNER JOIN games g ON g.id = m.game_id
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.id = $1
    LIMIT 1`,
    [membershipId]
  );

  return result.rows[0] || null;
}

async function ensureMembershipApprovalRules(membership) {
  if (membership.member_role === 'gm') {
    const gmResult = await pool.query(
      `SELECT id
      FROM game_memberships
      WHERE game_id = $1
        AND member_role = 'gm'
        AND status = 'approved'
        AND id <> $2
      LIMIT 1`,
      [membership.game_id, membership.id]
    );

    if (gmResult.rows[0]) {
      throw createHttpError(409, 'Approved GM already exists');
    }
  }

  if (membership.member_role === 'player') {
    const playersResult = await pool.query(
      `SELECT COUNT(*)::int AS approved_players
      FROM game_memberships
      WHERE game_id = $1
        AND member_role = 'player'
        AND status = 'approved'
        AND id <> $2`,
      [membership.game_id, membership.id]
    );

    const approvedPlayers = Number(playersResult.rows[0]?.approved_players || 0);
    if (approvedPlayers >= Number(membership.max_players || 0)) {
      throw createHttpError(409, 'No player slots available');
    }
  }
}

async function updateMembershipStatus(auth, membershipId, status) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(membershipId)) {
    throw createHttpError(400, 'Invalid membership id');
  }

  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (!ALLOWED_MEMBERSHIP_STATUSES.includes(normalizedStatus)) {
    throw createHttpError(400, 'Invalid membership status');
  }

  const membership = await getMembershipById(membershipId);
  if (!membership) {
    throw createHttpError(404, 'Membership not found');
  }

  if (normalizedStatus === 'approved') {
    await ensureMembershipApprovalRules(membership);
  }

  await pool.query(
    `UPDATE game_memberships
    SET status = $2, updated_at = now()
    WHERE id = $1`,
    [membershipId, normalizedStatus]
  );

  const updated = await getMembershipById(membershipId);
  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.membership.status.update',
    targetType: 'membership',
    targetId: membershipId,
    details: { status: normalizedStatus, gameId: updated.game_id }
  });

  return mapMembership(updated);
}

module.exports = {
  listMemberships,
  updateMembershipStatus
};
