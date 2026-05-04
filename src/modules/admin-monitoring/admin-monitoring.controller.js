const adminMonitoringService = require('./admin-monitoring.service');

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

async function listAuditLogs(req, res) {
  try {
    const items = await adminMonitoringService.listAuditLogs(req.query);
    return res.status(200).json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getOverviewMetrics(req, res) {
  try {
    const metrics = await adminMonitoringService.getOverviewMetrics();
    return res.status(200).json({ ok: true, metrics });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listAuditLogs,
  getOverviewMetrics
};
