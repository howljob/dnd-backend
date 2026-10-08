const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middleware/auth.middleware');
const tabletopController = require('./tabletop.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});
// Библиотека принимает и музыку (до 20 МБ); точный предел по виду файла проверяет сервис.
const uploadLibrary = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Ошибки multer (слишком большой файл и т. п.) — понятный JSON, а не HTML-страница 500.
function multerErrorToJson(error, res) {
  const tooLarge = error.code === 'LIMIT_FILE_SIZE';
  return res.status(400).json({
    ok: false,
    code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED',
    message: tooLarge ? 'File too large' : 'Upload failed'
  });
}

function uploadMapFile(req, res, next) {
  upload.single('map')(req, res, (error) => (error ? multerErrorToJson(error, res) : next()));
}

function uploadLibraryFile(req, res, next) {
  uploadLibrary.single('file')(req, res, (error) => (error ? multerErrorToJson(error, res) : next()));
}

const tabletopRouter = express.Router();

/* game-scoped VTT (единственная модель стола; legacy «комнаты» удалены в T6.4) */
tabletopRouter.get('/tabletop/games/:gameId', requireAuth, tabletopController.getGameBundle);
tabletopRouter.post('/tabletop/games/:gameId/scenes', requireAuth, tabletopController.postScene);
tabletopRouter.patch(
  '/tabletop/games/:gameId/scenes/:sceneId',
  requireAuth,
  tabletopController.patchScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/publish',
  requireAuth,
  tabletopController.publishScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/active',
  requireAuth,
  tabletopController.setActiveScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/rename',
  requireAuth,
  tabletopController.renameScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/scenes/:sceneId/duplicate',
  requireAuth,
  tabletopController.duplicateScene
);
tabletopRouter.delete(
  '/tabletop/games/:gameId/scenes/:sceneId',
  requireAuth,
  tabletopController.deleteScene
);
tabletopRouter.post(
  '/tabletop/games/:gameId/map-upload',
  requireAuth,
  uploadMapFile,
  tabletopController.uploadMap
);
tabletopRouter.get(
  '/tabletop/games/:gameId/files',
  requireAuth,
  tabletopController.listGameFiles
);
tabletopRouter.post(
  '/tabletop/games/:gameId/files',
  requireAuth,
  uploadLibraryFile,
  tabletopController.uploadFile
);
tabletopRouter.delete(
  '/tabletop/games/:gameId/files/:fileId',
  requireAuth,
  tabletopController.deleteGameFile
);
tabletopRouter.get(
  '/tabletop/games/:gameId/characters/:characterId/sheet',
  requireAuth,
  tabletopController.getGameCharacterSheet
);
tabletopRouter.get(
  '/tabletop/games/:gameId/events',
  requireAuth,
  tabletopController.listGameEvents
);
tabletopRouter.get(
  '/tabletop/games/:gameId/characters',
  requireAuth,
  tabletopController.listGameCharacters
);
tabletopRouter.post(
  '/tabletop/games/:gameId/characters',
  requireAuth,
  tabletopController.addGameCharacter
);
tabletopRouter.delete(
  '/tabletop/games/:gameId/characters/:linkId',
  requireAuth,
  tabletopController.removeGameCharacter
);

module.exports = tabletopRouter;
