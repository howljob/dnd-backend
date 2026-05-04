const express = require('express');
const wikiController = require('./wiki.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const wikiRouter = express.Router();
const wikiAdminRouter = express.Router();

wikiRouter.get('/entities', wikiController.listEntities);
wikiRouter.get('/entities/:slug', wikiController.getEntityBySlug);

wikiAdminRouter.post('/wiki/entities', requireAuth, requireAdminOrModerator, wikiController.upsertEntity);
wikiAdminRouter.post('/wiki/relations', requireAuth, requireAdminOrModerator, wikiController.upsertRelation);
wikiAdminRouter.post('/wiki/import-srd', requireAuth, requireAdminOrModerator, wikiController.importSrd);

module.exports = {
  wikiRouter,
  wikiAdminRouter
};
