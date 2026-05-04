const gamesService = require('./games.service');

function handleError(res, error) {
  if (error.statusCode === 400) {
    return res.status(400).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 401) {
    return res.status(401).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 403) {
    return res.status(403).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 404) {
    return res.status(404).json({
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

async function listGameTypes(req, res) {
  try {
    const gameTypes = await gamesService.getGameTypes();
    return res.status(200).json({
      ok: true,
      items: gameTypes
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listGames(req, res) {
  try {
    const games = await gamesService.listGames();
    return res.status(200).json({
      ok: true,
      items: games
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getGame(req, res) {
  try {
    const game = await gamesService.getGameById(req.params.id);
    return res.status(200).json({
      ok: true,
      game
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createGame(req, res) {
  try {
    const game = await gamesService.createGame(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      game
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateGame(req, res) {
  try {
    const game = await gamesService.updateGame(req.auth, req.params.id, req.body);
    return res.status(200).json({
      ok: true,
      game
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listGameTypes,
  listGames,
  getGame,
  createGame,
  updateGame
};
