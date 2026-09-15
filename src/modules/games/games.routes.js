const express = require('express');
const gamesController = require('./games.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireConfirmedEmail } = require('../../middleware/confirmed-email.middleware');

const gameTypesRouter = express.Router();
const gamesRouter = express.Router();

gameTypesRouter.get('/', gamesController.listGameTypes);

gamesRouter.get('/', gamesController.listGames);
gamesRouter.get('/:id', gamesController.getGame);
// T3.2: создавать игры может только пользователь с подтверждённой почтой
gamesRouter.post('/', requireAuth, requireConfirmedEmail, gamesController.createGame);
gamesRouter.patch('/:id', requireAuth, gamesController.updateGame);

module.exports = {
  gameTypesRouter,
  gamesRouter
};
