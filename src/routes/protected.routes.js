const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/roles.middleware');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    ok: true,
    auth: req.auth
  });
});

router.get('/staff-only', requireAuth, requireRole('moderator', 'admin'), (req, res) => {
  return res.status(200).json({
    ok: true,
    message: 'Staff access granted'
  });
});

module.exports = router;
