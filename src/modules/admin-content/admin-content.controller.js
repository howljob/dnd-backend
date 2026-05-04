const adminContentService = require('./admin-content.service');

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

async function listContent(req, res) {
  try {
    const items = await adminContentService.listContent(req.query);
    return res.status(200).json({ ok: true, items });
  } catch (error) {
    return handleError(res, error);
  }
}

async function upsertContent(req, res) {
  try {
    const item = await adminContentService.upsertContent(req.auth, req.body);
    return res.status(200).json({ ok: true, item });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listContent,
  upsertContent
};
