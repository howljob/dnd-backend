const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { randomBytes } = require('crypto');
const profileController = require('./profile.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireConfirmedEmail } = require('../../middleware/confirmed-email.middleware');
const { MAX_PORTRAIT_BYTES } = require('./portrait-storage');

const portraitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PORTRAIT_BYTES }
});

const profileRouter = express.Router();

// T3.5: загрузка аватара файлом — uploads/avatars, до 2 МБ, только изображения
const AVATARS_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'avatars');
const AVATAR_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const avatarStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdir(AVATARS_DIR, { recursive: true }, (err) => cb(err, AVATARS_DIR));
  },
  filename(req, file, cb) {
    const ext = AVATAR_EXTENSIONS[file.mimetype] || 'png';
    const userPart = String(req.auth?.userId || 'anon').replace(/[^a-z0-9-]/gi, '');
    cb(null, `${userPart}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (AVATAR_EXTENSIONS[file.mimetype]) {
      return cb(null, true);
    }
    const error = new Error('Only image files are allowed');
    error.statusCode = 400;
    return cb(error);
  }
});

// Перехват ошибок multer (размер/тип) в аккуратный JSON вместо 500
function handleAvatarUpload(req, res, next) {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (!error) return next();

    const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
    const isClientError = isTooLarge || error.statusCode === 400;

    if (!isClientError) {
      console.error('[profile] avatar upload failed:', error);
    }

    return res.status(isClientError ? 400 : 500).json({
      ok: false,
      message: isTooLarge ? 'Avatar file is too large (max 2 MB)' : (isClientError ? error.message : 'Internal server error')
    });
  });
}

profileRouter.patch('/me', requireAuth, profileController.updateMyProfile);
profileRouter.post('/me/avatar', requireAuth, handleAvatarUpload, profileController.uploadMyAvatar);
profileRouter.get('/games', requireAuth, profileController.getPersonalGames);
profileRouter.get('/activity', requireAuth, profileController.getGameActivity);
profileRouter.get('/characters', requireAuth, profileController.listCharacters);
profileRouter.post('/characters', requireAuth, profileController.createCharacter);
profileRouter.patch('/characters/:id', requireAuth, profileController.updateCharacter);
profileRouter.delete('/characters/:id', requireAuth, profileController.deleteCharacter);
profileRouter.post(
  '/characters/:id/portrait',
  requireAuth,
  portraitUpload.single('portrait'),
  profileController.uploadCharacterPortrait
);
profileRouter.delete('/characters/:id/portrait', requireAuth, profileController.deleteCharacterPortrait);
profileRouter.get('/rating', requireAuth, profileController.getRating);
// T3.2: ставить оценки может только пользователь с подтверждённой почтой
profileRouter.post('/rating', requireAuth, requireConfirmedEmail, profileController.submitRating);

profileRouter.get('/security/sessions', requireAuth, profileController.listSecuritySessions);
profileRouter.post('/security/change-password', requireAuth, profileController.changePassword);
profileRouter.post('/security/sign-out-all', requireAuth, profileController.signOutAllSessions);
profileRouter.post('/security/sessions/:id/revoke', requireAuth, profileController.revokeSingleSession);

profileRouter.post('/achievements/progress', requireAuth, profileController.syncAchievementProgress);

module.exports = profileRouter;
