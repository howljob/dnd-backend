const express = require('express');
const gamesController = require('./games.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const gameTypesRouter = express.Router();
const gamesRouter = express.Router();

gameTypesRouter.get('/', gamesController.listGameTypes);

gamesRouter.get('/', gamesController.listGames);
gamesRouter.get('/:id', gamesController.getGame);
gamesRouter.post('/', requireAuth, gamesController.createGame);
gamesRouter.patch('/:id', requireAuth, gamesController.updateGame);

module.exports = {
  gameTypesRouter,
  gamesRouter
};
