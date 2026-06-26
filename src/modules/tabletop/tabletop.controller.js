const tabletopService = require('./tabletop.service');
const { broadcastGameBundle } = require('./tabletop.ws');

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

async function getBundle(req, res) {
  try {
    const data = await tabletopService.getBundle(req.auth, req.params.gameId);
    return res.status(200).json({ data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createScene(req, res) {
  try {
    const scene = await tabletopService.createScene(req.auth, req.params.gameId, req.body);
    await broadcastGameBundle(req.params.gameId);
    return res.status(201).json({ data: { scene } });
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
    await broadcastGameBundle(req.params.gameId);
    return res.status(200).json({ data: { scene } });
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
    await broadcastGameBundle(req.params.gameId);
    return res.status(200).json({ data: { scene } });
  } catch (error) {
    return handleError(res, error);
  }
}

async function patchScene(req, res) {
  try {
    const scene = await tabletopService.patchScene(
      req.auth,
      req.params.gameId,
      req.params.sceneId,
      req.body
    );
    await broadcastGameBundle(req.params.gameId);
    return res.status(200).json({ data: { scene } });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  getBundle,
  createScene,
  setActiveScene,
  publishScene,
  patchScene
};
