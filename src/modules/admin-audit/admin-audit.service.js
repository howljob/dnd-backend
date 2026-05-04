const pool = require('../../db/pool');

async function logAdminAction(event) {
  const payload = event && typeof event === 'object' ? event : {};

  const actorUserId = payload.actorUserId || null;
  const actorRole = String(payload.actorRole || 'unknown');
  const action = String(payload.action || 'unknown.action');
  const targetType = String(payload.targetType || 'unknown');
  const targetId = payload.targetId ? String(payload.targetId) : null;
  const details = payload.details && typeof payload.details === 'object' ? payload.details : {};

  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (
        actor_user_id,
        actor_role,
        action,
        target_type,
        target_id,
        details
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorUserId, actorRole, action, targetType, targetId, details]
    );
  } catch (error) {
    // Audit writes must not break the primary business operation.
    console.error('Failed to write admin audit log:', error.message);
  }
}

module.exports = {
  logAdminAction
};
