function requireRole(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        ok: false,
        message: 'Forbidden'
      });
    }

    return next();
  };
}

function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

function requireAdminOrModerator(req, res, next) {
  return requireRole('admin', 'moderator')(req, res, next);
}

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrModerator
};
