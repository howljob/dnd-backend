const wikiService = require('./wiki.service');

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

async function listEntities(req, res) {
  try {
    const data = await wikiService.listWikiEntities(req.query);
    return res.status(200).json({
      ok: true,
      ...data
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getEntityBySlug(req, res) {
  try {
    const item = await wikiService.getWikiEntityBySlug(req.params.slug, req.query.locale);
    return res.status(200).json({
      ok: true,
      item
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function upsertEntity(req, res) {
  try {
    const item = await wikiService.upsertWikiEntity(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      item
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function upsertRelation(req, res) {
  try {
    const relation = await wikiService.upsertWikiRelation(req.auth, req.body);
    return res.status(200).json({
      ok: true,
      relation
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function importSrd(req, res) {
  try {
    const result = await wikiService.importSrdSeed(req.auth);
    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listEntities,
  getEntityBySlug,
  upsertEntity,
  upsertRelation,
  importSrd
};
