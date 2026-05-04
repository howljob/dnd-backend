const pool = require('../../db/pool');

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAuditRow(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details,
    createdAt: toIso(row.created_at)
  };
}

async function listAuditLogs(query) {
  const params = [];
  const where = [];
  const action = typeof query?.action === 'string' ? query.action.trim() : '';
  const actorRole = typeof query?.actorRole === 'string' ? query.actorRole.trim().toLowerCase() : '';
  const targetType = typeof query?.targetType === 'string' ? query.targetType.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }

  if (actorRole) {
    params.push(actorRole);
    where.push(`actor_role = $${params.length}`);
  }

  if (targetType) {
    params.push(targetType);
    where.push(`target_type = $${params.length}`);
  }

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      id,
      actor_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      details,
      created_at
    FROM admin_audit_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapAuditRow);
}

async function getOverviewMetrics() {
  const [
    users,
    activeUsers,
    suspendedUsers,
    games,
    pendingMemberships,
    contentEntries,
    auditEvents24h
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS value FROM users'),
    pool.query(`SELECT COUNT(*)::int AS value FROM users WHERE account_status = 'active'`),
    pool.query(`SELECT COUNT(*)::int AS value FROM users WHERE account_status = 'suspended'`),
    pool.query('SELECT COUNT(*)::int AS value FROM games'),
    pool.query(`SELECT COUNT(*)::int AS value FROM game_memberships WHERE status = 'pending'`),
    pool.query('SELECT COUNT(*)::int AS value FROM site_content'),
    pool.query(`SELECT COUNT(*)::int AS value FROM admin_audit_logs WHERE created_at >= now() - interval '24 hours'`)
  ]);

  return {
    users: Number(users.rows[0]?.value || 0),
    activeUsers: Number(activeUsers.rows[0]?.value || 0),
    suspendedUsers: Number(suspendedUsers.rows[0]?.value || 0),
    games: Number(games.rows[0]?.value || 0),
    pendingMemberships: Number(pendingMemberships.rows[0]?.value || 0),
    contentEntries: Number(contentEntries.rows[0]?.value || 0),
    adminEventsLast24h: Number(auditEvents24h.rows[0]?.value || 0)
  };
}

module.exports = {
  listAuditLogs,
  getOverviewMetrics
};
