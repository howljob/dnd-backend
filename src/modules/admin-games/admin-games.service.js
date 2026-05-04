const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');

const ALLOWED_STATUS_SLUGS = ['active', 'cancelled', 'completed'];

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

function mapGame(row) {
  return {
    id: row.id,
    title: row.title,
    status: {
      id: row.status_id,
      slug: row.status_slug,
      name: row.status_name
    },
    creator: {
      id: row.creator_id,
      displayName: row.creator_display_name
    },
    startsAt: toIso(row.starts_at),
    maxPlayers: row.max_players,
    approvedPlayers: Number(row.approved_players || 0),
    pendingMemberships: Number(row.pending_memberships || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listGames(query) {
  const params = [];
  const where = [];
  const search = typeof query?.search === 'string' ? query.search.trim() : '';
  const status = typeof query?.status === 'string' ? query.status.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  if (search) {
    params.push(`%${search}%`);
    where.push(`(g.title ILIKE $${params.length} OR creator.display_name ILIKE $${params.length})`);
  }

  if (status) {
    params.push(status);
    where.push(`gs.slug = $${params.length}`);
  }

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      g.id,
      g.title,
      g.starts_at,
      g.max_players,
      g.created_at,
      g.updated_at,
      creator.id AS creator_id,
      creator.display_name AS creator_display_name,
      gs.id AS status_id,
      gs.slug AS status_slug,
      gs.name AS status_name,
      COUNT(gm.id) FILTER (WHERE gm.member_role = 'player' AND gm.status = 'approved')::int AS approved_players,
      COUNT(gm.id) FILTER (WHERE gm.status = 'pending')::int AS pending_memberships
    FROM games g
    INNER JOIN users creator ON creator.id = g.creator_id
    INNER JOIN game_statuses gs ON gs.id = g.status_id
    LEFT JOIN game_memberships gm ON gm.game_id = g.id
    ${whereSql}
    GROUP BY g.id, creator.id, gs.id
    ORDER BY g.created_at DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapGame);
}

async function updateGameStatus(auth, gameId, statusSlug) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const normalizedStatus = typeof statusSlug === 'string' ? statusSlug.trim().toLowerCase() : '';
  if (!ALLOWED_STATUS_SLUGS.includes(normalizedStatus)) {
    throw createHttpError(400, 'Invalid game status');
  }

  const statusResult = await pool.query(
    'SELECT id, slug, name FROM game_statuses WHERE slug = $1 LIMIT 1',
    [normalizedStatus]
  );

  if (!statusResult.rows[0]) {
    throw createHttpError(400, 'Game status not found');
  }

  const updateResult = await pool.query(
    `UPDATE games
    SET status_id = $2, updated_at = now()
    WHERE id = $1
    RETURNING id`,
    [gameId, statusResult.rows[0].id]
  );

  if (!updateResult.rows[0]) {
    throw createHttpError(404, 'Game not found');
  }

  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.game.status.update',
    targetType: 'game',
    targetId: gameId,
    details: { status: normalizedStatus }
  });
}

async function hideGame(auth, gameId) {
  await updateGameStatus(auth, gameId, 'cancelled');

  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.game.hide',
    targetType: 'game',
    targetId: gameId,
    details: { status: 'cancelled' }
  });
}

module.exports = {
  listGames,
  updateGameStatus,
  hideGame
};
