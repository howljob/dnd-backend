const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');

const ALLOWED_STATUSES = ['open', 'resolved', 'dismissed'];

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

function mapReportRow(row) {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    reporter: {
      id: row.reporter_id,
      displayName: row.reporter_display_name || ''
    },
    target: {
      id: row.target_user_id,
      displayName: row.target_display_name || ''
    },
    game: row.game_id
      ? {
        id: row.game_id,
        title: row.game_title || ''
      }
      : null,
    resolvedBy: row.resolved_by,
    resolvedAt: toIso(row.resolved_at),
    createdAt: toIso(row.created_at)
  };
}

const REPORT_SELECT = `
  SELECT
    r.id,
    r.reporter_id,
    r.target_user_id,
    r.game_id,
    r.reason,
    r.status,
    r.resolved_by,
    r.resolved_at,
    r.created_at,
    reporter.display_name AS reporter_display_name,
    target.display_name AS target_display_name,
    g.title AS game_title
  FROM reports r
  INNER JOIN users reporter ON reporter.id = r.reporter_id
  INNER JOIN users target ON target.id = r.target_user_id
  LEFT JOIN games g ON g.id = r.game_id
`;

async function listReports(query) {
  const params = [];
  let whereSql = '';
  const status = typeof query?.status === 'string' ? query.status.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

  if (status) {
    if (!ALLOWED_STATUSES.includes(status)) {
      throw createHttpError(400, 'Invalid status filter');
    }

    params.push(status);
    whereSql = `WHERE r.status = $${params.length}`;
  }

  params.push(limit);

  const result = await pool.query(
    `${REPORT_SELECT}
    ${whereSql}
    ORDER BY r.created_at DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapReportRow);
}

async function resolveReport(auth, reportId, resolution) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(reportId)) {
    throw createHttpError(400, 'Invalid report id');
  }

  if (!['resolved', 'dismissed'].includes(resolution)) {
    throw createHttpError(400, 'Invalid resolution');
  }

  const existingResult = await pool.query(
    'SELECT id, status FROM reports WHERE id = $1 LIMIT 1',
    [reportId]
  );
  const existing = existingResult.rows[0];

  if (!existing) {
    throw createHttpError(404, 'Report not found');
  }

  if (existing.status !== 'open') {
    throw createHttpError(400, 'Report is already processed');
  }

  await pool.query(
    `UPDATE reports
    SET status = $2, resolved_by = $3, resolved_at = now()
    WHERE id = $1`,
    [reportId, resolution, auth.userId]
  );

  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: resolution === 'resolved' ? 'admin.report.resolve' : 'admin.report.dismiss',
    targetType: 'report',
    targetId: reportId,
    details: {}
  });

  const updatedResult = await pool.query(
    `${REPORT_SELECT}
    WHERE r.id = $1
    LIMIT 1`,
    [reportId]
  );

  return mapReportRow(updatedResult.rows[0]);
}

module.exports = {
  listReports,
  resolveReport
};
