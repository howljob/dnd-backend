const express = require('express');
const sessionsController = require('./sessions.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

// Маршруты под /api/games/:id/sessions
const gameSessionsRouter = express.Router();

gameSessionsRouter.get('/:id/sessions', sessionsController.listGameSessions);
gameSessionsRouter.post('/:id/sessions', requireAuth, sessionsController.createSession);

// Маршруты под /api/sessions
const sessionActionsRouter = express.Router();

// ВАЖНО: /upcoming объявлен до /:id, иначе Express примет «upcoming» за id.
sessionActionsRouter.get('/upcoming', sessionsController.listUpcomingSessions);
sessionActionsRouter.patch('/:id', requireAuth, sessionsController.updateSession);
sessionActionsRouter.post('/:id/start', requireAuth, sessionsController.startSession);
sessionActionsRouter.post('/:id/finish', requireAuth, sessionsController.finishSession);
// T8.2: присутствие — читают участники, отмечает мастер после завершения.
sessionActionsRouter.get('/:id/attendance', requireAuth, sessionsController.getSessionAttendance);
sessionActionsRouter.put('/:id/attendance', requireAuth, sessionsController.setSessionAttendance);

module.exports = {
  gameSessionsRouter,
  sessionActionsRouter
};
