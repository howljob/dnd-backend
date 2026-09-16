const express = require('express');
const transfersController = require('./transfers.controller');
const { requireAuth } = require('../../middleware/auth.middleware');

// T8.4: передача брошенной игры по запросу группы. Монтируется на /api/games.
const gameTransfersRouter = express.Router();

gameTransfersRouter.post('/:id/transfer-request', requireAuth, transfersController.createTransferRequest);
gameTransfersRouter.get('/:id/transfer-request', requireAuth, transfersController.getPendingTransferRequest);
gameTransfersRouter.patch('/:id/transfer-request/:requestId/approve', requireAuth, transfersController.approveTransferRequest);
gameTransfersRouter.patch('/:id/transfer-request/:requestId/decline', requireAuth, transfersController.declineTransferRequest);
gameTransfersRouter.post('/:id/transfer-request/:requestId/complete', requireAuth, transfersController.completeTransferRequest);

module.exports = gameTransfersRouter;
