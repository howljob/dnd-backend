const pool = require('../../db/pool');
const { createHttpError } = require('./tabletop.validation');

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireAuthUser(auth) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }
}

async function getTabletopMembership(auth, gameId, db = pool) {
  requireAuthUser(auth);

  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const result = await db.query(
    `SELECT
       g.id AS game_id,
       m.id AS membership_id,
       m.member_role,
       m.status
     FROM games g
     LEFT JOIN game_memberships m
       ON m.game_id = g.id
      AND m.user_id = $2
     WHERE g.id = $1
     LIMIT 1`,
    [gameId, auth.userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Game not found');
  }
  if (!row.membership_id || row.status !== 'approved') {
    throw createHttpError(403, 'Forbidden');
  }

  const role = row.member_role === 'gm' ? 'gm' : 'player';
  return {
    gameId: row.game_id,
    membershipId: row.membership_id,
    role,
    isGm: role === 'gm'
  };
}

async function requireTabletopGm(auth, gameId, db = pool) {
  const membership = await getTabletopMembership(auth, gameId, db);
  if (!membership.isGm) {
    throw createHttpError(403, 'Forbidden');
  }
  return membership;
}

module.exports = {
  isUuid,
  requireAuthUser,
  getTabletopMembership,
  requireTabletopGm
};
