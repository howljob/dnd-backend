const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID, randomBytes, createHash } = require('crypto');
const pool = require('../../db/pool');
const env = require('../../config/env');
const mailer = require('../../mail/mailer');
const mailTemplates = require('../../mail/templates');

const PUBLIC_REGISTER_ROLE = 'user';
const DEPRECATED_REGISTER_ROLES = ['user', 'player', 'gm'];
const FORBIDDEN_PUBLIC_REGISTER_ROLES = ['admin', 'moderator'];
const SALT_ROUNDS = 10;

// Одноразовые токены (T3.2/T3.3)
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час
const TOKEN_RATE_LIMIT_COUNT = 3; // не больше N писем одного типа…
const TOKEN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // …в час

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createJwtConfigError() {
  return createHttpError(500, 'JWT access secret is not configured');
}

function hashActionToken(rawToken) {
  return createHash('sha256').update(String(rawToken)).digest('hex');
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    language: row.language,
    accountStatus: row.account_status,
    bio: row.bio || '',
    avatar: row.avatar_url || null,
    emailConfirmed: Boolean(row.email_confirmed_at)
  };
}

/**
 * Создать одноразовый токен действия; в базе хранится только SHA-256-хэш.
 * @returns {Promise<string>} сырой токен для письма
 */
async function createActionToken(userId, type, ttlMs) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashActionToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);

  await pool.query(
    `INSERT INTO auth_action_tokens (user_id, token_hash, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, type, expiresAt]
  );

  return rawToken;
}

async function countRecentActionTokens(userId, type) {
  const result = await pool.query(
    `SELECT count(*)::int AS cnt
     FROM auth_action_tokens
     WHERE user_id = $1
       AND type = $2
       AND created_at > now() - ($3 || ' milliseconds')::interval`,
    [userId, type, TOKEN_RATE_LIMIT_WINDOW_MS]
  );

  return result.rows[0]?.cnt || 0;
}

function buildFrontendLink(hashPath, rawToken) {
  const base = String(env.frontendUrl || '').replace(/\/+$/, '');
  return `${base}/#${hashPath}?token=${rawToken}`;
}

/**
 * Отправить письмо «подтвердите почту». Ошибка отправки не роняет вызвавший сценарий.
 */
async function sendConfirmationEmail(user) {
  const rawToken = await createActionToken(user.id, 'confirm_email', CONFIRM_TOKEN_TTL_MS);
  const message = mailTemplates.confirmEmail({
    displayName: user.display_name || user.displayName || '',
    confirmUrl: buildFrontendLink('confirm-email', rawToken)
  });

  await mailer.sendMail({
    to: user.email,
    type: 'confirm-email',
    ...message
  });
}

async function registerUser(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
  const rawRole = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : '';
  const role = PUBLIC_REGISTER_ROLE;

  if (!email || !password || !displayName) {
    throw createHttpError(400, 'Invalid registration data');
  }

  if (rawRole && FORBIDDEN_PUBLIC_REGISTER_ROLES.includes(rawRole)) {
    throw createHttpError(400, 'Invalid role');
  }

  // Keep accepting legacy player/gm role payload from older clients,
  // but account role is always system-level "user" for public signups.
  if (rawRole && !DEPRECATED_REGISTER_ROLES.includes(rawRole)) {
    throw createHttpError(400, 'Invalid role');
  }

  const existingUserResult = await pool.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (existingUserResult.rows.length > 0) {
    throw createHttpError(409, 'User already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  let user;
  try {
    const result = await pool.query(
      `INSERT INTO users (
        email,
        password_hash,
        role,
        display_name,
        language,
        telegram_chat_id,
        email_notifications_enabled,
        telegram_notifications_enabled
      )
      VALUES ($1, $2, $3, $4, 'ru', NULL, true, false)
      RETURNING id, email, display_name, role, language, account_status, bio, avatar_url, email_confirmed_at`,
      [email, passwordHash, role, displayName]
    );

    user = result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw createHttpError(409, 'User already exists');
    }

    throw error;
  }

  // Письмо с подтверждением: сбой почты не должен ронять регистрацию.
  try {
    await sendConfirmationEmail(user);
  } catch (error) {
    console.error('[auth] failed to send confirmation email:', error.message);
  }

  return mapUser(user);
}

/**
 * Создать запись сессии и подписать JWT. Общая точка для обычного входа и OAuth.
 */
async function createSessionForUser(user, meta = {}) {
  if (!env.jwtAccessSecret) {
    throw createJwtConfigError();
  }

  const sessionTokenId = randomUUID();
  const sessionResult = await pool.query(
    `INSERT INTO user_sessions (
      user_id,
      token_id,
      user_agent,
      ip_address
    )
    VALUES ($1, $2, $3, $4)
    RETURNING id, token_id, created_at`,
    [
      user.id,
      sessionTokenId,
      typeof meta.userAgent === 'string' ? meta.userAgent.slice(0, 500) : null,
      typeof meta.ipAddress === 'string' ? meta.ipAddress.slice(0, 120) : null
    ]
  );

  const session = sessionResult.rows[0];

  const token = jwt.sign(
    {
      sub: user.id,
      sid: session.id,
      tid: session.token_id,
      email: user.email,
      role: user.role,
      accountStatus: user.account_status
    },
    env.jwtAccessSecret,
    {
      expiresIn: env.jwtAccessExpiresIn
    }
  );

  return {
    token,
    session: {
      id: session.id,
      tokenId: session.token_id,
      createdAt: session.created_at instanceof Date ? session.created_at.toISOString() : session.created_at
    }
  };
}

async function loginUser(data, meta = {}) {
  const payload = data && typeof data === 'object' ? data : {};
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!email || !password) {
    throw createHttpError(400, 'Invalid login data');
  }

  const result = await pool.query(
    `SELECT id, email, password_hash, display_name, role, language, account_status, bio, avatar_url, email_confirmed_at
    FROM users
    WHERE email = $1
    LIMIT 1`,
    [email]
  );

  const user = result.rows[0];

  if (!user) {
    throw createHttpError(401, 'Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw createHttpError(401, 'Invalid email or password');
  }

  if (user.account_status !== 'active') {
    throw createHttpError(403, 'Account is not active');
  }

  const { token, session } = await createSessionForUser(user, meta);

  return {
    token,
    user: mapUser(user),
    session
  };
}

/**
 * T3.2: подтверждение почты по одноразовому токену из письма.
 */
async function confirmEmail(rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token) {
    throw createHttpError(400, 'Token is required');
  }

  const tokenHash = hashActionToken(token);
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.expires_at, t.used_at,
            u.id AS uid, u.email, u.display_name, u.role, u.language,
            u.account_status, u.bio, u.avatar_url, u.email_confirmed_at
     FROM auth_action_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND t.type = 'confirm_email'
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw createHttpError(400, 'Invalid or expired token');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE auth_action_tokens SET used_at = now() WHERE id = $1',
      [row.id]
    );
    await client.query(
      `UPDATE users
       SET email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
       WHERE id = $1`,
      [row.user_id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    user: mapUser({ ...row, id: row.uid, email_confirmed_at: row.email_confirmed_at || new Date() })
  };
}

/**
 * T3.2: повторная отправка письма подтверждения (с лимитом повторов).
 */
async function resendConfirmation(auth) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const result = await pool.query(
    `SELECT id, email, display_name, email_confirmed_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [auth.userId]
  );

  const user = result.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  if (user.email_confirmed_at) {
    return { alreadyConfirmed: true };
  }

  const recentCount = await countRecentActionTokens(user.id, 'confirm_email');
  if (recentCount >= TOKEN_RATE_LIMIT_COUNT) {
    throw createHttpError(429, 'Too many confirmation emails, try again later');
  }

  await sendConfirmationEmail(user);
  return { sent: true };
}

/**
 * T3.3: «забыли пароль». Всегда отвечает одинаково — существование email не раскрывается.
 */
async function forgotPassword(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';

  if (!email) {
    throw createHttpError(400, 'Email is required');
  }

  const result = await pool.query(
    `SELECT id, email, display_name, account_status
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email]
  );

  const user = result.rows[0];
  if (!user || user.account_status !== 'active') {
    return; // молчим: снаружи ответ одинаковый
  }

  const recentCount = await countRecentActionTokens(user.id, 'password_reset');
  if (recentCount >= TOKEN_RATE_LIMIT_COUNT) {
    return; // тоже молчим, чтобы не раскрывать существование ящика
  }

  try {
    const rawToken = await createActionToken(user.id, 'password_reset', RESET_TOKEN_TTL_MS);
    const message = mailTemplates.resetPassword({
      displayName: user.display_name || '',
      resetUrl: buildFrontendLink('reset-password', rawToken)
    });

    await mailer.sendMail({
      to: user.email,
      type: 'reset-password',
      ...message
    });
  } catch (error) {
    console.error('[auth] failed to send reset email:', error.message);
  }
}

/**
 * T3.3: установка нового пароля по токену из письма. Отзывает ВСЕ сессии пользователя.
 */
async function resetPassword(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const rawToken = typeof payload.token === 'string' ? payload.token.trim() : '';
  const newPassword = typeof payload.password === 'string' ? payload.password : '';

  if (!rawToken) {
    throw createHttpError(400, 'Token is required');
  }

  if (!newPassword || newPassword.length < 8) {
    throw createHttpError(400, 'Password must be at least 8 characters');
  }

  const tokenHash = hashActionToken(rawToken);
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.expires_at, t.used_at
     FROM auth_action_tokens t
     WHERE t.token_hash = $1
       AND t.type = 'password_reset'
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw createHttpError(400, 'Invalid or expired token');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE auth_action_tokens SET used_at = now() WHERE id = $1',
      [row.id]
    );
    await client.query(
      `UPDATE users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1`,
      [row.user_id, passwordHash]
    );
    // Смена пароля через восстановление = все сессии считаются скомпрометированными.
    await client.query(
      `UPDATE user_sessions
       SET revoked_at = now(), revoked_reason = 'password_reset'
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [row.user_id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * T3.5: выход — отзыв текущей сессии на сервере.
 */
async function logout(auth) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!auth.sessionId) {
    return { revokedCount: 0 };
  }

  const result = await pool.query(
    `UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'user_logout'
     WHERE user_id = $1
       AND id = $2
       AND revoked_at IS NULL`,
    [auth.userId, auth.sessionId]
  );

  return { revokedCount: result.rowCount };
}

/**
 * Текущий пользователь по токену (нужно OAuth-коллбэку и обновлению плашки).
 */
async function getMe(auth) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const result = await pool.query(
    `SELECT id, email, display_name, role, language, account_status, bio, avatar_url, email_confirmed_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [auth.userId]
  );

  const user = result.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return mapUser(user);
}

module.exports = {
  registerUser,
  loginUser,
  createSessionForUser,
  confirmEmail,
  resendConfirmation,
  forgotPassword,
  resetPassword,
  logout,
  getMe,
  mapUser,
  SALT_ROUNDS
};
