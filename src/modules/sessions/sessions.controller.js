const sessionsService = require('./sessions.service');

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

async function createSession(req, res) {
  try {
    const session = await sessionsService.createSession(req.auth, req.params.id, req.body);
    return res.status(201).json({
      ok: true,
      session
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateSession(req, res) {
  try {
    const session = await sessionsService.updateSession(req.auth, req.params.id, req.body);
    return res.status(200).json({
      ok: true,
      session
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function startSession(req, res) {
  try {
    const session = await sessionsService.transitionSession(req.auth, req.params.id, 'start');
    return res.status(200).json({
      ok: true,
      session
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function finishSession(req, res) {
  try {
    const session = await sessionsService.transitionSession(req.auth, req.params.id, 'finish');
    return res.status(200).json({
      ok: true,
      session
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listGameSessions(req, res) {
  try {
    const sessions = await sessionsService.listSessionsByGameId(req.params.id);
    return res.status(200).json({
      ok: true,
      items: sessions
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listUpcomingSessions(req, res) {
  try {
    const sessions = await sessionsService.listUpcomingSessions(req.query);
    return res.status(200).json({
      ok: true,
      items: sessions
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createSession,
  updateSession,
  startSession,
  finishSession,
  listGameSessions,
  listUpcomingSessions
};
