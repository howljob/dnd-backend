const express = require('express');
const adminUsersController = require('./admin-users.controller');
const { requireAuth } = require('../../middleware/auth.middleware');
const {
  requireAdmin,
  requireAdminOrModerator
} = require('../../middleware/roles.middleware');

const adminUsersRouter = express.Router();

adminUsersRouter.get('/users', requireAuth, requireAdminOrModerator, adminUsersController.listUsers);
adminUsersRouter.patch('/users/:id/status', requireAuth, requireAdmin, adminUsersController.updateUserAccountStatus);
adminUsersRouter.delete('/users/:id', requireAuth, requireAdmin, adminUsersController.deleteUser);

module.exports = adminUsersRouter;
