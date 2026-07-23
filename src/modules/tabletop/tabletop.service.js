const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const pool = require('../../db/pool');

const UPLOADS_VTT_DIR = path.join(process.cwd(), 'uploads', 'vtt');
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_MAP_BYTES = 12 * 1024 * 1024;

const DEFAULT_SCENE_STATE = {
  mapUrl: null,
  mapSize: { w: 2400, h: 1600 },
  grid: { enabled: false, cellPx: 70, offsetX: 0, offsetY: 0 },
  tokens: [],
  templates: [],
  measure: { active: false, points: [] },
  initiative: { active: false, round: 1, turnIndex: 0, entries: [] },
  gmNotes: [],
  fog: { revealed: [] }
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireAuthUser(auth) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch;
  }
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    const bv = out[key];
    if (
      pv
      && typeof pv === 'object'
      && !Array.isArray(pv)
      && bv
      && typeof bv === 'object'
      && !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv, pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

function mergeScenePatch(current, patch) {
  if (!patch || typeof patch !== 'object') {
    return normalizeSceneState(current);
  }

  const curTok = Array.isArray(current.tokens) ? current.tokens : [];
  let next = { ...current };

  if (Array.isArray(patch.tokens)) {
    const curIds = new Set(curTok.map((t) => t.id));
    const patchIds = new Set(patch.tokens.map((t) => t && t.id).filter(Boolean));
    const isAdd = patch.tokens.some((t) => t && t.id && !curIds.has(t.id));
    const isRemove = curTok.some((t) => t.id && !patchIds.has(t.id));
    if (isAdd || isRemove) {
      next.tokens = patch.tokens;
    } else {
      const byId = new Map(curTok.map((t) => [t.id, { ...t }]));
      for (const p of patch.tokens) {
        if (p && p.id && byId.has(p.id)) {
          Object.assign(byId.get(p.id), p);
        }
      }
      next.tokens = Array.from(byId.values());
    }
    const { tokens: _t, ...rest } = patch;
    next = deepMerge(next, rest);
  } else {
    next = deepMerge(current, patch);
  }

  return normalizeSceneState(next);
}

function normalizeSceneState(raw) {
  return deepMerge({ ...DEFAULT_SCENE_STATE }, raw && typeof raw === 'object' ? raw : {});
}

function filterPublishedStateForPlayer(state) {
  const normalized = normalizeSceneState(state);
  const out = JSON.parse(JSON.stringify(normalized));
  delete out.gmNotes;
  if (Array.isArray(out.tokens)) {
    out.tokens = out.tokens.filter((t) => !t.hidden && t.visibility !== 'gm');
  }
  if (Array.isArray(out.templates)) {
    out.templates = out.templates.filter((t) => !t.hidden && t.visibility !== 'gm');
  }
  return out;
}

async function getMyMembership(auth, gameId) {
  requireAuthUser(auth);
  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const result = await pool.query(
    `SELECT member_role, status
     FROM game_memberships
     WHERE game_id = $1 AND user_id = $2
     LIMIT 1`,
    [gameId, auth.userId]
  );

  const row = result.rows[0];
  if (!row || row.status !== 'approved') {
    throw createHttpError(403, 'Not an approved member of this game');
  }

  return { isGm: row.member_role === 'gm' };
}

async function assertGameExists(gameId) {
  const result = await pool.query('SELECT id FROM games WHERE id = $1 LIMIT 1', [gameId]);
  if (!result.rows[0]) {
    throw createHttpError(404, 'Game not found');
  }
}

function mapSceneRow(row, { forPlayer, isGm }) {
  const draft = normalizeSceneState(row.draft_state);
  const published = normalizeSceneState(row.published_state);

  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    draftState: isGm ? draft : undefined,
    publishedState: forPlayer ? filterPublishedStateForPlayer(published) : published,
    publishedStateGmView: isGm ? published : undefined
  };
}

async function ensureDefaultScene(gameId) {
  const cnt = await pool.query(
    'SELECT COUNT(*)::int AS c FROM tabletop_scenes WHERE game_id = $1',
    [gameId]
  );
  if (Number(cnt.rows[0].c) > 0) {
    return;
  }

  const payload = JSON.stringify(DEFAULT_SCENE_STATE);
  await pool.query(
    `INSERT INTO tabletop_scenes (game_id, name, sort_order, is_active, draft_state, published_state)
     VALUES ($1, 'Main', 0, true, $2::jsonb, $2::jsonb)`,
    [gameId, payload]
  );
}

async function ensureTabletopRoom(gameId) {
  const existing = await pool.query(
    'SELECT id FROM tabletop_rooms WHERE game_id = $1 LIMIT 1',
    [gameId]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const gm = await pool.query(
    `SELECT user_id
     FROM game_memberships
     WHERE game_id = $1 AND member_role = 'gm' AND status = 'approved'
     ORDER BY created_at ASC
     LIMIT 1`,
    [gameId]
  );
  const ownerId = gm.rows[0]?.user_id;
  if (!ownerId) {
    throw createHttpError(400, 'Game has no approved GM');
  }

  const ins = await pool.query(
    `INSERT INTO tabletop_rooms (owner_user_id, game_id, name, player_user_ids, state)
     VALUES ($1, $2, 'VTT', '{}'::uuid[], '{}'::jsonb)
     RETURNING id`,
    [ownerId, gameId]
  );

  return ins.rows[0].id;
}

async function getTabletopBundle(auth, gameId) {
  await assertGameExists(gameId);
  const { isGm } = await getMyMembership(auth, gameId);
  await ensureTabletopRoom(gameId);
  await ensureDefaultScene(gameId);

  const scenesResult = await pool.query(
    `SELECT id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at
     FROM tabletop_scenes
     WHERE game_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [gameId]
  );

  const scenes = scenesResult.rows.map((row) => mapSceneRow(row, { forPlayer: !isGm, isGm }));

  const active = scenes.find((s) => s.isActive) || scenes[0] || null;

  return {
    gameId,
    isGm,
    editorMode: isGm,
    scenes,
    activeSceneId: active?.id || null
  };
}

async function createScene(auth, gameId, data) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can create scenes');
  }

  const payload = data && typeof data === 'object' ? data : {};
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 180) : 'Scene';
  const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0;

  const stateJson = JSON.stringify(DEFAULT_SCENE_STATE);
  const result = await pool.query(
    `INSERT INTO tabletop_scenes (game_id, name, sort_order, is_active, draft_state, published_state)
     VALUES ($1, $2, $3, false, $4::jsonb, $4::jsonb)
     RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
    [gameId, name || 'Scene', sortOrder, stateJson]
  );

  return mapSceneRow(result.rows[0], { forPlayer: false, isGm: true });
}

async function setActiveScene(auth, gameId, sceneId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can change active scene');
  }
  if (!isUuid(sceneId)) {
    throw createHttpError(400, 'Invalid scene id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE tabletop_scenes SET is_active = false, updated_at = now() WHERE game_id = $1',
      [gameId]
    );
    const upd = await client.query(
      `UPDATE tabletop_scenes
       SET is_active = true, updated_at = now()
       WHERE game_id = $1 AND id = $2
       RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
      [gameId, sceneId]
    );
    if (!upd.rows[0]) {
      throw createHttpError(404, 'Scene not found');
    }
    await client.query('COMMIT');
    return mapSceneRow(upd.rows[0], { forPlayer: false, isGm: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function patchSceneState(auth, gameId, sceneId, body) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isUuid(sceneId)) {
    throw createHttpError(400, 'Invalid scene id');
  }

  const payload = body && typeof body === 'object' ? body : {};
  const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : null;
  if (!patch) {
    throw createHttpError(400, 'patch object required');
  }

  const target = payload.target === 'published' ? 'published' : 'draft';

  const sceneRes = await pool.query(
    `SELECT id, draft_state, published_state
     FROM tabletop_scenes
     WHERE game_id = $1 AND id = $2
     LIMIT 1`,
    [gameId, sceneId]
  );
  const scene = sceneRes.rows[0];
  if (!scene) {
    throw createHttpError(404, 'Scene not found');
  }

  if (!isGm) {
    if (target === 'draft') {
      throw createHttpError(403, 'Players cannot edit draft');
    }
    const cur = normalizeSceneState(scene.published_state);
    const tokenUpdates = Array.isArray(patch.tokens) ? patch.tokens : null;
    const otherKeys = Object.keys(patch).filter((k) => k !== 'tokens');
    if (!tokenUpdates || otherKeys.length > 0) {
      throw createHttpError(403, 'Players may only update own token positions');
    }
    const byId = new Map((cur.tokens || []).map((t) => [t.id, { ...t }]));
    for (const t of tokenUpdates) {
      if (!t || !t.id) continue;
      const ex = byId.get(t.id);
      if (ex && ex.ownerUserId === auth.userId) {
        if (typeof t.x === 'number') ex.x = t.x;
        if (typeof t.y === 'number') ex.y = t.y;
        if (typeof t.size === 'number') ex.size = t.size;
      }
    }
    const merged = normalizeSceneState({ ...cur, tokens: Array.from(byId.values()) });
    const result = await pool.query(
      `UPDATE tabletop_scenes
       SET published_state = $3::jsonb, updated_at = now()
       WHERE game_id = $1 AND id = $2
       RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
      [gameId, sceneId, JSON.stringify(merged)]
    );
    return mapSceneRow(result.rows[0], { forPlayer: false, isGm: true });
  }

  const effectiveTarget = target;
  const current = normalizeSceneState(
    effectiveTarget === 'published' ? scene.published_state : scene.draft_state
  );
  const mergedState = mergeScenePatch(current, patch);

  if (effectiveTarget === 'published') {
    const result = await pool.query(
      `UPDATE tabletop_scenes
       SET published_state = $3::jsonb, updated_at = now()
       WHERE game_id = $1 AND id = $2
       RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
      [gameId, sceneId, JSON.stringify(mergedState)]
    );
    return mapSceneRow(result.rows[0], { forPlayer: false, isGm: true });
  }

  const result = await pool.query(
    `UPDATE tabletop_scenes
     SET draft_state = $3::jsonb, updated_at = now()
     WHERE game_id = $1 AND id = $2
     RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
    [gameId, sceneId, JSON.stringify(mergedState)]
  );

  return mapSceneRow(result.rows[0], { forPlayer: false, isGm: true });
}

async function publishScene(auth, gameId, sceneId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can publish');
  }
  if (!isUuid(sceneId)) {
    throw createHttpError(400, 'Invalid scene id');
  }

  const sceneRes = await pool.query(
    `SELECT draft_state FROM tabletop_scenes WHERE game_id = $1 AND id = $2 LIMIT 1`,
    [gameId, sceneId]
  );
  if (!sceneRes.rows[0]) {
    throw createHttpError(404, 'Scene not found');
  }

  const draft = normalizeSceneState(sceneRes.rows[0].draft_state);
  const result = await pool.query(
    `UPDATE tabletop_scenes
     SET published_state = $3::jsonb, updated_at = now()
     WHERE game_id = $1 AND id = $2
     RETURNING id, game_id, name, sort_order, is_active, draft_state, published_state, created_at, updated_at`,
    [gameId, sceneId, JSON.stringify(draft)]
  );

  return mapSceneRow(result.rows[0], { forPlayer: false, isGm: true });
}

async function saveUploadedMap(auth, gameId, file) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can upload maps');
  }
  if (!file || !file.buffer) {
    throw createHttpError(400, 'File required');
  }
  if (file.size > MAX_MAP_BYTES) {
    throw createHttpError(400, 'File too large');
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    throw createHttpError(400, 'Invalid image type');
  }

  await fs.mkdir(UPLOADS_VTT_DIR, { recursive: true });
  const ext = mime === 'image/png' ? '.png'
    : mime === 'image/jpeg' ? '.jpg'
      : mime === 'image/webp' ? '.webp' : '.gif';
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const full = path.join(UPLOADS_VTT_DIR, name);
  await fs.writeFile(full, file.buffer);

  return { url: `/uploads/vtt/${name}`, mime, size: file.size };
}

async function listGameCharacters(auth, gameId) {
  await getMyMembership(auth, gameId);

  const result = await pool.query(
    `SELECT gc.id, gc.character_id, gc.user_id, uc.name, uc.level, uc.class_name, uc.game_system
     FROM game_characters gc
     INNER JOIN user_characters uc ON uc.id = gc.character_id
     WHERE gc.game_id = $1
     ORDER BY uc.name ASC`,
    [gameId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    userId: row.user_id,
    name: row.name,
    level: row.level,
    className: row.class_name,
    gameSystem: row.game_system
  }));
}

async function addGameCharacter(auth, gameId, data) {
  const { isGm } = await getMyMembership(auth, gameId);
  const payload = data && typeof data === 'object' ? data : {};
  const characterId = typeof payload.characterId === 'string' ? payload.characterId.trim() : '';
  if (!isUuid(characterId)) {
    throw createHttpError(400, 'Invalid characterId');
  }

  const charRes = await pool.query(
    `SELECT id, user_id FROM user_characters WHERE id = $1 LIMIT 1`,
    [characterId]
  );
  const character = charRes.rows[0];
  if (!character) {
    throw createHttpError(404, 'Character not found');
  }

  const ownerUserId = character.user_id;
  if (!isGm && ownerUserId !== auth.userId) {
    throw createHttpError(403, 'Can only add your own character unless GM');
  }

  await getMyMembership(auth, gameId);
  const memberRes = await pool.query(
    `SELECT status FROM game_memberships WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
    [gameId, ownerUserId]
  );
  if (!memberRes.rows[0] || memberRes.rows[0].status !== 'approved') {
    throw createHttpError(400, 'Character owner must be an approved member');
  }

  try {
    const ins = await pool.query(
      `INSERT INTO game_characters (game_id, character_id, user_id)
       VALUES ($1, $2, $3)
       RETURNING id, game_id, character_id, user_id`,
      [gameId, characterId, ownerUserId]
    );
    return ins.rows[0];
  } catch (e) {
    if (String(e.code) === '23505') {
      throw createHttpError(409, 'Character already in this game');
    }
    throw e;
  }
}

async function removeGameCharacter(auth, gameId, linkId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isUuid(linkId)) {
    throw createHttpError(400, 'Invalid id');
  }

  const rowRes = await pool.query(
    `SELECT id, user_id FROM game_characters WHERE id = $1 AND game_id = $2 LIMIT 1`,
    [linkId, gameId]
  );
  const row = rowRes.rows[0];
  if (!row) {
    throw createHttpError(404, 'Link not found');
  }
  if (!isGm && row.user_id !== auth.userId) {
    throw createHttpError(403, 'Forbidden');
  }

  await pool.query('DELETE FROM game_characters WHERE id = $1', [linkId]);
  return { ok: true };
}

/* --- legacy tabletop_rooms (unchanged behaviour for old clients) --- */

function normalizeRoomPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const playerUserIdsRaw = Array.isArray(payload.playerUserIds) ? payload.playerUserIds : [];

  const playerUserIds = playerUserIdsRaw
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => isUuid(id));

  if (name && name.length > 180) {
    throw createHttpError(400, 'Room name is too long');
  }

  return {
    name: name || 'Tabletop room',
    playerUserIds: Array.from(new Set(playerUserIds)).slice(0, 50)
  };
}

function normalizeStatePatch(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const state = payload.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw createHttpError(400, 'State must be an object');
  }
  return state;
}

function mapRoomRow(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    gameId: row.game_id || null,
    name: row.name,
    playerUserIds: Array.isArray(row.player_user_ids) ? row.player_user_ids : [],
    state: row.state && typeof row.state === 'object' ? row.state : {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

async function assertRoomAccess(auth, roomId) {
  requireAuthUser(auth);
  if (!isUuid(roomId)) {
    throw createHttpError(400, 'Invalid room id');
  }

  const result = await pool.query(
    `SELECT
      id,
      owner_user_id,
      game_id,
      name,
      player_user_ids,
      state,
      created_at,
      updated_at
    FROM tabletop_rooms
    WHERE id = $1
    LIMIT 1`,
    [roomId]
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Room not found');
  }

  if (row.game_id) {
    try {
      await getMyMembership(auth, row.game_id);
      return row;
    } catch (e) {
      if (e.statusCode === 403 || e.statusCode === 401) {
        throw createHttpError(403, 'Forbidden');
      }
      throw e;
    }
  }

  const ownerId = row.owner_user_id;
  const players = Array.isArray(row.player_user_ids) ? row.player_user_ids : [];
  const hasAccess = ownerId === auth.userId || players.includes(auth.userId);
  if (!hasAccess) {
    throw createHttpError(403, 'Forbidden');
  }

  return row;
}

async function createRoom(auth, data) {
  requireAuthUser(auth);
  const payload = normalizeRoomPayload(data);

  const result = await pool.query(
    `INSERT INTO tabletop_rooms (
      owner_user_id,
      name,
      player_user_ids,
      state,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3::uuid[], '{}'::jsonb, now(), now())
    RETURNING
      id,
      owner_user_id,
      game_id,
      name,
      player_user_ids,
      state,
      created_at,
      updated_at`,
    [auth.userId, payload.name, payload.playerUserIds]
  );

  return mapRoomRow(result.rows[0]);
}

async function getRoom(auth, roomId) {
  const row = await assertRoomAccess(auth, roomId);
  return mapRoomRow(row);
}

async function patchRoomState(auth, roomId, data) {
  await assertRoomAccess(auth, roomId);
  const state = normalizeStatePatch(data);

  const result = await pool.query(
    `UPDATE tabletop_rooms
     SET state = $2::jsonb, updated_at = now()
     WHERE id = $1
     RETURNING
      id,
      owner_user_id,
      game_id,
      name,
      player_user_ids,
      state,
      created_at,
      updated_at`,
    [roomId, state]
  );

  return mapRoomRow(result.rows[0]);
}

module.exports = {
  DEFAULT_SCENE_STATE,
  deepMerge,
  normalizeSceneState,
  filterPublishedStateForPlayer,
  getTabletopBundle,
  createScene,
  setActiveScene,
  patchSceneState,
  publishScene,
  saveUploadedMap,
  listGameCharacters,
  addGameCharacter,
  removeGameCharacter,
  ensureDefaultScene,
  getMyMembership,
  mapSceneRow,
  createRoom,
  getRoom,
  patchRoomState
};
