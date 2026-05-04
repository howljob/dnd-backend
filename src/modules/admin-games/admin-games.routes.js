const express = require('express');
const adminGamesController = require('./admin-games.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const adminGamesRouter = express.Router();

adminGamesRouter.get('/games', requireAuth, requireAdminOrModerator, adminGamesController.listGames);
adminGamesRouter.patch('/games/:id/status', requireAuth, requireAdminOrModerator, adminGamesController.updateGameStatus);
adminGamesRouter.delete('/games/:id', requireAuth, requireAdminOrModerator, adminGamesController.hideGame);

module.exports = adminGamesRouter;
