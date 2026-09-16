const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middleware/auth.middleware');
const tabletopController = require('./tabletop.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const tabletopRouter = express.Router();

/* game-scoped VTT (единственная модель стола; legacy «комнаты» удалены в T6.4) */
tabletopRouter.get('/tabletop/games/:gameId', requireAuth, tabletopController.getGameBundle);
tabletopRouter.post('/tabletop/games/:gameId/scenes', requireAuth, tabletopController.postScene);
tabletopRouter.patch(
  '/tabletop/games/:gameId/scenes/:sceneId',
  requireAuth,
  tabletopController.patchScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/publish',
  requireAuth,
  tabletopController.publishScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/active',
  requireAuth,
  tabletopController.setActiveScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/map-upload',
  requireAuth,
  upload.single('map'),
  tabletopController.uploadMap
);
tabletopRouter.get(
  '/tabletop/games/:gameId/events',
  requireAuth,
  tabletopController.listGameEvents
);
tabletopRouter.get(
  '/tabletop/games/:gameId/characters',
  requireAuth,
  tabletopController.listGameCharacters
);
tabletopRouter.post(
  '/tabletop/games/:gameId/characters',
  requireAuth,
  tabletopController.addGameCharacter
);
tabletopRouter.delete(
  '/tabletop/games/:gameId/characters/:linkId',
  requireAuth,
  tabletopController.removeGameCharacter
);

module.exports = tabletopRouter;
