const gameCharactersService = require('./game-characters.service');

function handleError(res, error) {
  if ([400, 401, 403, 404, 409].includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function linkCharacterToGame(req, res) {
  try {
    const gameCharacter = await gameCharactersService.linkCharacterToGame(
      req.auth,
      req.params.gameId,
      req.params.characterId
    );
    return res.status(gameCharacter.alreadyLinked ? 200 : 201).json({
      ok: true,
      gameCharacter
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getMyGameCharacter(req, res) {
  try {
    const gameCharacter = await gameCharactersService.getMyGameCharacter(req.auth, req.params.gameId);
    return res.status(200).json({
      ok: true,
      gameCharacter
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function patchMyGameCharacter(req, res) {
  try {
    const gameCharacter = await gameCharactersService.patchMyGameCharacter(
      req.auth,
      req.params.gameId,
      req.body
    );
    return res.status(200).json({
      ok: true,
      gameCharacter
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function syncMyGameCharacterToTemplate(req, res) {
  try {
    const result = await gameCharactersService.syncMyGameCharacterToTemplate(req.auth, req.params.gameId);
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  linkCharacterToGame,
  getMyGameCharacter,
  patchMyGameCharacter,
  syncMyGameCharacterToTemplate
};
