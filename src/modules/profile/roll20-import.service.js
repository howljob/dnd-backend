/**
 * Перенос персонажа из Roll20 (PDF листа) — сверка со справочником и черновик персонажа.
 * Файл не сохраняется: разбирается в памяти, клиент получает черновик и открывает его
 * в листе несохранённым; сохраняет игрок сам обычным POST /api/profile/characters.
 */

const pool = require('../../db/pool');
const roll20 = require('./roll20-import');
const characterSheet = require('./character-sheet');

const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function loadClasses() {
  const { rows } = await pool.query(
    `SELECT name, name_en, payload->'meta'->>'hitDice' AS hit_dice, payload->'sections'->'subclasses' AS subclasses
       FROM wiki_classes
      WHERE is_published`
  );
  return rows.map((row) => ({
    name: row.name,
    nameEn: row.name_en || '',
    hitDice: row.hit_dice || '',
    subclasses: Array.isArray(row.subclasses) ? row.subclasses.filter((s) => typeof s === 'string') : []
  }));
}

/** Заклинания справочника по названиям из листа (русским или английским). */
async function loadSpells(names) {
  const keys = [...new Set(names.map((n) => roll20.norm(n)).filter(Boolean))];
  const map = new Map();
  if (!keys.length) return map;
  const { rows } = await pool.query(
    `SELECT name, name_en, payload->'data'->>'level' AS level
       FROM wiki_spells
      WHERE is_published
        AND (lower(translate(name, 'Ёё', 'Ее')) = ANY($1::text[])
             OR lower(name_en) = ANY($1::text[]))`,
    [keys]
  );
  for (const row of rows) {
    const level = Number(row.level);
    const entry = { name: row.name, level: Number.isInteger(level) && level >= 0 && level <= 9 ? level : 0 };
    map.set(roll20.norm(row.name), entry);
    if (row.name_en) map.set(roll20.norm(row.name_en), entry);
  }
  return map;
}

async function loadWeapons() {
  const { rows } = await pool.query(
    `SELECT w->>'name' AS name
       FROM wiki_inventory, jsonb_array_elements(payload->'data'->'weapons') AS w
      WHERE jsonb_typeof(payload->'data'->'weapons') = 'array'`
  );
  return rows.map((row) => row.name).filter(Boolean);
}

function isPdf(file) {
  if (!file || !file.buffer || !file.buffer.length) return false;
  return file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

async function importRoll20Pdf(file) {
  if (!file) {
    throw roll20.createHttpError(400, 'PDF file is required', 'PDF_REQUIRED');
  }
  if (file.size > MAX_PDF_BYTES) {
    throw roll20.createHttpError(400, 'PDF file is too large (max 10 MB)', 'FILE_TOO_LARGE');
  }
  if (!isPdf(file)) {
    throw roll20.createHttpError(400, 'File is not a PDF', 'NOT_PDF');
  }
  const extracted = await roll20.extractPdfPages(file.buffer);
  const raw = roll20.parseRoll20Pages(extracted);
  const spellNames = (raw.spells?.levels || []).flatMap((box) => box.names);
  const [classes, spells, weapons] = await Promise.all([loadClasses(), loadSpells(spellNames), loadWeapons()]);
  const draft = roll20.buildDraft(raw, { classes, spells, weapons });
  const c = draft.character;
  // Черновик сразу в том виде, в каком API отдаёт сохранённого персонажа: те же пределы и поля.
  c.name = c.name.slice(0, 120);
  c.className = c.className.slice(0, 120);
  c.race = c.race.slice(0, 120);
  c.background = c.background.slice(0, 300);
  c.campaignName = c.campaignName.slice(0, 180);
  c.sheet = characterSheet.normalizeSheet(c.sheet, c.level);
  return draft;
}

module.exports = {
  MAX_PDF_BYTES,
  importRoll20Pdf
};
