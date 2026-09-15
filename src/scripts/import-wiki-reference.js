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

/**
 * ВАЖНО: в JS «\b» не работает на кириллице (граница слова определяется только
 * по [A-Za-z0-9_]), поэтому старые регэкспы вида /\bКомментарии\b/ не находили
 * секцию комментариев dnd.su и в контент классов попадало ~3400 строк мусора.
 * Обрезаем по началу строки: строка целиком «Комментарии» (или заголовок
 * «## Комментарии») и всё после неё удаляются.
 */
function sanitizeText(value) {
  return String(value || '')
    .replace(/https?:\/\/5e14\.dnd\.su[^\s)"']*/gi, '')
    .replace(/window\.commentsAccess\s*=\s*\{[\s\S]*$/i, '')
    .replace(/(^|\n)[ \t]*#{0,6}[ \t]*Комментарии[ \t]*(?=\n|$)[\s\S]*$/, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Скрапер dnd.su склеивал в шапках таблиц название колонки с её сокращением
 * из <span> («Уровень» + «ур» → «Уровеньур»), а местами терял пробелы между
 * словами. Автоматически разделить нельзя (сокращение — то инициалы, то
 * префикс), поэтому — словарь всех склеек из 13 классовых таблиц.
 */
const GLUED_TABLE_HEADERS = [
  ['Уровеньур', 'Уровень'],
  ['Бонусмастерствабм', 'Бонус мастерства'],
  ['Боевыеискусстваби', 'Боевые искусства'],
  ['Очкицици', 'Очки ци'],
  ['Скорость бездоспеховбд', 'Скорость без доспехов'],
  ['Единицычародействаеч', 'Единицы чародейства'],
  ['Скрытаяатакаса', 'Скрытая атака'],
  ['Известныезаговорыиз', 'Известные заговоры'],
  ['ИзвестныезаклинанияиЗ', 'Известные заклинания'],
  ['Известныезаклинанияиз', 'Известные заклинания'],
  ['Ячейки заклинаний на уровень заклинанийячейки', 'Ячейки заклинаний на уровень заклинаний'],
  ['ЯчейкизаклинанийяЗ', 'Ячейки заклинаний'],
  ['Уровеньячеекуя', 'Уровень ячеек'],
  ['Известныевоззванияив', 'Известные воззвания'],
  ['Известныеинфузииии', 'Известные инфузии'],
  ['Инфузиипредметовип', 'Инфузии предметов'],
  ['Яростькя', 'Ярость'],
  ['Урон яростиуя', 'Урон ярости'],
  ['Неограниченно∞', 'Неограниченно']
];

function fixGluedTableHeaders(text) {
  let result = String(text || '');
  for (const [glued, fixed] of GLUED_TABLE_HEADERS) {
    result = result.split(glued).join(fixed);
  }
  return result;
}

/** Keep newlines for markdown bodies (wiki / character reference). */
function sanitizeWikiMarkdown(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/https?:\/\/5e14\.dnd\.su[^\s)"']*/gi, '')
    .replace(/window\.commentsAccess\s*=\s*\{[\s\S]*$/i, '')
    .replace(/(^|\n)[ \t]{0,3}#{0,6}[ \t]*Комментарии[ \t]*(?=\n|$)[\s\S]*$/, '$1')
    .replace(/(^|\n)[ \t]{0,3}#{1,6}[ \t]*Галерея[ \t]*(?=\n|$)[\s\S]*$/, '$1')
    .replace(/(^|\n)[ \t]*\*?[ \t]*Распечатать[ \t]*(?=\n|$)/g, '$1')
    // Мусорные коды источников, приклеенные к концу заголовка после «]» или
    // прямо к кириллице: «\[Primal striker\]HB HB:GH», «Рой паразитовHB HB:GH»
    .replace(/(\\\]|\]|[а-яё])((?:[A-Z]{2,4}(?::[A-Z]{2,4})?)(?:[ \t]+[A-Z]{2,4}(?::[A-Z]{2,4})?)*)[ \t]*(?=\n|$)/g, '$1')
    // Лесенка характеристик статблоков: «Сил ⏎ 15 (**+2**)» → «**Сил** 15 (**+2**)»
    .replace(
      /(^|\n)\*?[ \t]*(Сил|Лов|Тел|Инт|Мдр|Хар)[ \t]*\n+[ \t]*(\d+[ \t]*\(\*{0,2}\\?[+\-−]?\d+\*{0,2}\))/g,
      '$1**$2** $3'
    )
    .replace(/[ \t]+\n/g, '\n')
    .split('\n').map((line) => (line.includes('|') ? fixGluedTableHeaders(line) : line)).join('\n')
    .trim();
}

/**
 * Краткое описание из markdown: первый «обычный» абзац без заголовков,
 * списков, цитат, таблиц и служебных строк dnd.su («Распечатать»,
 * «Источник: …») — чтобы в карточку не попадали символы разметки.
 */
function extractPlainSummarySource(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      if (out.length) break; // конец первого абзаца
      continue;
    }
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^[>*|+-]/.test(t)) continue;
    if (/^\d+[.)]\s/.test(t)) continue;
    if (/^Распечатать$/i.test(t)) continue;
    if (/^\*{0,2}Источник/i.test(t)) continue;
    out.push(t);
    if (out.join(' ').length > 500) break;
  }
  return sanitizeText(out.join(' ').replace(/\*\*|`|\\([[\]])/g, '$1'));
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
  for (const rawLine of lines) {
    // «## Варвар \[Barbarian\]» → «## Варвар [Barbarian]»
    const t = rawLine.trim().replace(/\\([[\]])/g, '$1');
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

/**
 * Разбор структуры классового .md для оглавления на фронте.
 * Возвращает { toc, levelTable, features, subclasses }:
 *  - toc: все H2 (+H3-умения) с классификацией kind:
 *      main       — «## Варвар [Barbarian]» (основной заголовок)
 *      features   — «## Классовые умения»
 *      feature    — H3-умение внутри «Классовых умений» («### ЯРОСТЬ»)
 *      group      — заголовок-группа («## Пути дикости», «## Unearthed Arcana…»)
 *      subclass   — конкретный подкласс («## Путь берсерка»)
 *      section    — прочие разделы («## Углублённая предыстория…»)
 *  - levelTable: markdown первой GFM-таблицы, в шапке которой есть «Уровень»
 *    (таблица уровней класса).
 * Внимание: «\b» с кириллицей в JS не работает — ключевые слова ищем как
 * подстроки во множественном числе («домены», «архетипы»), единственное число
 * в названиях подклассов («Домен бури») под них не попадает.
 */
const CLASS_GROUP_RE = /(unearthed arcana|homebrew|из «|пути дикости|домены|традиции|покровители|специализации|коллегии|архетипы|клятвы|происхождения|круги|воззвания|инфузии|заветы)/i;

function parseClassStructure(md) {
  const lines = String(md || '').split(/\r?\n/);
  const toc = [];
  let mainSeen = false;
  let inFeatures = false;
  let groupSeen = false;

  // Таблица уровней: первая GFM-таблица, где в первой строке есть «Уровень».
  let levelTable = '';
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!levelTable && t.startsWith('|') && /Уровень/i.test(t)) {
      const block = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        block.push(lines[j].trimEnd());
        j += 1;
      }
      if (block.length >= 3) {
        levelTable = block.join('\n');
      }
    }
  }

  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith('### ')) {
      if (inFeatures) {
        toc.push({ level: 3, title: t.slice(4).trim(), kind: 'feature' });
      }
      continue;
    }
    if (!t.startsWith('## ')) continue;

    const title = t.slice(3).trim();
    if (!title) continue;

    let kind = 'section';
    if (!mainSeen && title.includes('[')) {
      kind = 'main';
      mainSeen = true;
    } else if (/^классовые умения/i.test(title)) {
      kind = 'features';
    } else if (CLASS_GROUP_RE.test(title)) {
      kind = 'group';
      groupSeen = true;
    } else if (groupSeen) {
      kind = 'subclass';
    }
    inFeatures = kind === 'features';
    toc.push({ level: 2, title, kind });
  }

  return {
    toc,
    levelTable,
    features: toc.filter((e) => e.kind === 'feature').map((e) => e.title),
    subclasses: toc.filter((e) => e.kind === 'subclass').map((e) => e.title)
  };
}

/**
 * T5.5 — машиночитаемая мета класса для листа персонажа и мастера создания
 * (payload.meta). Разбирает блок «Хиты, владение и снаряжение» классового .md:
 * кость хитов, формулы хитов, владения (доспехи/оружие/инструменты),
 * спасброски, навыки и стартовое снаряжение. payload.sections (оглавление
 * страницы вики) не трогаем.
 */
function parseClassMeta(content) {
  const text = String(content || '');
  const pickLine = (label) => {
    const re = new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*([^\\n]+)`, 'i');
    const match = text.match(re);
    return match ? sanitizeText(match[1]) : '';
  };

  const hitDiceRaw = pickLine('Кость Хитов');
  // «1к12 за каждый уровень варвара» → «1к12» → «1d12» (формат селекта листа)
  const hitDiceMatch = hitDiceRaw.match(/1\s*[кkd]\s*(\d+)/i);
  const hitDice = hitDiceMatch ? `1d${hitDiceMatch[1]}` : '';

  const meta = {
    hitDice,
    hitDiceRaw,
    hpAtFirstLevel: pickLine('Хиты на 1 уровне'),
    hpAtHigherLevels: pickLine('Хиты на следующих уровнях'),
    armor: pickLine('Доспехи'),
    weapons: pickLine('Оружие'),
    tools: pickLine('Инструменты'),
    savingThrows: pickLine('Спасброски'),
    skills: pickLine('Навыки'),
    startingEquipment: []
  };

  // Стартовое снаряжение: маркированный список после заголовка «СНАРЯЖЕНИЕ».
  const equipHeading = text.search(/#{3,5}\s*СНАРЯЖЕНИЕ/i);
  if (equipHeading !== -1) {
    const tail = text.slice(equipHeading).split(/\r?\n/).slice(1);
    for (const raw of tail) {
      const line = raw.trim();
      if (/^#{2,6}\s/.test(line)) break; // следующий раздел
      if (/^\*\s+/.test(line)) {
        meta.startingEquipment.push(sanitizeText(line.replace(/^\*\s+/, '')));
        continue;
      }
      if (meta.startingEquipment.length && line && !/^\*/.test(line) && !/^Вы начинаете|^Если вы/i.test(line)) {
        break;
      }
    }
    meta.startingEquipment = meta.startingEquipment.slice(0, 12);
  }

  return meta;
}

function parseMarkdownWikiEntry(section, slug, rawMd) {
  const trimmed = trimMarkdownPreamble(rawMd);
  const { name, nameEn } = parseNameFromMarkdown(trimmed);
  const source = parseSourceFromMarkdown(rawMd);
  const content = sanitizeWikiMarkdown(trimmed);
  const baseName = name || nameEn || slug;
  const summary = firstSentence(extractPlainSummarySource(trimmed.slice(0, 8000)));
  const filters = buildFilters(section, {
    article_text: trimmed.slice(0, 120000),
    params_json: [],
    source
  });

  const payload = {
    slugFile: slug,
    contentFormat: 'markdown'
  };
  if (section === 'classes') {
    payload.sections = parseClassStructure(content);
    payload.meta = parseClassMeta(content);
    // Дозаполняем filters из меты: для md-классов params_json пуст и
    // hit_dice/armor/weapons раньше оставались пустыми строками.
    if (!filters.hit_dice && payload.meta.hitDiceRaw) filters.hit_dice = payload.meta.hitDiceRaw;
    if (!filters.armor && payload.meta.armor) filters.armor = payload.meta.armor;
    if (!filters.weapons && payload.meta.weapons) filters.weapons = payload.meta.weapons;
  }

  return {
    slug: slugify(slug, slug),
    name: baseName,
    nameEn: nameEn || '',
    source,
    summary: summary || firstSentence(content),
    content,
    filters,
    payload
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

  // Бестиарий и предметы: урезанные датасеты в assets/wiki (см.
  // build-wiki-trimmed-sources.js) — единственный источник в git; сырые дампы
  // из output/ используются только как fallback вне worktree-ов.
  if (config.section === 'bestiary') {
    const trimmedPath = path.join(ASSETS_WIKI_DIR, 'bestiary', 'bestiary-all.json');
    if (fs.existsSync(trimmedPath)) {
      return { kind: 'trimmed-json', filePath: trimmedPath };
    }
  }

  if (config.section === 'items') {
    const trimmedPath = path.join(ASSETS_WIKI_DIR, 'items', 'items-all.json');
    if (fs.existsSync(trimmedPath)) {
      return { kind: 'trimmed-json', filePath: trimmedPath };
    }
  }

  const outputPath = path.join(OUTPUT_DIR, config.file);
  if (fs.existsSync(outputPath)) {
    return { kind: 'json-array', filePath: outputPath };
  }

  return null;
}

/**
 * Записи урезанных датасетов (bestiary-all.json / items-all.json) уже
 * нормализованы при сборке: надёжные slug и имена (см. известный дефект
 * name_ru в build-wiki-trimmed-sources.js), очищенное описание, готовые
 * фильтры. Здесь только досанитизация и упаковка.
 */
function normalizeTrimmedRow(section, row) {
  const content = sanitizeWikiMarkdown(row?.description || '');
  const source = sanitizeText(row?.source || '');
  const filters = { source };
  for (const [key, value] of Object.entries(row?.filters || {})) {
    const clean = sanitizeText(value || '');
    if (clean) filters[key] = clean;
  }

  return {
    slug: slugify(row?.slug, `${section}-${Math.random().toString(36).slice(2, 10)}`),
    name: sanitizeText(row?.name || '') || String(row?.slug || ''),
    nameEn: sanitizeText(row?.name_en || ''),
    source,
    summary: firstSentence(sanitizeText(content.slice(0, 4000))),
    content,
    filters,
    payload: { contentFormat: 'markdown', importedFrom: 'trimmed-json' }
  };
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

async function upsertEntry(client, table, slug, normalized) {
  await client.query(
    `INSERT INTO ${table} (slug, name, name_en, source, summary, content, filters, payload)
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
}

async function importSection(client, config) {
  const resolved = resolveSectionFilePath(config);
  if (!resolved) {
    throw new Error(`File not found for section "${config.section}". Checked: OUTPUT_DIR="${OUTPUT_DIR}", ASSETS_WIKI_DIR="${ASSETS_WIKI_DIR}"`);
  }

  await client.query(`TRUNCATE ${config.table} RESTART IDENTITY;`);

  let imported = 0;

  if (resolved.kind === 'trimmed-json') {
    const rows = parseJsonFile(resolved.filePath);
    if (!Array.isArray(rows)) {
      throw new Error(`Invalid JSON structure in ${resolved.filePath}`);
    }

    for (const raw of rows) {
      const normalized = normalizeTrimmedRow(config.section, raw);
      if (!normalized.content) continue;
      // eslint-disable-next-line no-await-in-loop
      await upsertEntry(client, config.table, normalized.slug, normalized);
      imported += 1;
    }

    return imported;
  }

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
      await upsertEntry(client, config.table, slug, normalized);
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
      await upsertEntry(client, config.table, normalized.slug, normalized);
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
      await upsertEntry(client, config.table, normalized.slug, normalized);
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

if (require.main === module) {
  run();
}

// Экспорт для юнит-проверки (src/scripts/import-wiki-reference.selftest.js).
module.exports = {
  sanitizeText,
  sanitizeWikiMarkdown,
  fixGluedTableHeaders,
  trimMarkdownPreamble,
  parseNameFromMarkdown,
  parseClassStructure,
  parseClassMeta,
  parseMarkdownWikiEntry,
  normalizeTrimmedRow
};
