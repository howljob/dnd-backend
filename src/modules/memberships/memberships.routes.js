const express = require('express');
const membershipsController = require('./memberships.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

const gameMembershipsRouter = express.Router();
const membershipActionsRouter = express.Router();

gameMembershipsRouter.get('/:id/memberships', membershipsController.listMemberships);
gameMembershipsRouter.post('/:id/join', requireAuth, membershipsController.joinGame);

membershipActionsRouter.patch('/:id/approve', requireAuth, membershipsController.approveMembership);
membershipActionsRouter.patch('/:id/reject', requireAuth, membershipsController.rejectMembership);
membershipActionsRouter.patch('/:id/cancel', requireAuth, membershipsController.cancelMembership);

module.exports = {
  gameMembershipsRouter,
  membershipActionsRouter
};
