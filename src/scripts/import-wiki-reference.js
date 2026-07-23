const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const OUTPUT_DIR = process.env.WIKI_OUTPUT_DIR || 'C:/projects/dnd/output';
const ASSETS_WIKI_DIR = process.env.WIKI_ASSETS_DIR || 'C:/projects/dnd/assets/wiki';

const SECTION_CONFIG = [
  { section: 'spells', table: 'wiki_spells', file: 'spells-all.json' },
  { section: 'classes', table: 'wiki_classes', file: 'phb-classes-all.json' },
  { section: 'races', table: 'wiki_races', file: 'races-non-homebrew-all.json' },
  { section: 'backgrounds', table: 'wiki_backgrounds', file: 'backgrounds-non-homebrew-all.json' },
  { section: 'feats', table: 'wiki_feats', file: 'feats-non-homebrew-all.json' },
  { section: 'bestiary', table: 'wiki_bestiary', file: 'bestiary-non-homebrew-all.json' },
  { section: 'items', table: 'wiki_items', file: 'items-non-homebrew-all.json' }
];

function slugify(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/https?:\/\/5e14\.dnd\.su[^\s)"']*/gi, '')
    .replace(/window\.commentsAccess\s*=\s*\{[\s\S]*$/i, '')
    .replace(/\bКомментарии\b[\s\S]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Keep newlines for markdown bodies (wiki / character reference). */
function sanitizeWikiMarkdown(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/https?:\/\/5e14\.dnd\.su[^\s)"']*/gi, '')
    .replace(/window\.commentsAccess\s*=\s*\{[\s\S]*$/i, '')
    .replace(/\bКомментарии\b[\s\S]*$/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function removeLinksDeep(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(removeLinksDeep);
  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'url' || key === 'link' || key === 'article_html') continue;
    next[key] = removeLinksDeep(item);
  }
  return next;
}

function parseParams(paramsRaw) {
  if (!paramsRaw) return [];
  if (Array.isArray(paramsRaw)) return paramsRaw;
  if (typeof paramsRaw === 'object') return Object.values(paramsRaw);
  return [];
}

function pickByLabel(params, labels) {
  const needles = labels.map((v) => String(v || '').toLowerCase());
  for (const param of params) {
    const label = String(param?.label || param?.name || '').toLowerCase();
    if (!label) continue;
    if (needles.some((needle) => label.includes(needle))) {
      return sanitizeText(param?.value || '');
    }
  }
  return '';
}

function firstSentence(text) {
  const cleaned = sanitizeText(text);
  if (!cleaned) return '';
  const index = cleaned.indexOf('.');
  if (index === -1) return cleaned.slice(0, 240).trim();
  return cleaned.slice(0, Math.min(index + 1, 240)).trim();
}

function buildFilters(section, row) {
  const params = parseParams(row.params_json);
  const article = sanitizeText(row.article_text);
  const filters = {
    source: sanitizeText(row.source || '')
  };

  if (section === 'spells') {
    filters.level = sanitizeText(row.spell_level || row.level || '');
    filters.school = sanitizeText(row.school || '');
    filters.cast_time = sanitizeText(row.casting_time || row.cast_time || '');
    filters.range = sanitizeText(row.range || '');
    filters.components = sanitizeText(row.components || '');
    filters.duration = sanitizeText(row.duration || '');
    filters.classes = sanitizeText(row.classes || '');
    filters.subclasses = sanitizeText(row.subclasses || '');
    return filters;
  }

  if (section === 'classes') {
    filters.hit_dice = pickByLabel(params, ['кость хитов', 'hit dice']);
    filters.primary_ability = pickByLabel(params, ['основная характеристика', 'primary ability']);
    filters.armor = pickByLabel(params, ['доспех', 'armor']);
    filters.weapons = pickByLabel(params, ['оруж', 'weapon']);
    return filters;
  }

  if (section === 'races') {
    filters.size = pickByLabel(params, ['размер', 'size']);
    filters.speed = pickByLabel(params, ['скорость', 'speed']);
    filters.languages = pickByLabel(params, ['язык', 'language']);
    return filters;
  }

  if (section === 'backgrounds') {
    const skills = article.match(/Владение навыками:\s*([^\n.]+)/i)?.[1] || '';
    const tools = article.match(/Владение инструментами:\s*([^\n.]+)/i)?.[1] || '';
    const languages = article.match(/Владение языками:\s*([^\n.]+)/i)?.[1] || '';
    filters.skills = sanitizeText(skills);
    filters.tools = sanitizeText(tools);
    filters.languages = sanitizeText(languages);
    return filters;
  }

  if (section === 'feats') {
    const prerequisite = article.match(/Требование:\s*([^\n.]+)/i)?.[1] || '';
    filters.prerequisite = sanitizeText(prerequisite);
    return filters;
  }

  if (section === 'bestiary') {
    const firstLine = article.split('\n').find((line) => String(line || '').trim()) || '';
    const cr = article.match(/Опасность\s+([^\(\n]+)/i)?.[1] || '';
    filters.type = sanitizeText(firstLine);
    filters.challenge = sanitizeText(cr);
    return filters;
  }

  if (section === 'items') {
    const rarity = pickByLabel(params, ['редкость', 'rarity']);
    const attunement = pickByLabel(params, ['настройк', 'attunement']);
    const itemType = pickByLabel(params, ['тип', 'type']);
    filters.rarity = rarity;
    filters.attunement = attunement;
    filters.item_type = itemType;
    return filters;
  }

  return filters;
}

function sanitizeRow(section, row) {
  const cleaned = removeLinksDeep(row || {});
  const nameRu = sanitizeText(cleaned.name_ru || cleaned.name || '');
  const nameEn = sanitizeText(cleaned.name_en || '');
  const content = sanitizeText(cleaned.description || cleaned.article_text || '');
  const summary = firstSentence(content);
  const baseName = nameRu || nameEn || `entry-${Date.now()}`;
  const fallbackSlug = slugify(baseName, `${section}-${Math.random().toString(36).slice(2, 10)}`);
  const source = sanitizeText(cleaned.source || '');
  const filters = buildFilters(section, cleaned);

  return {
    slug: fallbackSlug,
    name: nameRu || nameEn || fallbackSlug,
    nameEn: nameEn || '',
    source,
    summary,
    content,
    filters,
    payload: cleaned
  };
}

function hasMarkdownFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath).some((f) => String(f).endsWith('.md'));
  } catch {
    return false;
  }
}

function trimMarkdownPreamble(md) {
  const lines = String(md || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t.startsWith('## ')) continue;
    if (t.includes('[') || t.includes('\\[')) {
      return lines.slice(i).join('\n');
    }
  }
  return md;
}

function parseNameFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    const mBracket = t.match(/^##\s+(.+?)\s*\[(.+?)\]\s*$/);
    if (mBracket) {
      return { name: sanitizeText(mBracket[1]), nameEn: sanitizeText(mBracket[2]) };
    }
    const mEsc = t.match(/^##\s+(.+?)\\\[(.+?)\\\]\s*$/);
    if (mEsc) {
      return { name: sanitizeText(mEsc[1]), nameEn: sanitizeText(mEsc[2]) };
    }
  }
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('# ') && !t.startsWith('## ') && t.length < 160) {
      const inner = t.replace(/^#\s+/, '').split(/[—–-]/)[0].trim();
      if (inner && !/DnD\.su/i.test(inner)) {
        return { name: sanitizeText(inner), nameEn: '' };
      }
    }
  }
  return { name: '', nameEn: '' };
}

function parseSourceFromMarkdown(md) {
  const full = String(md || '');
  const m =
    full.match(/\*?\*?Источник:\*?\*?\s*[«"]([^»"]+)[»"]/i)
    || full.match(/\*\*Источник:\*\*\s*«([^»]+)»/i)
    || full.match(/Источник:\s*[«"]([^»"]+)[»"]/i);
  return sanitizeText(m?.[1] || '');
}

function parseMarkdownWikiEntry(section, slug, rawMd) {
  const trimmed = trimMarkdownPreamble(rawMd);
  const { name, nameEn } = parseNameFromMarkdown(trimmed);
  const source = parseSourceFromMarkdown(rawMd);
  const content = sanitizeWikiMarkdown(trimmed);
  const baseName = name || nameEn || slug;
  const summary = firstSentence(sanitizeText(trimmed.slice(0, 4000)));
  const filters = buildFilters(section, {
    article_text: trimmed.slice(0, 120000),
    params_json: [],
    source
  });

  return {
    slug: slugify(slug, slug),
    name: baseName,
    nameEn: nameEn || '',
    source,
    summary: summary || firstSentence(content),
    content,
    filters,
    payload: {
      slugFile: slug,
      contentFormat: 'markdown'
    }
  };
}

function resolveSectionFilePath(config) {
  // Prefer frontend-parity datasets that live in assets/wiki when available.
  // This guarantees backend parity with current frontend behavior for sections
  // that were temporarily frontend-local due to data quality differences.
  if (config.section === 'spells') {
    const assetsPath = path.join(ASSETS_WIKI_DIR, 'spells', 'spells-all.json');
    if (fs.existsSync(assetsPath)) {
      return { kind: 'json-array', filePath: assetsPath };
    }
  }

  if (config.section === 'classes') {
    const dir = path.join(ASSETS_WIKI_DIR, 'classes');
    if (fs.existsSync(dir) && hasMarkdownFiles(dir)) {
      return { kind: 'md-dir', assetsDir: dir };
    }
  }

  if (config.section === 'races') {
    const dir = path.join(ASSETS_WIKI_DIR, 'races');
    if (fs.existsSync(dir) && hasMarkdownFiles(dir)) {
      return { kind: 'md-dir', assetsDir: dir };
    }
  }

  if (config.section === 'backgrounds') {
    const indexPath = path.join(ASSETS_WIKI_DIR, 'backgrounds', 'index.json');
    if (fs.existsSync(indexPath)) {
      return { kind: 'assets-index', filePath: indexPath, assetsDir: path.join(ASSETS_WIKI_DIR, 'backgrounds') };
    }
  }

  if (config.section === 'feats') {
    const indexPath = path.join(ASSETS_WIKI_DIR, 'feats', 'index.json');
    if (fs.existsSync(indexPath)) {
      return { kind: 'assets-index', filePath: indexPath, assetsDir: path.join(ASSETS_WIKI_DIR, 'feats') };
    }
  }

  const outputPath = path.join(OUTPUT_DIR, config.file);
  if (fs.existsSync(outputPath)) {
    return { kind: 'json-array', filePath: outputPath };
  }

  return null;
}

function normalizeFromAssetsIndex(section, item, mdContent) {
  const name = sanitizeText(item?.name || '');
  const nameEn = sanitizeText(item?.nameEn || '');
  const source = sanitizeText(item?.source || '');
  const summary = sanitizeText(item?.summary || '');
  const content = sanitizeWikiMarkdown(mdContent || '');
  const slug = sanitizeText(item?.slug || '') || slugify(name || nameEn, `${section}-${Math.random().toString(36).slice(2, 10)}`);

  return {
    slug,
    name: name || nameEn || slug,
    nameEn,
    source,
    summary: summary || firstSentence(sanitizeText(content.slice(0, 4000))),
    content,
    filters: buildFilters(section, {
      article_text: content.slice(0, 120000),
      params_json: [],
      source
    }),
    payload: { ...removeLinksDeep(item || {}), contentFormat: 'markdown' }
  };
}

async function importSection(client, config) {
  const resolved = resolveSectionFilePath(config);
  if (!resolved) {
    throw new Error(`File not found for section "${config.section}". Checked: OUTPUT_DIR="${OUTPUT_DIR}", ASSETS_WIKI_DIR="${ASSETS_WIKI_DIR}"`);
  }

  await client.query(`TRUNCATE ${config.table} RESTART IDENTITY;`);

  let imported = 0;

  if (resolved.kind === 'json-array') {
    const rows = parseJsonFile(resolved.filePath);
    if (!Array.isArray(rows)) {
      throw new Error(`Invalid JSON structure in ${resolved.filePath}`);
    }

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index];
      if (raw?.error) continue;
      const normalized = sanitizeRow(config.section, raw);
      const slug = `${normalized.slug}-${index + 1}`;

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO ${config.table} (slug, name, name_en, source, summary, content, filters, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug)
         DO UPDATE
         SET name = EXCLUDED.name,
             name_en = EXCLUDED.name_en,
             source = EXCLUDED.source,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             filters = EXCLUDED.filters,
             payload = EXCLUDED.payload,
             updated_at = now()`,
        [
          slug,
          normalized.name,
          normalized.nameEn,
          normalized.source,
          normalized.summary,
          normalized.content,
          normalized.filters,
          normalized.payload
        ]
      );
      imported += 1;
    }

    return imported;
  }

  if (resolved.kind === 'md-dir') {
    const files = fs
      .readdirSync(resolved.assetsDir)
      .filter((f) => String(f).toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b, 'ru'));

    for (const file of files) {
      const slug = path.basename(file, path.extname(file));
      const mdPath = path.join(resolved.assetsDir, file);
      const md = safeReadText(mdPath);
      if (!String(md || '').trim()) continue;

      const normalized = parseMarkdownWikiEntry(config.section, slug, md);

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO ${config.table} (slug, name, name_en, source, summary, content, filters, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug)
         DO UPDATE
         SET name = EXCLUDED.name,
             name_en = EXCLUDED.name_en,
             source = EXCLUDED.source,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             filters = EXCLUDED.filters,
             payload = EXCLUDED.payload,
             updated_at = now()`,
        [
          normalized.slug,
          normalized.name,
          normalized.nameEn,
          normalized.source,
          normalized.summary,
          normalized.content,
          normalized.filters,
          normalized.payload
        ]
      );
      imported += 1;
    }

    return imported;
  }

  if (resolved.kind === 'assets-index') {
    const indexData = parseJsonFile(resolved.filePath);
    const items = Array.isArray(indexData?.items) ? indexData.items : [];
    if (!items.length) {
      throw new Error(`Invalid assets index structure in ${resolved.filePath}`);
    }

    for (const item of items) {
      const slug = String(item?.slug || '').trim();
      if (!slug) continue;
      const mdPath = path.join(resolved.assetsDir, `${slug}.md`);
      const md = safeReadText(mdPath);
      const normalized = normalizeFromAssetsIndex(config.section, item, md);

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO ${config.table} (slug, name, name_en, source, summary, content, filters, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug)
         DO UPDATE
         SET name = EXCLUDED.name,
             name_en = EXCLUDED.name_en,
             source = EXCLUDED.source,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             filters = EXCLUDED.filters,
             payload = EXCLUDED.payload,
             updated_at = now()`,
        [
          normalized.slug,
          normalized.name,
          normalized.nameEn,
          normalized.source,
          normalized.summary,
          normalized.content,
          normalized.filters,
          normalized.payload
        ]
      );
      imported += 1;
    }

    return imported;
  }

  throw new Error(`Unsupported import kind for section "${config.section}"`);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = {};

    for (const config of SECTION_CONFIG) {
      // eslint-disable-next-line no-await-in-loop
      const count = await importSection(client, config);
      stats[config.section] = count;
    }

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log('Wiki reference import completed:', stats);
  } catch (error) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Wiki reference import failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
