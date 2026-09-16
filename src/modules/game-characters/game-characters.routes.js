const express = require('express');
const { requireAuth } = require('../../middleware/auth.middleware');
const gameCharactersController = require('./game-characters.controller');

const gameCharactersRouter = express.Router();

/* T5.4 — копия персонажа на столе (шаблон живёт в /api/profile/characters). */
gameCharactersRouter.post(
  '/games/:gameId/characters/:characterId/link',
  requireAuth,
  gameCharactersController.linkCharacterToGame
);
gameCharactersRouter.get(
  '/games/:gameId/my-character',
  requireAuth,
  gameCharactersController.getMyGameCharacter
);
gameCharactersRouter.patch(
  '/games/:gameId/my-character',
  requireAuth,
  gameCharactersController.patchMyGameCharacter
);
gameCharactersRouter.post(
  '/games/:gameId/my-character/sync-to-template',
  requireAuth,
  gameCharactersController.syncMyGameCharacterToTemplate
);

module.exports = gameCharactersRouter;
