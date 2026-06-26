const pool = require('../../db/pool');
const {
  createDefaultState,
  createHttpError,
  normalizeSceneName,
  normalizeSceneState,
  normalizePatchTarget,
  normalizeBaseVersion,
  applyScenePatch,
  redactStateForPlayer
} = require('./tabletop.validation');
const {
  isUuid,
  getTabletopMembership,
  requireTabletopGm
} = require('./tabletop.permissions');

const DEFAULT_SCENE_NAME = 'Default Scene';

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapSceneRow(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    isActive: row.is_active,
    version: Number(row.version),
    draftState: normalizeSceneState(row.draft_state),
    publishedState: normalizeSceneState(row.published_state),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSceneForRole(scene, membership) {
  const baseScene = {
    id: scene.id,
    name: scene.name,
    isActive: scene.isActive,
    version: scene.version
  };

  if (membership.isGm) {
    return {
      ...baseScene,
      draftState: scene.draftState,
      publishedState: scene.publishedState
    };
  }

  return {
    ...baseScene,
    publishedState: redactStateForPlayer(scene.publishedState)
  };
}

function buildBundle(gameId, membership, scenes) {
  const visibleScenes = membership.isGm
    ? scenes
    : scenes.filter((scene) => scene.isActive);

  return {
    gameId,
    isGm: membership.isGm,
    role: membership.role,
    scenes: visibleScenes.map((scene) => mapSceneForRole(scene, membership))
  };
}

async function getSceneRows(gameId, db = pool) {
  const result = await db.query(
    `SELECT
       id,
       game_id,
       name,
       is_active,
       draft_state,
       published_state,
       version,
       created_at,
       updated_at
     FROM tabletop_scenes
     WHERE game_id = $1
     ORDER BY is_active DESC, created_at ASC`,
    [gameId]
  );

  return result.rows;
}

async function insertScene(db, gameId, userId, name, isActive) {
  const defaultState = createDefaultState();
  const result = await db.query(
    `INSERT INTO tabletop_scenes (
       game_id,
       name,
       is_active,
       draft_state,
       published_state,
       created_by,
       updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING
       id,
       game_id,
       name,
       is_active,
       draft_state,
       published_state,
       version,
       created_at,
       updated_at`,
    [gameId, name, isActive, defaultState, defaultState, userId]
  );

  return mapSceneRow(result.rows[0]);
}

async function initializeDefaultScene(auth, gameId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tabletop:${gameId}`]);

    await requireTabletopGm(auth, gameId, client);
    const existingRows = await getSceneRows(gameId, client);
    if (existingRows.length > 0) {
      await client.query('COMMIT');
      return existingRows.map(mapSceneRow);
    }

    const scene = await insertScene(client, gameId, auth.userId, DEFAULT_SCENE_NAME, true);
    await client.query('COMMIT');
    return [scene];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getBundle(auth, gameId, options = {}) {
  const createDefaultForGm = options.createDefaultForGm !== false;
  const membership = await getTabletopMembership(auth, gameId);
  let scenes = (await getSceneRows(gameId)).map(mapSceneRow);

  if (scenes.length === 0 && membership.isGm && createDefaultForGm) {
    scenes = await initializeDefaultScene(auth, gameId);
  }

  return buildBundle(gameId, membership, scenes);
}

async function createScene(auth, gameId, data) {
  const name = normalizeSceneName(data?.name);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const membership = await requireTabletopGm(auth, gameId, client);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tabletop:${membership.gameId}`]);
    const existingRows = await getSceneRows(membership.gameId, client);
    const scene = await insertScene(
      client,
      membership.gameId,
      auth.userId,
      name,
      existingRows.length === 0
    );

    await client.query('COMMIT');
    return scene;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getSceneForUpdate(db, gameId, sceneId) {
  if (!isUuid(sceneId)) {
    throw createHttpError(400, 'Invalid scene id');
  }

  const result = await db.query(
    `SELECT
       id,
       game_id,
       name,
       is_active,
       draft_state,
       published_state,
       version,
       created_at,
       updated_at
     FROM tabletop_scenes
     WHERE id = $1
       AND game_id = $2
     FOR UPDATE`,
    [sceneId, gameId]
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Scene not found');
  }

  return row;
}

async function setActiveScene(auth, gameId, sceneId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const membership = await requireTabletopGm(auth, gameId, client);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tabletop:${membership.gameId}`]);
    await getSceneForUpdate(client, membership.gameId, sceneId);

    await client.query(
      `UPDATE tabletop_scenes
       SET is_active = false,
           updated_by = $2,
           updated_at = now()
       WHERE game_id = $1
         AND is_active = true`,
      [membership.gameId, auth.userId]
    );

    const result = await client.query(
      `UPDATE tabletop_scenes
       SET is_active = true,
           updated_by = $3,
           updated_at = now()
       WHERE id = $1
         AND game_id = $2
       RETURNING
         id,
         game_id,
         name,
         is_active,
         draft_state,
         published_state,
         version,
         created_at,
         updated_at`,
      [sceneId, membership.gameId, auth.userId]
    );

    await client.query('COMMIT');
    return mapSceneRow(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishScene(auth, gameId, sceneId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const membership = await requireTabletopGm(auth, gameId, client);
    await getSceneForUpdate(client, membership.gameId, sceneId);

    const result = await client.query(
      `UPDATE tabletop_scenes
       SET published_state = draft_state,
           version = version + 1,
           updated_by = $3,
           updated_at = now()
       WHERE id = $1
         AND game_id = $2
       RETURNING
         id,
         game_id,
         name,
         is_active,
         draft_state,
         published_state,
         version,
         created_at,
         updated_at`,
      [sceneId, membership.gameId, auth.userId]
    );

    await client.query('COMMIT');
    return mapSceneRow(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function patchScene(auth, gameId, sceneId, data) {
  normalizePatchTarget(data?.target);
  const baseVersion = normalizeBaseVersion(data?.baseVersion);
  const patch = data?.patch;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const membership = await requireTabletopGm(auth, gameId, client);
    const sceneRow = await getSceneForUpdate(client, membership.gameId, sceneId);
    const currentVersion = Number(sceneRow.version);

    if (currentVersion !== baseVersion) {
      throw createHttpError(409, 'Stale baseVersion');
    }

    const nextState = applyScenePatch(sceneRow.draft_state, patch);
    const result = await client.query(
      `UPDATE tabletop_scenes
       SET draft_state = $4,
           version = version + 1,
           updated_by = $3,
           updated_at = now()
       WHERE id = $1
         AND game_id = $2
         AND version = $5
       RETURNING
         id,
         game_id,
         name,
         is_active,
         draft_state,
         published_state,
         version,
         created_at,
         updated_at`,
      [sceneId, membership.gameId, auth.userId, nextState, baseVersion]
    );

    if (result.rowCount === 0) {
      throw createHttpError(409, 'Stale baseVersion');
    }

    await client.query('COMMIT');
    return mapSceneRow(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  buildBundle,
  getBundle,
  createScene,
  setActiveScene,
  publishScene,
  patchScene
};
