const express = require('express');
const adminMembershipsController = require('./admin-memberships.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const { requireAdminOrModerator } = require('../../middleware/roles.middleware');

const adminMembershipsRouter = express.Router();

adminMembershipsRouter.get('/memberships', requireAuth, requireAdminOrModerator, adminMembershipsController.listMemberships);
adminMembershipsRouter.patch('/memberships/:id/status', requireAuth, requireAdminOrModerator, adminMembershipsController.updateMembershipStatus);

module.exports = adminMembershipsRouter;
