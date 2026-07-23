const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middleware/auth.middleware');
const tabletopController = require('./tabletop.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const tabletopRouter = express.Router();

/* legacy rooms */
tabletopRouter.post('/tabletop/rooms', requireAuth, tabletopController.createRoom);
tabletopRouter.get('/tabletop/rooms/:id', requireAuth, tabletopController.getRoom);
tabletopRouter.patch('/tabletop/rooms/:id/state', requireAuth, tabletopController.patchRoomState);

/* game-scoped VTT */
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
