const express = require('express');
const authController = require('./auth.controller');
const oauthController = require('./auth.oauth.controller');
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

// T3.4 — вход через Google / VK ID (включается ключами в .env, см. docs/oauth-setup.md)
router.get('/providers', oauthController.listProviders);
router.get('/oauth/:provider', oauthController.startOAuth);
router.get('/oauth/:provider/callback', oauthController.oauthCallback);

module.exports = router;
