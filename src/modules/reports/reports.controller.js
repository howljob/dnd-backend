const reportsService = require('./reports.service');

function handleError(res, error) {
  if ([400, 401, 403, 404, 409].includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function createReport(req, res) {
  try {
    const report = await reportsService.createReport(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      report
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  createReport
};
