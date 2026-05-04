const authService = require('./auth.service');

async function register(req, res) {
  try {
    const user = await authService.registerUser(req.body);

    return res.status(201).json({
      ok: true,
      user
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        ok: false,
        message: error.message
      });
    }

    if (error.statusCode === 409) {
      return res.status(409).json({
        ok: false,
        message: error.message
      });
    }

    console.error(error);

    return res.status(500).json({
      ok: false,
      message: 'Internal server error'
    });
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
    if (error.statusCode === 400) {
      return res.status(400).json({
        ok: false,
        message: error.message
      });
    }

    if (error.statusCode === 401) {
      return res.status(401).json({
        ok: false,
        message: error.message
      });
    }

    if (error.statusCode === 403) {
      return res.status(403).json({
        ok: false,
        message: error.message
      });
    }

    if (error.statusCode === 500) {
      return res.status(500).json({
        ok: false,
        message: error.message
      });
    }

    console.error(error);

    return res.status(500).json({
      ok: false,
      message: 'Internal server error'
    });
  }
}

module.exports = {
  register,
  login
};
