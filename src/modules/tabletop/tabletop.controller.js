const tabletopService = require('./tabletop.service');
const { notifyTabletopGame } = require('./tabletop.ws');

function handleError(res, error) {
  if ([400, 401, 403, 404, 409].includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
  }

  // eslint-disable-next-line no-console
  console.error(error);
  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function createRoom(req, res) {
  try {
    const room = await tabletopService.createRoom(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      room
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getRoom(req, res) {
  try {
    const room = await tabletopService.getRoom(req.auth, req.params.id);
    return res.status(200).json({
      ok: true,
      room
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function patchRoomState(req, res) {
  try {
    const room = await tabletopService.patchRoomState(req.auth, req.params.id, req.body);
    return res.status(200).json({
      ok: true,
      room
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getGameBundle(req, res) {
  try {
    const data = await tabletopService.getTabletopBundle(req.auth, req.params.gameId);
    return res.status(200).json({
      ok: true,
      data
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function postScene(req, res) {
  try {
    const scene = await tabletopService.createScene(req.auth, req.params.gameId, req.body);
    await notifyTabletopGame(req.params.gameId);
    return res.status(201).json({
      ok: true,
      scene
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function patchScene(req, res) {
  try {
    const scene = await tabletopService.patchSceneState(
      req.auth,
      req.params.gameId,
      req.params.sceneId,
      req.body
    );
    await notifyTabletopGame(req.params.gameId);
    return res.status(200).json({
      ok: true,
      scene
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function publishScene(req, res) {
  try {
    const scene = await tabletopService.publishScene(
      req.auth,
      req.params.gameId,
      req.params.sceneId
    );
    await notifyTabletopGame(req.params.gameId);
    return res.status(200).json({
      ok: true,
      scene
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function setActiveScene(req, res) {
  try {
    const scene = await tabletopService.setActiveScene(
      req.auth,
      req.params.gameId,
      req.params.sceneId
    );
    await notifyTabletopGame(req.params.gameId);
    return res.status(200).json({
      ok: true,
      scene
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function uploadMap(req, res) {
  try {
    const file = req.file;
    const result = await tabletopService.saveUploadedMap(
      req.auth,
      req.params.gameId,
      file
        ? {
          buffer: file.buffer,
          mimetype: file.mimetype,
          size: file.size
        }
        : null
    );
    return res.status(201).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listGameCharacters(req, res) {
  try {
    const items = await tabletopService.listGameCharacters(req.auth, req.params.gameId);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function addGameCharacter(req, res) {
  try {
    const row = await tabletopService.addGameCharacter(req.auth, req.params.gameId, req.body);
    return res.status(201).json({
      ok: true,
      link: row
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function removeGameCharacter(req, res) {
  try {
    const result = await tabletopService.removeGameCharacter(
      req.auth,
      req.params.gameId,
      req.params.linkId
    );
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createRoom,
  getRoom,
  patchRoomState,
  getGameBundle,
  postScene,
  patchScene,
  publishScene,
  setActiveScene,
  uploadMap,
  listGameCharacters,
  addGameCharacter,
  removeGameCharacter
};
