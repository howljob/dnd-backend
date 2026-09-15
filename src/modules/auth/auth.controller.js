const authService = require('./auth.service');

const KNOWN_STATUS_CODES = [400, 401, 403, 404, 409, 429, 500];

function sendError(res, error) {
  if (KNOWN_STATUS_CODES.includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message,
      ...(error.code ? { code: error.code } : {})
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function register(req, res) {
  try {
    const user = await authService.registerUser(req.body);

    return res.status(201).json({
      ok: true,
      user
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function login(req, res) {
  try {
    const result = await authService.loginUser(req.body, {
      userAgent: req.get('user-agent') || '',
      ipAddress: req.ip || req.socket?.remoteAddress || ''
    });

    return res.status(200).json({
      ok: true,
      token: result.token,
      user: result.user,
      session: result.session
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function confirmEmail(req, res) {
  try {
    const result = await authService.confirmEmail(req.body?.token);

    return res.status(200).json({
      ok: true,
      user: result.user
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function resendConfirmation(req, res) {
  try {
    const result = await authService.resendConfirmation(req.auth);

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function forgotPassword(req, res) {
  try {
    await authService.forgotPassword(req.body);
  } catch (error) {
    if (error.statusCode !== 400) {
      // Не раскрываем ничего: логируем и всё равно отвечаем 200.
      console.error('[auth] forgot-password error:', error);
    } else {
      return sendError(res, error);
    }
  }

  // Ответ всегда одинаковый — существование email не раскрывается.
  return res.status(200).json({ ok: true });
}

async function resetPassword(req, res) {
  try {
    await authService.resetPassword(req.body);

    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}

async function logout(req, res) {
  try {
    await authService.logout(req.auth);

    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
}

async function me(req, res) {
  try {
    const user = await authService.getMe(req.auth);

    return res.status(200).json({
      ok: true,
      user
    });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = {
  register,
  login,
  confirmEmail,
  resendConfirmation,
  forgotPassword,
  resetPassword,
  logout,
  me
};
