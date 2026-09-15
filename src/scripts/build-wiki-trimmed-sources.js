/**
 * Формирует урезанные источники бестиария и магических предметов для вики
 * из «сырых» дампов dnd.su (WIKI_OUTPUT_DIR) и кладёт их в assets/wiki
 * фронтенда (WIKI_ASSETS_DIR): bestiary/bestiary-all.json, items/items-all.json.
 *
 * Зачем: сырые дампы (~19 МБ + ~3 МБ) лежат вне git (output/ в .gitignore),
 * а импортёру нужен стабильный источник разумного размера внутри репозитория.
 * Оставляем только нужные импортёру поля: slug, имя, источник, описание и
 * характеристики. Никакого article_html и служебных полей скрапера.
 *
 * ИЗВЕСТНЫЙ ДЕФЕКТ ДАННЫХ и принятое решение:
 * в дампах поля name_ru/name_en почти всегда мусорные — скрапер захватывал
 * текст случайной ссылки со страницы (например, name_ru «Невидимость» при
 * url .../100-ancient-green-dragon/). Надёжные источники имени:
 *   - предметы: заголовок «Название [English name]» в начале article_text
 *     (932 из 934 записей); запасной вариант — слаг из url;
 *   - бестиарий: русского имени в дампе нет вообще (article_text начинается
 *     сразу со статблока), поэтому имя строится из слага url
 *     («ancient-green-dragon» → «Ancient green dragon»). Поле name_ru из
 *     дампа НЕ используется никогда.
 *
 * Запуск:
 *   WIKI_OUTPUT_DIR=C:/projects/dnd/output \
 *   WIKI_ASSETS_DIR=C:/projects/wt/t7-dnd/assets/wiki \
 *   node src/scripts/build-wiki-trimmed-sources.js
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = process.env.WIKI_OUTPUT_DIR || 'C:/projects/dnd/output';
const ASSETS_WIKI_DIR = process.env.WIKI_ASSETS_DIR || 'C:/projects/dnd/assets/wiki';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

/** Обрезает служебный хвост dnd.su: скрипт комментариев и сами комментарии. */
function cutTail(text) {
  return String(text || '')
    .replace(/window\.commentsAccess\s*=\s*\{[\s\S]*$/i, '')
    .replace(/(^|\n)[ \t]*Комментарии[ \t]*(?=\n|$)[\s\S]*$/, '$1')
    .replace(/(^|\n)[ \t]*Авторизуйтесь, чтобы оставлять комментарии\.?[\s\S]*$/, '$1');
}

function cleanText(text) {
  return cutTail(text)
    .replace(/https?:\/\/5e14\.dnd\.su[^\s)"']*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugFromUrl(url) {
  const m = String(url || '').match(/\/(\d+)-([a-z0-9][a-z0-9-]*)\/?\s*$/i);
  if (!m) return null;
  return { id: m[1], slug: m[2].toLowerCase() };
}

function humanizeSlug(slug) {
  const words = String(slug || '').split('-').filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** «Название [English]» в начале article_text предмета. */
function parseItemNameHeader(articleText) {
  const head = String(articleText || '').slice(0, 1200);
  const m = head.match(/([А-ЯЁ][^\n[\]]{0,120}?)\s*\[([A-Za-z][^\]\n]{0,120})\]/);
  if (!m) return null;
  return { nameRu: m[1].trim(), nameEn: m[2].trim() };
}

function parseSource(articleText) {
  const m = String(articleText || '').match(/Источник:?\s*«([^»]{2,80})»/i);
  return m ? m[1].trim() : '';
}

function buildBestiary(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (row?.error) continue;
    const u = slugFromUrl(row.url);
    if (!u) continue;
    let slug = u.slug;
    if (seen.has(slug)) slug = `${slug}-${u.id}`;
    seen.add(slug);

    const description = cleanText(row.article_text);
    if (!description) continue;

    const nameEn = humanizeSlug(u.slug);
    const firstLine = description.split('\n').find((l) => l.trim()) || '';
    const challenge = description.match(/Опасность\s+([^(\n]+)/i)?.[1]?.trim() || '';

    out.push({
      slug,
      name: nameEn, // русского имени в дампе нет — см. шапку файла
      name_en: nameEn,
      source: String(row.source || '').trim() || parseSource(row.article_text),
      description,
      filters: {
        type: firstLine.trim().slice(0, 120),
        challenge
      }
    });
  }
  return out;
}

function buildItems(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (row?.error) continue;
    const u = slugFromUrl(row.url);
    if (!u) continue;
    let slug = u.slug;
    if (seen.has(slug)) slug = `${slug}-${u.id}`;
    seen.add(slug);

    const header = parseItemNameHeader(row.article_text);
    const nameEn = header?.nameEn || humanizeSlug(u.slug);
    const name = header?.nameRu || nameEn;

    // Коды книг сразу после «Название [English]»: «DMG14 DMG24» и т.п.
    const codesMatch = String(row.article_text || '')
      .slice(0, 1400)
      .match(/\]\s*((?:[A-Z]{2,5}\d{2}\s*)+)/);
    const sourceCodes = codesMatch
      ? codesMatch[1].trim().split(/\s+/).join(', ')
      : '';

    let description = cleanText(row.article_text);
    if (!description) continue;
    // Убираем навигационную шапку до строки «Название [English]».
    if (header) {
      const idx = description.indexOf(`${header.nameRu}`);
      if (idx > 0) description = description.slice(idx).trim();
    }
    description = description.replace(/(^|\n)[ \t]*Распечатать[ \t]*(?=\n|$)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();

    // «Кольцо, редкое (требуется настройка)» — тип/редкость/настройка.
    const typeLine = description.split('\n')
      .map((l) => l.trim())
      .find((l) => /(обычн|необычн|редк|легендарн|артефакт)/i.test(l) && l.length < 160) || '';
    const rarity = typeLine.match(/(очень редк\w*|обычн\w*|необычн\w*|редк\w*|легендарн\w*|артефакт)/i)?.[1] || '';
    const attunement = /настройк/i.test(typeLine) ? 'требуется настройка' : '';
    const itemType = typeLine.split(',')[0]?.trim().slice(0, 60) || '';

    out.push({
      slug,
      name,
      name_en: nameEn,
      source: String(row.source || '').trim() || parseSource(row.article_text) || sourceCodes,
      description,
      filters: {
        item_type: itemType,
        rarity: rarity.toLowerCase(),
        attunement
      }
    });
  }
  return out;
}

function writeDataset(dirName, fileName, data) {
  const dir = path.join(ASSETS_WIKI_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  // Одна запись — одна строка: компактно и диффы по записям читаемы.
  const body = `[\n${data.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;
  fs.writeFileSync(filePath, body, 'utf8');
  const sizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`${filePath}: ${data.length} записей, ${sizeMb} МБ`);
}

function run() {
  const bestiaryRaw = readJson(path.join(OUTPUT_DIR, 'bestiary-non-homebrew-all.json'));
  const itemsRaw = readJson(path.join(OUTPUT_DIR, 'items-non-homebrew-all.json'));

  writeDataset('bestiary', 'bestiary-all.json', buildBestiary(bestiaryRaw));
  writeDataset('items', 'items-all.json', buildItems(itemsRaw));
}

if (require.main === module) {
  run();
}

module.exports = { cutTail, cleanText, slugFromUrl, humanizeSlug, parseItemNameHeader };
