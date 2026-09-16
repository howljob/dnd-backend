const express = require('express');
const adminReportsController = require('./admin-reports.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const adminReportsRouter = express.Router();

// T8.3: разбор жалоб администратором. Фронтовой админки нет — только API.
adminReportsRouter.get('/reports', requireAuth, requireAdminOrModerator, adminReportsController.listReports);
adminReportsRouter.patch('/reports/:id/resolve', requireAuth, requireAdminOrModerator, adminReportsController.resolveReport);
adminReportsRouter.patch('/reports/:id/dismiss', requireAuth, requireAdminOrModerator, adminReportsController.dismissReport);

module.exports = adminReportsRouter;
