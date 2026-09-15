const pool = require('../db/pool');

/**
 * T3.2: действие доступно только пользователям с подтверждённой почтой.
 * Ставится ПОСЛЕ requireAuth. Проверяет состояние в базе (не из JWT),
 * чтобы подтверждение действовало сразу, без перевыпуска токена.
 */
async function requireConfirmedEmail(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({
      ok: false,
      message: 'Unauthorized'
    });
  }

  try {
    const result = await pool.query(
      'SELECT email_confirmed_at FROM users WHERE id = $1 LIMIT 1',
      [req.auth.userId]
    );

    const row = result.rows[0];
    if (!row || !row.email_confirmed_at) {
      return res.status(403).json({
        ok: false,
        code: 'EMAIL_NOT_CONFIRMED',
        message: 'Email is not confirmed'
      });
    }

    return next();
  } catch (error) {
    console.error('[auth] requireConfirmedEmail failed:', error);
    return res.status(500).json({
      ok: false,
      message: 'Internal server error'
    });
  }
}

module.exports = {
  requireConfirmedEmail
};
