const express = require('express');
const adminContentController = require('./admin-content.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const adminContentRouter = express.Router();

adminContentRouter.get('/content', requireAuth, requireAdminOrModerator, adminContentController.listContent);
adminContentRouter.put('/content', requireAuth, requireAdminOrModerator, adminContentController.upsertContent);

module.exports = adminContentRouter;
