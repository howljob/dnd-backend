const transfersService = require('./transfers.service');

function handleError(res, error) {
  if ([400, 401, 403, 404, 409].includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message,
      ...(error.completableAt ? { completableAt: error.completableAt } : {})
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function createTransferRequest(req, res) {
  try {
    const request = await transfersService.createTransferRequest(req.auth, req.params.id, req.body);
    return res.status(201).json({ ok: true, request });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getPendingTransferRequest(req, res) {
  try {
    const request = await transfersService.getPendingTransferRequest(req.auth, req.params.id);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return handleError(res, error);
  }
}

async function approveTransferRequest(req, res) {
  try {
    const request = await transfersService.approveTransferRequest(req.auth, req.params.id, req.params.requestId);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return handleError(res, error);
  }
}

async function declineTransferRequest(req, res) {
  try {
    const request = await transfersService.declineTransferRequest(req.auth, req.params.id, req.params.requestId);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return handleError(res, error);
  }
}

async function completeTransferRequest(req, res) {
  try {
    const request = await transfersService.completeTransferRequest(req.auth, req.params.id, req.params.requestId);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createTransferRequest,
  getPendingTransferRequest,
  approveTransferRequest,
  declineTransferRequest,
  completeTransferRequest
};
