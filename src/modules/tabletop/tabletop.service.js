const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const pool = require('../../db/pool');
const dice = require('./dice');
const profileService = require('../profile/profile.service');

const UPLOADS_VTT_DIR = path.join(process.cwd(), 'uploads', 'vtt');
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_MAP_BYTES = 12 * 1024 * 1024;

const DEFAULT_SCENE_STATE = {
  mapUrl: null,
  mapSize: { w: 2400, h: 1600 },
  // feetPerCell — сколько футов в клетке (калибровка сетки по карте), для линейки и шаблонов.
  grid: { enabled: false, cellPx: 70, offsetX: 0, offsetY: 0, feetPerCell: 5 },
  tokens: [],
  templates: [],
  measure: { active: false, points: [] },
  initiative: { active: false, round: 1, turnIndex: 0, entries: [] },
  gmNotes: [],
  // Туман: enabled — весь лист скрыт, ops — по порядку «открыть/скрыть» круг или прямоугольник.
  fog: { enabled: false, ops: [], revealed: [] }
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
    const isAdd = patch.tokens.some((t) => t && t.id && !curIds.has(t.id));
    // Полная замена списка — только когда клиент явно просит (tokensMode: 'replace':
    // добавление/удаление токена) или присылает новый токен. Частичный список
    // (сдвиг одного токена) сливается по id, остальные токены не трогаются —
    // раньше они пропадали, и казалось, что токены «объединяются в один».
    const replaceAll = patch.tokensMode === 'replace' || isAdd;
    if (replaceAll) {
      next.tokens = patch.tokens.filter((t) => t && t.id);
    } else {
      const byId = new Map(curTok.map((t) => [t.id, { ...t }]));
      for (const p of patch.tokens) {
        if (p && p.id && byId.has(p.id)) {
          Object.assign(byId.get(p.id), p);
        }
      }
      next.tokens = Array.from(byId.values());
    }
    const { tokens: _t, tokensMode: _m, ...rest } = patch;
    next = deepMerge(next, rest);
  } else {
    next = deepMerge(current, patch);
  }

  return normalizeSceneState(next);
}

function normalizeSceneState(raw) {
  return deepMerge({ ...DEFAULT_SCENE_STATE }, raw && typeof raw === 'object' ? raw : {});
}

const TOKEN_MAX_CONDITIONS = 12;
const TOKEN_HP_FIELDS = ['hpCurrent', 'hpMax', 'tempHp'];

function clampNumberOrNull(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function shortText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Состояния токена: значок + подпись (стандартное состояние из вики или своё). */
function sanitizeTokenConditions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === 'object')
    .slice(0, TOKEN_MAX_CONDITIONS)
    .map((c) => ({
      id: shortText(c.id, 40) || `c-${Math.random().toString(36).slice(2, 10)}`,
      slug: shortText(c.slug, 40) || null,
      icon: shortText(c.icon, 8) || '●',
      label: shortText(c.label, 40)
    }));
}

/** Линейка: до 8 точек с числовыми координатами, кто мерит, когда. */
function sanitizeMeasure(measure, userId) {
  const points = Array.isArray(measure?.points)
    ? measure.points
      .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .slice(0, 8)
      .map((p) => ({ x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }))
    : [];
  return {
    active: points.length >= 2,
    points,
    userId: userId || null,
    label: shortText(measure?.label, 60),
    at: Date.now()
  };
}

/** Поля токена, которые приходят с клиента, приводим к безопасным значениям. */
function sanitizeToken(token) {
  if (!token || typeof token !== 'object') return token;
  const out = { ...token };
  for (const key of TOKEN_HP_FIELDS) {
    if (key in out) out[key] = clampNumberOrNull(out[key], 0, 9999);
  }
  if ('conditions' in out) out.conditions = sanitizeTokenConditions(out.conditions);
  if ('gmNote' in out) out.gmNote = shortText(out.gmNote, 2000);
  if ('label' in out) out.label = shortText(out.label, 80);
  return out;
}

/**
 * Что из опубликованной сцены видит игрок: без скрытых объектов и заметок мастера;
 * хиты — только у своих токенов (мастер видит хиты всех).
 */
function filterPublishedStateForPlayer(state, viewerUserId = null) {
  const normalized = normalizeSceneState(state);
  const out = JSON.parse(JSON.stringify(normalized));
  delete out.gmNotes;
  if (Array.isArray(out.tokens)) {
    out.tokens = out.tokens
      .filter((t) => !t.hidden && t.visibility !== 'gm')
      .map((t) => {
        const copy = { ...t };
        delete copy.gmNote;
        const isOwner = viewerUserId && copy.ownerUserId && String(copy.ownerUserId) === String(viewerUserId);
        if (!isOwner) {
          for (const key of TOKEN_HP_FIELDS) delete copy[key];
        }
        return copy;
      });
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

function mapSceneRow(row, { forPlayer, isGm, viewerUserId = null }) {
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
    publishedState: forPlayer ? filterPublishedStateForPlayer(published, viewerUserId) : published,
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

  const scenes = scenesResult.rows.map((row) => mapSceneRow(row, { forPlayer: !isGm, isGm, viewerUserId: auth.userId }));

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
    const measurePatch = patch.measure && typeof patch.measure === 'object' ? patch.measure : null;
    const otherKeys = Object.keys(patch).filter((k) => k !== 'tokens' && k !== 'tokensMode' && k !== 'measure');
    if ((!tokenUpdates && !measurePatch) || otherKeys.length > 0) {
      throw createHttpError(403, 'Players may only update their own tokens and the ruler');
    }
    // Линейка видна всем: игрок может показать своё измерение (две точки, подпись).
    if (measurePatch) {
      cur.measure = sanitizeMeasure(measurePatch, auth.userId);
    }
    const byId = new Map((cur.tokens || []).map((t) => [t.id, { ...t }]));
    for (const raw of tokenUpdates || []) {
      if (!raw || !raw.id) continue;
      const ex = byId.get(raw.id);
      if (!ex || ex.ownerUserId !== auth.userId) continue;
      // Владелец токена: положение, размер, хиты и состояния. Заметки мастера,
      // владелец, скрытость и подпись — только мастер.
      const t = sanitizeToken(raw);
      if (typeof t.x === 'number') ex.x = t.x;
      if (typeof t.y === 'number') ex.y = t.y;
      if (typeof t.size === 'number') ex.size = t.size;
      for (const key of TOKEN_HP_FIELDS) {
        if (key in t) ex[key] = t[key];
      }
      if ('conditions' in t) ex.conditions = t.conditions;
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
  const safePatch = { ...patch };
  if (Array.isArray(patch.tokens)) safePatch.tokens = patch.tokens.map((t) => sanitizeToken(t));
  if (patch.measure && typeof patch.measure === 'object') safePatch.measure = sanitizeMeasure(patch.measure, auth.userId);
  const mergedState = mergeScenePatch(current, safePatch);

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

/** Размер PNG/JPEG/GIF/WebP по заголовку файла — чтобы карта сразу вставала в свой размер. */
function readImageSize(buffer, mime) {
  try {
    if (mime === 'image/png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (mime === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const b0 = buffer[21]; const b1 = buffer[22]; const b2 = buffer[23]; const b3 = buffer[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
    }
  } catch (e) {
    /* размер не критичен */
  }
  return { width: null, height: null };
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
    const error = createHttpError(400, 'File too large');
    error.code = 'FILE_TOO_LARGE';
    throw error;
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    const error = createHttpError(400, 'Invalid image type');
    error.code = 'INVALID_IMAGE_TYPE';
    throw error;
  }

  await fs.mkdir(UPLOADS_VTT_DIR, { recursive: true });
  const ext = mime === 'image/png' ? '.png'
    : mime === 'image/jpeg' ? '.jpg'
      : mime === 'image/webp' ? '.webp' : '.gif';
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const full = path.join(UPLOADS_VTT_DIR, name);
  await fs.writeFile(full, file.buffer);

  const url = `/uploads/vtt/${name}`;
  const { width, height } = readImageSize(file.buffer, mime);
  // Запись в библиотеку игры: файл можно будет поставить картой снова или удалить.
  const originalName = String(file.originalname || '').slice(0, 255);
  const inserted = await pool.query(
    `INSERT INTO tabletop_files (game_id, uploaded_by, kind, url, original_name, mime, size_bytes, width, height)
     VALUES ($1, $2, 'map', $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [gameId, auth.userId, url, originalName, mime, file.size, width, height]
  );

  return { url, mime, size: file.size, width, height, fileId: inserted.rows[0].id, name: originalName };
}

function mapFileRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    name: row.original_name || '',
    mime: row.mime,
    size: Number(row.size_bytes) || 0,
    width: row.width,
    height: row.height,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

/** Библиотека файлов игры — мастеру. */
async function listGameFiles(auth, gameId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can see the game library');
  }
  const result = await pool.query(
    `SELECT id, kind, url, original_name, mime, size_bytes, width, height, created_at
     FROM tabletop_files
     WHERE game_id = $1
     ORDER BY created_at DESC`,
    [gameId]
  );
  return result.rows.map(mapFileRow);
}

/** Удалить файл из библиотеки и с диска; из сцен, где он стоит картой, ссылка убирается. */
async function deleteGameFile(auth, gameId, fileId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isGm) {
    throw createHttpError(403, 'Only GM can delete files');
  }
  if (!isUuid(fileId)) {
    throw createHttpError(400, 'Invalid file id');
  }
  const found = await pool.query(
    'SELECT id, url FROM tabletop_files WHERE id = $1 AND game_id = $2 LIMIT 1',
    [fileId, gameId]
  );
  const row = found.rows[0];
  if (!row) {
    throw createHttpError(404, 'File not found');
  }
  await pool.query('DELETE FROM tabletop_files WHERE id = $1', [fileId]);
  await pool.query(
    `UPDATE tabletop_scenes
     SET draft_state = CASE WHEN draft_state->>'mapUrl' = $2 THEN draft_state || '{"mapUrl": null}'::jsonb ELSE draft_state END,
         published_state = CASE WHEN published_state->>'mapUrl' = $2 THEN published_state || '{"mapUrl": null}'::jsonb ELSE published_state END,
         updated_at = now()
     WHERE game_id = $1 AND (draft_state->>'mapUrl' = $2 OR published_state->>'mapUrl' = $2)`,
    [gameId, row.url]
  );
  const fileName = path.basename(String(row.url));
  if (/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/i.test(fileName)) {
    await fs.unlink(path.join(UPLOADS_VTT_DIR, fileName)).catch(() => {});
  }
  return { ok: true };
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

/**
 * Лист персонажа, приведённого за этот стол: владельцу и мастеру игры.
 * Раньше мастер получал «персонаж не найден», потому что фронт искал лист
 * только среди собственных персонажей.
 */
async function getGameCharacterSheet(auth, gameId, characterId) {
  const { isGm } = await getMyMembership(auth, gameId);
  if (!isUuid(characterId)) {
    throw createHttpError(400, 'Invalid character id');
  }

  const result = await pool.query(
    `SELECT uc.*, gc.user_id AS link_user_id, u.display_name AS owner_name
     FROM game_characters gc
     INNER JOIN user_characters uc ON uc.id = gc.character_id
     INNER JOIN users u ON u.id = gc.user_id
     WHERE gc.game_id = $1 AND gc.character_id = $2
     LIMIT 1`,
    [gameId, characterId]
  );
  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Character is not at this table');
  }
  if (!isGm && row.link_user_id !== auth.userId) {
    throw createHttpError(403, 'Only the owner or the GM can view this sheet');
  }

  return {
    ...profileService.mapCharacterRow(row),
    userId: row.link_user_id,
    ownerName: row.owner_name,
    isOwner: row.link_user_id === auth.userId
  };
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
// healing — бросок лечения заклинанием («Лечение ран»), считается как урон, но подписывается иначе.
const ROLL_KINDS = new Set(['hit', 'damage', 'check', 'healing']);
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
    // Помеха/преимущество на попадание и проверку: две попытки, берётся лучшая/худшая.
    const mode = (kind === 'hit' || kind === 'check')
      && (item.mode === 'advantage' || item.mode === 'disadvantage')
      ? item.mode
      : null;
    if (mode) {
      const first = dice.rollFormula(item.formula);
      const second = dice.rollFormula(item.formula);
      const chosen = mode === 'advantage'
        ? (first.total >= second.total ? first : second)
        : (first.total <= second.total ? first : second);
      rolls.push({
        kind,
        formula: chosen.formula,
        total: chosen.total,
        detail: chosen.detail,
        mode,
        attempts: [
          { total: first.total, detail: first.detail },
          { total: second.total, detail: second.detail }
        ]
      });
      continue;
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
  mergeScenePatch,
  sanitizeToken,
  normalizeSceneState,
  getGameCharacterSheet,
  filterPublishedStateForPlayer,
  getTabletopBundle,
  createScene,
  setActiveScene,
  patchSceneState,
  publishScene,
  saveUploadedMap,
  listGameFiles,
  deleteGameFile,
  readImageSize,
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
