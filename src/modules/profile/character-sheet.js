/**
 * T5.1 — серверная нормализация и валидация листа персонажа (jsonb-колонка
 * user_characters.sheet). Ключевые поля (abilities, skills, saves, level, hp,
 * spells) валидируются жёстко: неверный тип — ошибка 400, значения зажимаются
 * в допустимые диапазоны.
 *
 * Используется profile.service (шаблон) и game-characters.service (копии).
 */

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const SKILL_IDS = [
  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
  'history', 'insight', 'intimidation', 'investigation', 'medicine',
  'nature', 'perception', 'performance', 'persuasion', 'religion',
  'sleight_of_hand', 'stealth', 'survival'
];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function cappedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isDataImageUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
}

function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl.trim());
  if (!match) return 0;
  const base64 = (match[2] || '').replace(/\s+/g, '');
  if (!base64.length) return 0;
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Нормализация листа с клиента. `level` передаётся отдельно (колонка) и
 * дублируется строкой в sheet.level для SQL-фильтров.
 *
 * Портреты в лист с клиента не принимаются: поля portrait/legacyPortrait
 * отбрасываются (файлы портретов — отдельный эндпойнт, T5.2). Легаси-портрет
 * из БД сохраняет вызывающая сторона через preservedLegacyPortrait.
 */
function normalizeSheet(rawSheet, level, options = {}) {
  const source = rawSheet && typeof rawSheet === 'object' && !Array.isArray(rawSheet) ? rawSheet : {};

  if (rawSheet !== null && typeof rawSheet !== 'undefined'
    && (typeof rawSheet !== 'object' || Array.isArray(rawSheet))) {
    throw createHttpError(400, 'Sheet must be an object');
  }

  // --- ключевые поля: строгая проверка типов ---
  if (typeof source.abilities !== 'undefined'
    && (typeof source.abilities !== 'object' || source.abilities === null || Array.isArray(source.abilities))) {
    throw createHttpError(400, 'Sheet abilities must be an object');
  }
  if (typeof source.skillProficiencies !== 'undefined'
    && (typeof source.skillProficiencies !== 'object' || source.skillProficiencies === null || Array.isArray(source.skillProficiencies))) {
    throw createHttpError(400, 'Sheet skills must be an object');
  }
  if (typeof source.saveThrowProficiencies !== 'undefined'
    && (typeof source.saveThrowProficiencies !== 'object' || source.saveThrowProficiencies === null || Array.isArray(source.saveThrowProficiencies))) {
    throw createHttpError(400, 'Sheet saves must be an object');
  }
  if (typeof source.spells !== 'undefined' && !Array.isArray(source.spells)) {
    throw createHttpError(400, 'Sheet spells must be an array');
  }
  if (typeof source.combat !== 'undefined'
    && (typeof source.combat !== 'object' || source.combat === null || Array.isArray(source.combat))) {
    throw createHttpError(400, 'Sheet combat must be an object');
  }

  const abilities = {};
  for (const key of ABILITY_KEYS) {
    abilities[key] = clampInt(source.abilities?.[key], 1, 30, 10);
  }

  const skillProficiencies = {};
  for (const id of SKILL_IDS) {
    skillProficiencies[id] = Boolean(source.skillProficiencies?.[id]);
  }

  const saveThrowProficiencies = {};
  for (const key of ABILITY_KEYS) {
    saveThrowProficiencies[key] = Boolean(source.saveThrowProficiencies?.[key]);
  }

  const combatSource = source.combat || {};
  const hpMax = clampInt(combatSource.hpMax, 1, 999, 10);
  const combat = {
    armorClass: clampInt(combatSource.armorClass, 0, 99, 10),
    initiative: clampInt(combatSource.initiative, -20, 20, 0),
    speed: clampInt(combatSource.speed, 0, 120, 30),
    hpCurrent: clampInt(combatSource.hpCurrent, 0, 999, hpMax),
    hpMax,
    tempHp: clampInt(combatSource.tempHp, 0, 999, 0),
    hitDice: cappedText(combatSource.hitDice || '1d10', 50)
  };

  const spells = (Array.isArray(source.spells) ? source.spells : [])
    .map((item) => {
      if (typeof item === 'string') {
        return { name: cappedText(item, 160) };
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw createHttpError(400, 'Sheet spell entry must be an object');
      }
      return {
        name: cappedText(item.name, 160),
        type: cappedText(item.type, 120),
        castingTime: cappedText(item.castingTime, 80),
        range: cappedText(item.range, 80),
        components: cappedText(item.components, 120),
        duration: cappedText(item.duration, 80),
        description: cappedText(item.description, 1000)
      };
    })
    .filter((item) => item.name)
    .slice(0, 40)
    .map((item) => ({
      name: item.name,
      type: item.type || '',
      castingTime: item.castingTime || '',
      range: item.range || '',
      components: item.components || '',
      duration: item.duration || '',
      description: item.description || ''
    }));

  const equipment = (Array.isArray(source.equipment) ? source.equipment : [])
    .map((item) => cappedText(item, 300))
    .filter(Boolean)
    .slice(0, 30);

  const personalitySource = source.personality && typeof source.personality === 'object' && !Array.isArray(source.personality)
    ? source.personality
    : {};

  const sheet = {
    sheetVersion: 2,
    level: String(clampInt(level, 1, 20, 1)),
    alignment: cappedText(source.alignment, 120),
    experience: clampInt(source.experience, 0, 999999, 0),
    proficiencyBonus: clampInt(source.proficiencyBonus, -2, 10, 2),
    inspiration: Boolean(source.inspiration),
    abilities,
    skillProficiencies,
    saveThrowProficiencies,
    combat,
    equipment,
    spells,
    personality: {
      traits: cappedText(personalitySource.traits, 500),
      ideals: cappedText(personalitySource.ideals, 500),
      bonds: cappedText(personalitySource.bonds, 500),
      flaws: cappedText(personalitySource.flaws, 500)
    }
  };

  // Легаси-портрет сохраняется только сервером (из БД), с клиента — никогда.
  const preserved = options.preservedLegacyPortrait;
  if (isDataImageUrl(preserved) && estimateDataUrlBytes(preserved) <= 2 * 1024 * 1024) {
    sheet.legacyPortrait = preserved;
  }

  return sheet;
}

/**
 * Чтение старого формата (sheetVersion:1 JSON в notes) — обратная
 * совместимость: строки, вставленные напрямую в старом виде, открываются без
 * потерь. Возвращает { sheet, notes } или null, если notes — не легаси-JSON.
 */
function sheetFromLegacyNotes(notes, level) {
  const raw = String(notes || '').trim();
  if (!raw.startsWith('{')) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!('sheetVersion' in parsed)) return null;

  const legacyPortrait = isDataImageUrl(parsed.portrait) ? parsed.portrait : null;
  const sheet = normalizeSheet(parsed, level, { preservedLegacyPortrait: legacyPortrait });
  return {
    sheet,
    notes: String(parsed.freeNotes || '').slice(0, 4000)
  };
}

module.exports = {
  ABILITY_KEYS,
  SKILL_IDS,
  createHttpError,
  clampInt,
  cappedText,
  isDataImageUrl,
  estimateDataUrlBytes,
  normalizeSheet,
  sheetFromLegacyNotes
};
