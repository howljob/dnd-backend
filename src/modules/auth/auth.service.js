const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const pool = require('../../db/pool');
const env = require('../../config/env');

const PUBLIC_REGISTER_ROLE = 'user';
const DEPRECATED_REGISTER_ROLES = ['user', 'player', 'gm'];
const FORBIDDEN_PUBLIC_REGISTER_ROLES = ['admin', 'moderator'];
const SALT_ROUNDS = 10;

function createJwtConfigError() {
  const error = new Error('JWT access secret is not configured');
  error.statusCode = 500;
  return error;
}

async function registerUser(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
  const rawRole = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : '';
  const role = PUBLIC_REGISTER_ROLE;

  if (!email || !password || !displayName) {
    const error = new Error('Invalid registration data');
    error.statusCode = 400;
    throw error;
  }

  if (rawRole && FORBIDDEN_PUBLIC_REGISTER_ROLES.includes(rawRole)) {
    const error = new Error('Invalid role');
    error.statusCode = 400;
    throw error;
  }

  // Keep accepting legacy player/gm role payload from older clients,
  // but account role is always system-level "user" for public signups.
  if (rawRole && !DEPRECATED_REGISTER_ROLES.includes(rawRole)) {
    const error = new Error('Invalid role');
    error.statusCode = 400;
    throw error;
  }

  const existingUserResult = await pool.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (existingUserResult.rows.length > 0) {
    const error = new Error('User already exists');
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

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
      RETURNING id, email, display_name, role, language, account_status, bio, avatar_url`,
      [email, passwordHash, role, displayName]
    );

    const user = result.rows[0];

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      language: user.language,
      accountStatus: user.account_status,
      bio: user.bio || '',
      avatar: user.avatar_url || null
    };
  } catch (error) {
    if (error.code === '23505') {
      const conflictError = new Error('User already exists');
      conflictError.statusCode = 409;
      throw conflictError;
    }

    throw error;
  }
}

async function loginUser(data, meta = {}) {
  const payload = data && typeof data === 'object' ? data : {};
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!email || !password) {
    const error = new Error('Invalid login data');
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `SELECT id, email, password_hash, display_name, role, language, account_status, bio, avatar_url
    FROM users
    WHERE email = $1
    LIMIT 1`,
    [email]
  );

  const user = result.rows[0];

  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  if (user.account_status !== 'active') {
    const error = new Error('Account is not active');
    error.statusCode = 403;
    throw error;
  }

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
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      language: user.language,
      accountStatus: user.account_status,
      bio: user.bio || '',
      avatar: user.avatar_url || null
    },
    session: {
      id: session.id,
      tokenId: session.token_id,
      createdAt: session.created_at instanceof Date ? session.created_at.toISOString() : session.created_at
    }
  };
}

module.exports = {
  registerUser,
  loginUser
};
