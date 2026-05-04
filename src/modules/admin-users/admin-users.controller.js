const adminUsersService = require('./admin-users.service');

function handleError(res, error) {
  if (error.statusCode === 400) {
    return res.status(400).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 401) {
    return res.status(401).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 403) {
    return res.status(403).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 404) {
    return res.status(404).json({
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

async function listUsers(req, res) {
  try {
    const items = await adminUsersService.listUsers(req.query);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateUserAccountStatus(req, res) {
  try {
    const user = await adminUsersService.updateUserAccountStatus(
      req.auth,
      req.params.id,
      req.body?.accountStatus
    );

    return res.status(200).json({
      ok: true,
      user
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteUser(req, res) {
  try {
    await adminUsersService.deleteUser(req.auth, req.params.id);
    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listUsers,
  updateUserAccountStatus,
  deleteUser
};
