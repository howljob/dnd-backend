const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');

const ALLOWED_ACCOUNT_STATUSES = ['active', 'suspended', 'deleted'];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    accountStatus: row.account_status,
    language: row.language,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

async function listUsers(query) {
  const params = [];
  const where = [];
  const search = typeof query?.search === 'string' ? query.search.trim() : '';
  const role = typeof query?.role === 'string' ? query.role.trim().toLowerCase() : '';
  const accountStatus = typeof query?.accountStatus === 'string' ? query.accountStatus.trim().toLowerCase() : '';
  const limitRaw = Number(query?.limit);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  if (search) {
    params.push(`%${search}%`);
    where.push(`(email ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
  }

  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }

  if (accountStatus) {
    params.push(accountStatus);
    where.push(`account_status = $${params.length}`);
  }

  params.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id, email, display_name, role, account_status, language, created_at, updated_at
    FROM users
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${params.length}`,
    params
  );

  return result.rows.map(mapUser);
}

async function getUserById(userId) {
  const result = await pool.query(
    `SELECT id, email, display_name, role, account_status, language, created_at, updated_at
    FROM users
    WHERE id = $1
    LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function updateUserAccountStatus(auth, userId, accountStatus) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(userId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  const normalizedStatus = typeof accountStatus === 'string' ? accountStatus.trim().toLowerCase() : '';
  if (!ALLOWED_ACCOUNT_STATUSES.includes(normalizedStatus)) {
    throw createHttpError(400, 'Invalid account status');
  }

  if (auth.userId === userId && normalizedStatus !== 'active') {
    throw createHttpError(400, 'Admin cannot deactivate own account');
  }

  const user = await getUserById(userId);
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  await pool.query(
    `UPDATE users
    SET account_status = $2, updated_at = now()
    WHERE id = $1`,
    [userId, normalizedStatus]
  );

  const updatedUser = await getUserById(userId);
  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.user.status.update',
    targetType: 'user',
    targetId: userId,
    details: { accountStatus: normalizedStatus }
  });
  return mapUser(updatedUser);
}

async function deleteUser(auth, userId) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(userId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  if (auth.userId === userId) {
    throw createHttpError(400, 'Admin cannot delete own account');
  }

  const user = await getUserById(userId);
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  await pool.query(
    `UPDATE users
    SET account_status = 'deleted', updated_at = now()
    WHERE id = $1`,
    [userId]
  );

  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'admin.user.delete',
    targetType: 'user',
    targetId: userId,
    details: { accountStatus: 'deleted' }
  });
}

module.exports = {
  listUsers,
  updateUserAccountStatus,
  deleteUser
};
