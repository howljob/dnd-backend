const profileService = require('./profile.service');

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

async function getPersonalGames(req, res) {
  try {
    const items = await profileService.getPersonalGames(req.auth);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateMyProfile(req, res) {
  try {
    const user = await profileService.updateMyProfile(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      user
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getGameActivity(req, res) {
  try {
    const items = await profileService.getGameActivity(req.auth, req.query);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listCharacters(req, res) {
  try {
    const items = await profileService.listCharacters(req.auth);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createCharacter(req, res) {
  try {
    const character = await profileService.createCharacter(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      character
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateCharacter(req, res) {
  try {
    const character = await profileService.updateCharacter(req.auth, req.params.id, req.body);
    return res.status(200).json({
      ok: true,
      character
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getRating(req, res) {
  try {
    const rating = await profileService.getRating(req.auth);
    return res.status(200).json({
      ok: true,
      rating
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listSecuritySessions(req, res) {
  try {
    const sessions = await profileService.listSecuritySessions(req.auth);
    return res.status(200).json({
      ok: true,
      sessions
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function changePassword(req, res) {
  try {
    const result = await profileService.changePassword(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function signOutAllSessions(req, res) {
  try {
    const result = await profileService.signOutAllSessions(req.auth);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function revokeSingleSession(req, res) {
  try {
    const result = await profileService.revokeSingleSession(req.auth, req.params.id);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function submitRating(req, res) {
  try {
    const result = await profileService.submitRating(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function syncAchievementProgress(req, res) {
  try {
    const result = await profileService.syncAchievementProgress(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  updateMyProfile,
  getPersonalGames,
  getGameActivity,
  listCharacters,
  createCharacter,
  updateCharacter,
  getRating,
  listSecuritySessions,
  changePassword,
  signOutAllSessions,
  revokeSingleSession,
  submitRating,
  syncAchievementProgress
};
