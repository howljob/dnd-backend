const adminReportsService = require('./admin-reports.service');

function handleError(res, error) {
  if ([400, 401, 403, 404].includes(error.statusCode)) {
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

async function listReports(req, res) {
  try {
    const items = await adminReportsService.listReports(req.query);
    return res.status(200).json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
}

async function resolveReport(req, res) {
  try {
    const report = await adminReportsService.resolveReport(req.auth, req.params.id, 'resolved');
    return res.status(200).json({ ok: true, report });
  } catch (error) {
    return handleError(res, error);
  }
}

async function dismissReport(req, res) {
  try {
    const report = await adminReportsService.resolveReport(req.auth, req.params.id, 'dismissed');
    return res.status(200).json({ ok: true, report });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listReports,
  resolveReport,
  dismissReport
};
