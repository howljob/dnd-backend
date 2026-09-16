const express = require('express');
const reportsController = require('./reports.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const reportsRouter = express.Router();

// T8.3: жалоба участника игры на любого участника той же игры, включая мастера.
reportsRouter.post('/', requireAuth, reportsController.createReport);

module.exports = reportsRouter;
