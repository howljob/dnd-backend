const membershipsService = require('./memberships.service');

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

  if (error.statusCode === 409) {
    return res.status(409).json({
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

async function listMemberships(req, res) {
  try {
    const result = await membershipsService.listMembershipsByGameId(req.params.id);

    return res.status(200).json({
      ok: true,
      items: result.items,
      summary: result.summary
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function joinGame(req, res) {
  try {
    const membership = await membershipsService.joinGame(req.auth, req.params.id, req.body);

    return res.status(201).json({
      ok: true,
      membership
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function approveMembership(req, res) {
  try {
    const membership = await membershipsService.approveMembership(req.auth, req.params.id);

    return res.status(200).json({
      ok: true,
      membership
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function rejectMembership(req, res) {
  try {
    const membership = await membershipsService.rejectMembership(req.auth, req.params.id);

    return res.status(200).json({
      ok: true,
      membership
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function cancelMembership(req, res) {
  try {
    const membership = await membershipsService.cancelMembership(req.auth, req.params.id);

    return res.status(200).json({
      ok: true,
      membership
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listMemberships,
  joinGame,
  approveMembership,
  rejectMembership,
  cancelMembership
};
