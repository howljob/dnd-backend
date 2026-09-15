const express = require('express');
const authController = require('./auth.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

// T3.2 — подтверждение email
router.post('/confirm-email', authController.confirmEmail);
router.post('/resend-confirmation', requireAuth, authController.resendConfirmation);

// T3.3 — восстановление пароля
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
