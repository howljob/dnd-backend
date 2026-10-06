const express = require('express');
const wikiReferenceController = require('./wiki-reference.controller');

const wikiReferenceRouter = express.Router();

// Поиск по всем разделам сразу: ?q=…&limit=5 (на раздел)
wikiReferenceRouter.get('/wiki/reference/search', wikiReferenceController.searchAll);
wikiReferenceRouter.get('/wiki/reference/:section/entities', wikiReferenceController.listEntities);
wikiReferenceRouter.get('/wiki/reference/:section/filters', wikiReferenceController.getFilters);
wikiReferenceRouter.get('/wiki/reference/:section/entities/:idOrSlug', wikiReferenceController.getEntity);

module.exports = wikiReferenceRouter;
