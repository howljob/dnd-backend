const adminGamesService = require('./admin-games.service');

function handleError(res, error) {
  if ([400, 401, 403, 404].includes(error.statusCode)) {
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

async function listGames(req, res) {
  try {
    const items = await adminGamesService.listGames(req.query);
    return res.status(200).json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateGameStatus(req, res) {
  try {
    await adminGamesService.updateGameStatus(req.auth, req.params.id, req.body?.status);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}

async function hideGame(req, res) {
  try {
    await adminGamesService.hideGame(req.auth, req.params.id);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listGames,
  updateGameStatus,
  hideGame
};
