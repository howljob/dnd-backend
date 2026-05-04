const pool = require('../../db/pool');

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function recordActivityEvent(data, db = pool) {
  const payload = data && typeof data === 'object' ? data : {};
  const actorUserId = typeof payload.actorUserId === 'string' ? payload.actorUserId.trim() : '';
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';
  const entityType = typeof payload.entityType === 'string' ? payload.entityType.trim() : '';
  const entityId = typeof payload.entityId === 'string' && isUuid(payload.entityId) ? payload.entityId : null;
  const eventPayload = payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
    ? payload.payload
    : {};

  if (!isUuid(actorUserId) || !eventType || !entityType) {
    return null;
  }

  await db.query(
    `INSERT INTO community_activity_events (
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    )
    VALUES ($1, $2, $3, $4, $5)`,
    [actorUserId, eventType, entityType, entityId, eventPayload]
  );

  return true;
}

module.exports = {
  recordActivityEvent
};
