const express = require('express');
const profileController = require('./profile.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const profileRouter = express.Router();

profileRouter.patch('/me', requireAuth, profileController.updateMyProfile);
profileRouter.get('/games', requireAuth, profileController.getPersonalGames);
profileRouter.get('/activity', requireAuth, profileController.getGameActivity);
profileRouter.get('/characters', requireAuth, profileController.listCharacters);
profileRouter.post('/characters', requireAuth, profileController.createCharacter);
profileRouter.patch('/characters/:id', requireAuth, profileController.updateCharacter);
profileRouter.get('/rating', requireAuth, profileController.getRating);
profileRouter.post('/rating', requireAuth, profileController.submitRating);

profileRouter.get('/security/sessions', requireAuth, profileController.listSecuritySessions);
profileRouter.post('/security/change-password', requireAuth, profileController.changePassword);
profileRouter.post('/security/sign-out-all', requireAuth, profileController.signOutAllSessions);
profileRouter.post('/security/sessions/:id/revoke', requireAuth, profileController.revokeSingleSession);

profileRouter.post('/achievements/progress', requireAuth, profileController.syncAchievementProgress);

module.exports = profileRouter;
