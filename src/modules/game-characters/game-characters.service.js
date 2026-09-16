/**
 * T5.4 — модель «шаблон + копия на стол».
 *
 * Шаблон живёт в user_characters (профиль). При привязке к игре создаётся
 * копия в game_characters с независимым прогрессом state (hp, tempHp, level,
 * inventory, notes) и снимком листа created_from_sheet. Урон в одной игре не
 * виден в другой и не трогает шаблон; перенос прогресса в шаблон — только
 * явным действием sync-to-template.
 *
 * Существующие ручки /api/tabletop/games/:id/characters (T6) не трогаем:
 * привязки, созданные ими без state, дополняются лениво при первом чтении.
 */

const pool = require('../../db/pool');
const profileService = require('../profile/profile.service');
const { clampInt, cappedText, createHttpError } = require('../profile/character-sheet');

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireAuthUser(auth) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function getApprovedMembership(auth, gameId) {
  requireAuthUser(auth);
  if (!isUuid(gameId)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const result = await pool.query(
    `SELECT gm.member_role, gm.status, g.title
     FROM games g
     LEFT JOIN game_memberships gm
       ON gm.game_id = g.id AND gm.user_id = $2
     WHERE g.id = $1
     LIMIT 1`,
    [gameId, auth.userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Game not found');
  }
  if (!row.member_role || row.status !== 'approved') {
    throw createHttpError(403, 'Only approved game members have characters at this table');
  }
  return { gameTitle: row.title, memberRole: row.member_role };
}

/** Независимое состояние копии, собранное из листа шаблона. */
function stateFromTemplate(templateRow) {
  const { sheet, notes } = profileService.parseSheetColumn(templateRow);
  const combat = sheet?.combat && typeof sheet.combat === 'object' ? sheet.combat : {};
  const hpMax = clampInt(combat.hpMax, 1, 999, 10);
  return {
    hp: clampInt(combat.hpCurrent, 0, 999, hpMax),
    hpMax,
    tempHp: clampInt(combat.tempHp, 0, 999, 0),
    level: clampInt(templateRow.level, 1, 20, 1),
    inventory: Array.isArray(sheet?.equipment) ? sheet.equipment.slice(0, 30) : [],
    notes: cappedText(notes, 4000)
  };
}

/** Снимок листа шаблона на момент привязки. */
function snapshotFromTemplate(templateRow) {
  const { sheet } = profileService.parseSheetColumn(templateRow);
  const snapshot = sheet && typeof sheet === 'object' ? { ...sheet } : {};
  delete snapshot.legacyPortrait; // снимок без тяжёлых data-URL
  return {
    ...snapshot,
    name: templateRow.name,
    className: templateRow.class_name,
    race: templateRow.race || '',
    gameSystem: templateRow.game_system,
    background: templateRow.background || '',
    level: String(clampInt(templateRow.level, 1, 20, 1))
  };
}

function normalizeStatePatch(data, currentState) {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  if (!payload) {
    throw createHttpError(400, 'State payload must be an object');
  }
  const state = payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : payload;

  const next = { ...currentState };
  if ('hp' in state) next.hp = clampInt(state.hp, 0, 999, currentState.hp ?? 10);
  if ('hpMax' in state) next.hpMax = clampInt(state.hpMax, 1, 999, currentState.hpMax ?? 10);
  if ('tempHp' in state) next.tempHp = clampInt(state.tempHp, 0, 999, currentState.tempHp ?? 0);
  if ('level' in state) {
    const level = Number(state.level);
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      throw createHttpError(400, 'Level must be an integer between 1 and 20');
    }
    next.level = level;
  }
  if ('inventory' in state) {
    if (!Array.isArray(state.inventory)) {
      throw createHttpError(400, 'Inventory must be an array');
    }
    next.inventory = state.inventory
      .map((item) => cappedText(item, 300))
      .filter(Boolean)
      .slice(0, 30);
  }
  if ('notes' in state) {
    next.notes = cappedText(state.notes, 4000);
  }
  return next;
}

function mapGameCharacterRow(row, extra = {}) {
  const state = row.state && typeof row.state === 'object' ? row.state : {};
  return {
    id: row.id,
    gameId: row.game_id,
    characterId: row.character_id,
    userId: row.user_id,
    state,
    createdFromSheet: row.created_from_sheet && typeof row.created_from_sheet === 'object'
      ? row.created_from_sheet
      : null,
    createdAt: toIso(row.created_at),
    updatedAt: row.updated_at ? toIso(row.updated_at) : toIso(row.created_at),
    ...extra
  };
}

/**
 * POST /api/games/:gameId/characters/:characterId/link
 * Создать копию персонажа-шаблона для этого стола. Идемпотентно: если копия
 * уже есть — возвращаем её (alreadyLinked: true), state не перезаписываем.
 */
async function linkCharacterToGame(auth, gameId, characterId) {
  const { gameTitle } = await getApprovedMembership(auth, gameId);
  const template = await profileService.getOwnedCharacterRow(auth, characterId);

  const existing = await pool.query(
    `SELECT * FROM game_characters
     WHERE game_id = $1 AND character_id = $2
     LIMIT 1`,
    [gameId, characterId]
  );
  if (existing.rows[0]) {
    const hydrated = await ensureStateInitialized(existing.rows[0], template);
    return mapGameCharacterRow(hydrated, { gameTitle, alreadyLinked: true });
  }

  const state = stateFromTemplate(template);
  const snapshot = snapshotFromTemplate(template);

  const inserted = await pool.query(
    `INSERT INTO game_characters (game_id, character_id, user_id, state, created_from_sheet)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [gameId, characterId, auth.userId, state, snapshot]
  );

  return mapGameCharacterRow(inserted.rows[0], { gameTitle, alreadyLinked: false });
}

/** Ленивая инициализация state/снимка для привязок, созданных старой ручкой. */
async function ensureStateInitialized(row, templateRow = null) {
  const hasState = row.state && typeof row.state === 'object' && Object.keys(row.state).length > 0;
  if (hasState && row.created_from_sheet) {
    return row;
  }

  let template = templateRow;
  if (!template) {
    const result = await pool.query(
      'SELECT * FROM user_characters WHERE id = $1 LIMIT 1',
      [row.character_id]
    );
    template = result.rows[0];
  }
  if (!template) {
    return row;
  }

  const state = hasState ? row.state : stateFromTemplate(template);
  const snapshot = row.created_from_sheet || snapshotFromTemplate(template);

  const updated = await pool.query(
    `UPDATE game_characters
     SET state = $2, created_from_sheet = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [row.id, state, snapshot]
  );
  return updated.rows[0];
}

/** GET /api/games/:gameId/my-character — копия текущего пользователя. */
async function getMyGameCharacter(auth, gameId) {
  const { gameTitle } = await getApprovedMembership(auth, gameId);

  const result = await pool.query(
    `SELECT gc.*, uc.name AS template_name, uc.portrait_path AS template_portrait_path
     FROM game_characters gc
     LEFT JOIN user_characters uc ON uc.id = gc.character_id
     WHERE gc.game_id = $1 AND gc.user_id = $2
     ORDER BY gc.created_at DESC
     LIMIT 1`,
    [gameId, auth.userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'No character linked to this game');
  }

  const hydrated = await ensureStateInitialized(row);
  return mapGameCharacterRow(hydrated, {
    gameTitle,
    templateName: row.template_name || null
  });
}

/** PATCH /api/games/:gameId/my-character — правка независимого состояния. */
async function patchMyGameCharacter(auth, gameId, data) {
  const { gameTitle } = await getApprovedMembership(auth, gameId);

  const result = await pool.query(
    `SELECT * FROM game_characters
     WHERE game_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [gameId, auth.userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'No character linked to this game');
  }

  const hydrated = await ensureStateInitialized(row);
  const nextState = normalizeStatePatch(data, hydrated.state || {});

  const updated = await pool.query(
    `UPDATE game_characters
     SET state = $2, updated_at = now()
     WHERE id = $1 AND user_id = $3
     RETURNING *`,
    [hydrated.id, nextState, auth.userId]
  );

  return mapGameCharacterRow(updated.rows[0], { gameTitle });
}

/**
 * POST /api/games/:gameId/my-character/sync-to-template — явный перенос
 * прогресса копии (hp, tempHp, level, inventory, notes) в шаблон профиля.
 */
async function syncMyGameCharacterToTemplate(auth, gameId) {
  await getApprovedMembership(auth, gameId);

  const result = await pool.query(
    `SELECT * FROM game_characters
     WHERE game_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [gameId, auth.userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'No character linked to this game');
  }

  const hydrated = await ensureStateInitialized(row);
  const state = hydrated.state || {};
  const template = await profileService.getOwnedCharacterRow(auth, hydrated.character_id);
  const { sheet, notes } = profileService.parseSheetColumn(template);

  const level = clampInt(state.level, 1, 20, template.level);
  const nextSheet = {
    ...(sheet || {}),
    level: String(level),
    combat: {
      ...(sheet?.combat || {}),
      hpCurrent: clampInt(state.hp, 0, 999, sheet?.combat?.hpCurrent ?? 10),
      hpMax: clampInt(state.hpMax, 1, 999, sheet?.combat?.hpMax ?? 10),
      tempHp: clampInt(state.tempHp, 0, 999, 0)
    },
    equipment: Array.isArray(state.inventory) ? state.inventory.slice(0, 30) : (sheet?.equipment || [])
  };
  const nextNotes = 'notes' in state ? cappedText(state.notes, 4000) : notes;

  const updated = await pool.query(
    `UPDATE user_characters
     SET level = $3, sheet = $4, notes = $5, updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, level, sheet, notes, updated_at`,
    [hydrated.character_id, auth.userId, level, nextSheet, nextNotes || null]
  );

  return {
    ok: true,
    template: {
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      level: Number(updated.rows[0].level),
      updatedAt: toIso(updated.rows[0].updated_at)
    }
  };
}

module.exports = {
  linkCharacterToGame,
  getMyGameCharacter,
  patchMyGameCharacter,
  syncMyGameCharacterToTemplate
};
