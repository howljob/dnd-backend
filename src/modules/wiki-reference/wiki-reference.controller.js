const wikiReferenceService = require('./wiki-reference.service');

function handleError(res, error) {
  if ([400, 401, 403, 404].includes(error.statusCode)) {
    return res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
  }

  // eslint-disable-next-line no-console
  console.error(error);
  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function listEntities(req, res) {
  try {
    const data = await wikiReferenceService.listReferenceEntities(req.params.section, req.query);
    return res.status(200).json({
      ok: true,
      ...data
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getEntity(req, res) {
  try {
    const item = await wikiReferenceService.getReferenceEntity(req.params.section, req.params.idOrSlug);
    return res.status(200).json({
      ok: true,
      item
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getFilters(req, res) {
  try {
    const data = await wikiReferenceService.getReferenceFilters(req.params.section);
    return res.status(200).json({
      ok: true,
      ...data
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listEntities,
  getEntity,
  getFilters
};
