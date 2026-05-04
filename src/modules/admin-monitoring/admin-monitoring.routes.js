const express = require('express');
const adminMonitoringController = require('./admin-monitoring.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const adminMonitoringRouter = express.Router();

adminMonitoringRouter.get('/logs', requireAuth, requireAdminOrModerator, adminMonitoringController.listAuditLogs);
adminMonitoringRouter.get('/metrics/overview', requireAuth, requireAdminOrModerator, adminMonitoringController.getOverviewMetrics);

module.exports = adminMonitoringRouter;
