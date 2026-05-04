const jwt = require('jsonwebtoken');
const env = require('../config/env');
const pool = require('../db/pool');

function unauthorized(res) {
  return res.status(401).json({
    ok: false,
    message: 'Unauthorized'
  });
}

async function resolveSession(payload) {
  const sessionId = typeof payload?.sid === 'string' ? payload.sid : null;
  const tokenId = typeof payload?.tid === 'string' ? payload.tid : null;

  if (!sessionId || !tokenId) {
    return null;
  }

  const result = await pool.query(
    `SELECT id, revoked_at
     FROM user_sessions
     WHERE id = $1
       AND user_id = $2
       AND token_id = $3
     LIMIT 1`,
    [sessionId, payload.sub, tokenId]
  );

  const session = result.rows[0];
  if (!session || session.revoked_at) {
    return false;
  }

  await pool.query(
    `UPDATE user_sessions
     SET last_seen_at = now()
     WHERE id = $1`,
    [session.id]
  );

  return session.id;
}

async function requireAuth(req, res, next) {
  const authorizationHeader = req.get('Authorization');

  if (!authorizationHeader) {
    return unauthorized(res);
  }

  const parts = authorizationHeader.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    return unauthorized(res);
  }

  if (!env.jwtAccessSecret) {
    return res.status(500).json({
      ok: false,
      message: 'JWT access secret is not configured'
    });
  }

  try {
    const payload = jwt.verify(parts[1], env.jwtAccessSecret);
    const sessionState = await resolveSession(payload);
    if (sessionState === false) {
      return unauthorized(res);
    }

    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      accountStatus: payload.accountStatus || 'active',
      sessionId: sessionState
    };

    return next();
  } catch (error) {
    return unauthorized(res);
  }
}

function optionalAuth(req, res, next) {
  const authorizationHeader = req.get('Authorization');
  if (!authorizationHeader) {
    return next();
  }

  const parts = authorizationHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1] || !env.jwtAccessSecret) {
    return next();
  }

  try {
    const payload = jwt.verify(parts[1], env.jwtAccessSecret);
    req.auth = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      accountStatus: payload.accountStatus || 'active'
    };
  } catch (error) {
    // Ignore invalid token in optional mode.
  }

  return next();
}

module.exports = {
  requireAuth,
  optionalAuth
};
