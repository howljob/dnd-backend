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
/** Формула костей как её понимает движок бросков стола: «2d6+3», «1d20-1», «1d8+1d6+2». */
const DICE_FORMULA_RE = /^(\d{0,2}d\d{1,4}|\d{1,4})([+-](\d{0,2}d\d{1,4}|\d{1,4})){0,9}$/i;

function normalizeDiceFormula(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/к/g, 'd');
  if (!text || text.length > 60 || !DICE_FORMULA_RE.test(text) || !/d/.test(text)) return '';
  return text;
}

/**
 * Свои формулы оружия: объект «название → { hit, damage }», до 30 записей;
 * пустые и некорректные формулы отбрасываются, запись без формул не хранится.
 */
function normalizeWeaponOverrides(raw) {
  if (raw === null || typeof raw === 'undefined') return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw createHttpError(400, 'Sheet weaponOverrides must be an object');
  }
  const result = {};
  for (const [key, value] of Object.entries(raw).slice(0, 60)) {
    const name = cappedText(key, 300);
    if (!name || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const hit = normalizeDiceFormula(value.hit);
    const damage = normalizeDiceFormula(value.damage);
    if (!hit && !damage) continue;
    result[name] = { ...(hit ? { hit } : {}), ...(damage ? { damage } : {}) };
    if (Object.keys(result).length >= 30) break;
  }
  return result;
}

/**
 * Избранные броски (звёздочка в листе → вкладка «Персонаж» на столе): { type, key }.
 * type — что бросаем; key — характеристика, навык или название оружия/атаки/заклинания.
 */
const FAVORITE_TYPES = new Set(['check', 'save', 'skill', 'initiative', 'hitdie', 'spellattack', 'weapon', 'attack', 'spell']);
const FAVORITES_MAX = 40;

function normalizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const type = String(item.type || '');
    if (!FAVORITE_TYPES.has(type)) continue;
    let key = cappedText(item.key, 160);
    if (type === 'check' || type === 'save') {
      if (!ABILITY_KEYS.includes(key)) continue;
    } else if (type === 'skill') {
      if (!SKILL_IDS.includes(key)) continue;
    } else if (['initiative', 'hitdie', 'spellattack'].includes(type)) {
      key = '';
    } else if (!key) {
      continue;
    }
    const id = `${type}:${key.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ type, key });
    if (out.length >= FAVORITES_MAX) break;
  }
  return out;
}

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
  const deathSource = combatSource.deathSaves && typeof combatSource.deathSaves === 'object' && !Array.isArray(combatSource.deathSaves)
    ? combatSource.deathSaves
    : {};
  const combat = {
    armorClass: clampInt(combatSource.armorClass, 0, 99, 10),
    initiative: clampInt(combatSource.initiative, -20, 20, 0),
    speed: clampInt(combatSource.speed, 0, 120, 30),
    hpCurrent: clampInt(combatSource.hpCurrent, 0, 999, hpMax),
    hpMax,
    tempHp: clampInt(combatSource.tempHp, 0, 999, 0),
    hitDice: cappedText(combatSource.hitDice || '1d10', 50),
    // Потраченные кости хитов (короткий отдых) и спасброски от смерти — игровые поля первой страницы листа.
    hitDiceUsed: clampInt(combatSource.hitDiceUsed, 0, 20, 0),
    deathSaves: {
      successes: clampInt(deathSource.successes, 0, 3, 0),
      failures: clampInt(deathSource.failures, 0, 3, 0)
    }
  };

  /** Уровень заклинания: число 0–9 либо разбор строки «3 уровень» / «заговор» из старых записей. */
  const spellLevelOf = (item) => {
    if (Number.isFinite(Number(item.level)) && item.level !== '' && item.level !== null) {
      return clampInt(item.level, 0, 9, 0);
    }
    const typeText = String(item.type || '').toLowerCase();
    if (/заговор|cantrip/.test(typeText)) return 0;
    const m = typeText.match(/(\d)/);
    return m ? clampInt(m[1], 0, 9, 0) : 0;
  };

  const spells = (Array.isArray(source.spells) ? source.spells : [])
    .map((item) => {
      if (typeof item === 'string') {
        return { name: cappedText(item, 160), level: 0, prepared: false };
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
        description: cappedText(item.description, 1000),
        level: spellLevelOf(item),
        prepared: Boolean(item.prepared)
      };
    })
    .filter((item) => item.name)
    .slice(0, 120)
    .map((item) => ({
      name: item.name,
      type: item.type || '',
      castingTime: item.castingTime || '',
      range: item.range || '',
      components: item.components || '',
      duration: item.duration || '',
      description: item.description || '',
      level: item.level,
      prepared: item.prepared
    }));

  // Третья страница листа: класс заклинателя, базовая характеристика, ячейки по кругам (итого / потрачено).
  const castingSource = source.spellcasting && typeof source.spellcasting === 'object' && !Array.isArray(source.spellcasting)
    ? source.spellcasting
    : {};
  const castAbility = String(castingSource.ability || '').toLowerCase();
  const spellcasting = {
    className: cappedText(castingSource.className, 120),
    ability: ['int', 'wis', 'cha'].includes(castAbility) ? castAbility : ''
  };
  const slotsSource = source.spellSlots && typeof source.spellSlots === 'object' && !Array.isArray(source.spellSlots)
    ? source.spellSlots
    : {};
  const spellSlots = {};
  for (let lvl = 1; lvl <= 9; lvl += 1) {
    const row = slotsSource[lvl] && typeof slotsSource[lvl] === 'object' ? slotsSource[lvl] : {};
    const total = clampInt(row.total, 0, 20, 0);
    spellSlots[lvl] = { total, used: clampInt(row.used, 0, 20, 0) };
  }

  // Таблица «Атаки и заклинания» (строки, добавленные руками): название, бонус атаки, урон/вид.
  if (typeof source.attacks !== 'undefined' && !Array.isArray(source.attacks)) {
    throw createHttpError(400, 'Sheet attacks must be an array');
  }
  const attacks = (Array.isArray(source.attacks) ? source.attacks : [])
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      return {
        name: cappedText(item.name, 120),
        bonus: cappedText(item.bonus, 40),
        damage: cappedText(item.damage, 80)
      };
    })
    .filter((item) => item && (item.name || item.bonus || item.damage))
    .slice(0, 20);

  // Кошелёк: медные, серебряные, электрумовые, золотые, платиновые.
  const moneySource = source.money && typeof source.money === 'object' && !Array.isArray(source.money) ? source.money : {};
  const money = {};
  for (const coin of ['cp', 'sp', 'ep', 'gp', 'pp']) {
    money[coin] = clampInt(moneySource[coin], 0, 999999, 0);
  }

  // Вторая страница: внешность, союзники и организации, особенности, сокровища.
  const appearanceSource = source.appearance && typeof source.appearance === 'object' && !Array.isArray(source.appearance)
    ? source.appearance
    : {};
  const appearance = {};
  for (const key of ['age', 'height', 'weight', 'eyes', 'skin', 'hair']) {
    appearance[key] = cappedText(appearanceSource[key], 60);
  }
  const alliesSource = source.allies && typeof source.allies === 'object' && !Array.isArray(source.allies) ? source.allies : {};
  const allies = {
    text: cappedText(alliesSource.text, 3000),
    orgName: cappedText(alliesSource.orgName, 160),
    symbol: cappedText(alliesSource.symbol, 40)
  };

  const equipment = (Array.isArray(source.equipment) ? source.equipment : [])
    .map((item) => cappedText(item, 300))
    .filter(Boolean)
    .slice(0, 30);

  const personalitySource = source.personality && typeof source.personality === 'object' && !Array.isArray(source.personality)
    ? source.personality
    : {};

  // Свои формулы попадания/урона для оружия из листа (шестерёнка у кнопки «Урон» за столом):
  // { "Секира Гурта": { hit: "1d20+6", damage: "3d12+4" } }. Ключ — название строки снаряжения.
  const weaponOverrides = normalizeWeaponOverrides(source.weaponOverrides);

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
    },
    weaponOverrides,
    // Первая страница официального листа: владения и языки, умения и способности, атаки, кошелёк.
    proficienciesLanguages: cappedText(source.proficienciesLanguages, 2000),
    featuresTraits: cappedText(source.featuresTraits, 4000),
    attacks,
    money,
    // Вторая страница.
    appearance,
    allies,
    additionalFeatures: cappedText(source.additionalFeatures, 4000),
    treasure: cappedText(source.treasure, 4000),
    // Третья страница.
    spellcasting,
    spellSlots,
    favorites: normalizeFavorites(source.favorites)
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
