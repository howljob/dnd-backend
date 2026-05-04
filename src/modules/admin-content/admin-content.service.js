const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');

const ALLOWED_LOCALES = ['ru', 'en'];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapContentRow(row) {
  return {
    id: row.id,
    key: row.content_key,
    locale: row.locale,
    content: row.content,
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listContent(query) {
  const params = [];
  const where = [];
  const key = typeof query?.key === 'string' ? query.key.trim() : '';
  const locale = typeof query?.locale === 'string' ? query.locale.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  if (key) {
    params.push(key);
    where.push(`content_key = $${params.length}`);
  }

  if (locale) {
    if (!ALLOWED_LOCALES.includes(locale)) {
      throw createHttpError(400, 'Invalid locale');
    }

    params.push(locale);
    where.push(`locale = $${params.length}`);
  }

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id, content_key, locale, content, updated_by, created_at, updated_at
    FROM site_content
    ${whereSql}
    ORDER BY content_key ASC, locale ASC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapContentRow);
}

async function upsertContent(auth, data) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const payload = data && typeof data === 'object' ? data : {};
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';
  const locale = typeof payload.locale === 'string' ? payload.locale.trim().toLowerCase() : '';
  const content = payload.content;

  if (!key) {
    throw createHttpError(400, 'Content key is required');
  }

  if (!ALLOWED_LOCALES.includes(locale)) {
    throw createHttpError(400, 'Invalid locale');
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw createHttpError(400, 'Content must be an object');
  }

  const result = await pool.query(
    `INSERT INTO site_content (
      content_key,
      locale,
      content,
      updated_by
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (content_key, locale)
    DO UPDATE
    SET content = EXCLUDED.content,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    RETURNING id, content_key, locale, content, updated_by, created_at, updated_at`,
    [key, locale, content, auth.userId]
  );

  const item = mapContentRow(result.rows[0]);
  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.content.upsert',
    targetType: 'content',
    targetId: item.id,
    details: { key, locale }
  });

  return item;
}

module.exports = {
  listContent,
  upsertContent
};
