const express = require('express');
const tabletopController = require('./tabletop.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const tabletopRouter = express.Router();

tabletopRouter.get('/games/:gameId', requireAuth, tabletopController.getBundle);
tabletopRouter.post('/games/:gameId/scenes', requireAuth, tabletopController.createScene);
tabletopRouter.post(
  '/games/:gameId/scenes/:sceneId/active',
  requireAuth,
  tabletopController.setActiveScene
);
tabletopRouter.post(
  '/games/:gameId/scenes/:sceneId/publish',
  requireAuth,
  tabletopController.publishScene
);
tabletopRouter.patch(
  '/games/:gameId/scenes/:sceneId',
  requireAuth,
  tabletopController.patchScene
);

module.exports = tabletopRouter;
