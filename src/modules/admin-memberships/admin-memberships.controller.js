const adminMembershipsService = require('./admin-memberships.service');

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

async function listMemberships(req, res) {
  try {
    const items = await adminMembershipsService.listMemberships(req.query);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateMembershipStatus(req, res) {
  try {
    const membership = await adminMembershipsService.updateMembershipStatus(
      req.auth,
      req.params.id,
      req.body?.status
    );

    return res.status(200).json({
      ok: true,
      membership
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listMemberships,
  updateMembershipStatus
};
