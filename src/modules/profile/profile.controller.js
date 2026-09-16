const profileService = require('./profile.service');

function handleError(res, error) {
  // 403/409 добавлены в T8.1: запрет оценки вне сессии и повторной оценки.
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

/**
 * T3.5: загрузка аватара файлом (multer уже положил файл в uploads/avatars).
 */
async function uploadMyAvatar(req, res) {
  try {
    const user = await profileService.updateMyAvatarFile(req.auth, req.file);
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

async function deleteCharacter(req, res) {
  try {
    const result = await profileService.deleteCharacter(req.auth, req.params.id);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function uploadCharacterPortrait(req, res) {
  try {
    const character = await profileService.uploadCharacterPortrait(req.auth, req.params.id, req.file);
    return res.status(200).json({
      ok: true,
      character
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteCharacterPortrait(req, res) {
  try {
    const character = await profileService.deleteCharacterPortrait(req.auth, req.params.id);
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

async function getRatingSessionContext(req, res) {
  try {
    const context = await profileService.getRatingSessionContext(req.auth, req.params.sessionId);
    return res.status(200).json({
      ok: true,
      ...context
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
  uploadMyAvatar,
  getPersonalGames,
  getGameActivity,
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  uploadCharacterPortrait,
  deleteCharacterPortrait,
  getRating,
  getRatingSessionContext,
  listSecuritySessions,
  changePassword,
  signOutAllSessions,
  revokeSingleSession,
  submitRating,
  syncAchievementProgress
};
