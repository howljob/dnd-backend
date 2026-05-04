const pool = require('../../db/pool');

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createNotification(data, db = pool) {
  const payload = data && typeof data === 'object' ? data : {};
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
  const actorUserId = typeof payload.actorUserId === 'string' && isUuid(payload.actorUserId)
    ? payload.actorUserId
    : null;
  const type = typeof payload.type === 'string' ? payload.type.trim() : '';
  const entityType = typeof payload.entityType === 'string' ? payload.entityType.trim() : '';
  const entityId = typeof payload.entityId === 'string' && isUuid(payload.entityId) ? payload.entityId : null;
  const details = payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
    ? payload.payload
    : {};

  if (!isUuid(userId) || !type || !entityType) {
    return null;
  }

  await db.query(
    `INSERT INTO community_notifications (
      user_id,
      actor_user_id,
      notification_type,
      entity_type,
      entity_id,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, actorUserId, type, entityType, entityId, details]
  );

  return true;
}

module.exports = {
  createNotification
};
