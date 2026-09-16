const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const pool = require('../../db/pool');
const dice = require('./dice');

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

async function getTabletopBundle(auth, gameId) {
  await assertGameExists(gameId);
  const { isGm } = await getMyMembership(auth, gameId);
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

/* --- T6.1: серверный лог событий стола (table_events) --- */

const EVENT_TYPES = new Set(['roll', 'action', 'playerDisconnected', 'playerReconnected']);
const ACTION_TYPES = new Set(['attack', 'spell', 'ability']);
const ROLL_KINDS = new Set(['hit', 'damage', 'check']);
const EVENTS_PAGE_LIMIT = 100;
const EVENTS_MAX_LIMIT = 200;

function mapEventRow(row) {
  return {
    id: Number(row.id),
    gameId: row.game_id,
    sessionId: row.session_id || null,
    type: row.type,
    actorUserId: row.actor_user_id || null,
    actorName: row.actor_name || null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    isPrivate: Boolean(row.is_private),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function getLiveSessionId(gameId) {
  const result = await pool.query(
    `SELECT id FROM game_sessions
     WHERE game_id = $1 AND status = 'live'
     ORDER BY starts_at DESC
     LIMIT 1`,
    [gameId]
  );
  return result.rows[0]?.id || null;
}

async function getUserDisplayName(userId) {
  if (!isUuid(userId)) return null;
  const result = await pool.query(
    'SELECT display_name FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.display_name || null;
}

async function insertTableEvent({ gameId, type, actorUserId, actorName, payload, isPrivate }) {
  if (!EVENT_TYPES.has(type)) {
    throw createHttpError(400, 'Unknown event type');
  }
  const sessionId = await getLiveSessionId(gameId);
  const result = await pool.query(
    `INSERT INTO table_events (game_id, session_id, type, actor_user_id, actor_name, payload, is_private)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id, game_id, session_id, type, actor_user_id, actor_name, payload, is_private, created_at`,
    [
      gameId,
      sessionId,
      type,
      actorUserId || null,
      actorName || null,
      JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
      Boolean(isPrivate)
    ]
  );
  return mapEventRow(result.rows[0]);
}

function normalizeShortText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

/**
 * Бросок кубиков: формула пересчитывается сервером (dice.rollFormula),
 * клиентский результат не принимается вовсе.
 */
async function createRollEvent(auth, gameId, data) {
  const { isGm } = await getMyMembership(auth, gameId);
  const payload = data && typeof data === 'object' ? data : {};
  const label = normalizeShortText(payload.label, 120);
  const isPrivate = Boolean(payload.private);
  if (isPrivate && !isGm) {
    throw createHttpError(403, 'Only GM can roll privately');
  }

  // Преимущество/помеха: формула бросается дважды, берётся лучший/худший итог.
  const mode = payload.mode === 'advantage' || payload.mode === 'disadvantage'
    ? payload.mode
    : null;

  let eventPayload;
  if (mode) {
    const first = dice.rollFormula(payload.formula);
    const second = dice.rollFormula(payload.formula);
    const chosen = mode === 'advantage'
      ? (first.total >= second.total ? first : second)
      : (first.total <= second.total ? first : second);
    eventPayload = {
      formula: chosen.formula,
      label: label || null,
      mode,
      attempts: [
        { total: first.total, detail: first.detail },
        { total: second.total, detail: second.detail }
      ],
      total: chosen.total,
      detail: chosen.detail
    };
  } else {
    const roll = dice.rollFormula(payload.formula);
    eventPayload = {
      formula: roll.formula,
      label: label || null,
      total: roll.total,
      detail: roll.detail
    };
  }

  const actorName = await getUserDisplayName(auth.userId);
  return insertTableEvent({
    gameId,
    type: 'roll',
    actorUserId: auth.userId,
    actorName,
    payload: eventPayload,
    isPrivate
  });
}

/**
 * Структурированное действие (атака / заклинание / способность), PRD §5.4.6.
 * Все броски внутри действия тоже считает сервер.
 */
async function createActionEvent(auth, gameId, data) {
  await getMyMembership(auth, gameId);
  const payload = data && typeof data === 'object' ? data : {};

  const actionType = normalizeShortText(payload.actionType, 20);
  if (!ACTION_TYPES.has(actionType)) {
    throw createHttpError(400, 'Unknown action type');
  }

  const source = normalizeShortText(payload.source, 120);
  if (!source) {
    throw createHttpError(400, 'Action source is required');
  }

  const target = normalizeShortText(payload.target, 120);
  const detail = normalizeShortText(payload.detail, 500);
  // Имя персонажа, от лица которого совершается действие (для строки в ленте).
  const character = normalizeShortText(payload.character, 120);

  let spellLevel = null;
  if (payload.spellLevel !== undefined && payload.spellLevel !== null && payload.spellLevel !== '') {
    const lvl = Number(payload.spellLevel);
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 9) {
      throw createHttpError(400, 'Invalid spell level');
    }
    spellLevel = lvl;
  }

  const rollsIn = Array.isArray(payload.rolls) ? payload.rolls.slice(0, 3) : [];
  const rolls = [];
  for (const item of rollsIn) {
    if (!item || typeof item !== 'object') continue;
    const kind = normalizeShortText(item.kind, 20);
    if (!ROLL_KINDS.has(kind)) {
      throw createHttpError(400, 'Unknown roll kind');
    }
    const result = dice.rollFormula(item.formula);
    rolls.push({
      kind,
      formula: result.formula,
      total: result.total,
      detail: result.detail
    });
  }

  const actorName = await getUserDisplayName(auth.userId);
  return insertTableEvent({
    gameId,
    type: 'action',
    actorUserId: auth.userId,
    actorName,
    payload: {
      actionType,
      source,
      target: target || null,
      detail: detail || null,
      character: character || null,
      spellLevel,
      rolls
    },
    isPrivate: false
  });
}

/** Служебное событие (отключение/возврат игрока) — пишет сам сервер. */
async function createPresenceEvent(gameId, type, userId) {
  if (type !== 'playerDisconnected' && type !== 'playerReconnected') {
    throw createHttpError(400, 'Unknown presence event type');
  }
  const actorName = await getUserDisplayName(userId);
  return insertTableEvent({
    gameId,
    type,
    actorUserId: userId,
    actorName,
    payload: {},
    isPrivate: false
  });
}

/**
 * История событий. Игрок видит все публичные + свои приватные; мастер — всё.
 * before/after — id события (пагинация назад / докачка после reconnect).
 */
async function listTableEvents(auth, gameId, query = {}) {
  const { isGm } = await getMyMembership(auth, gameId);

  const rawLimit = Number(query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, EVENTS_MAX_LIMIT)
    : EVENTS_PAGE_LIMIT;

  const conditions = ['game_id = $1'];
  const values = [gameId];

  if (!isGm) {
    values.push(auth.userId);
    conditions.push(`(is_private = false OR actor_user_id = $${values.length})`);
  }

  const before = Number(query.before);
  if (Number.isFinite(before) && before > 0) {
    values.push(Math.floor(before));
    conditions.push(`id < $${values.length}`);
  }

  const after = Number(query.after);
  if (Number.isFinite(after) && after >= 0) {
    values.push(Math.floor(after));
    conditions.push(`id > $${values.length}`);
  }

  const result = await pool.query(
    `SELECT id, game_id, session_id, type, actor_user_id, actor_name, payload, is_private, created_at
     FROM table_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY id DESC
     LIMIT ${limit}`,
    values
  );

  // Отдаём по возрастанию id — так проще рисовать ленту.
  return result.rows.map(mapEventRow).reverse();
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
  createRollEvent,
  createActionEvent,
  createPresenceEvent,
  listTableEvents
};
