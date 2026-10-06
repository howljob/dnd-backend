const pool = require('../../db/pool');

const SECTION_CONFIG = {
  spells: { table: 'wiki_spells', entityType: 'spell' },
  classes: { table: 'wiki_classes', entityType: 'class' },
  races: { table: 'wiki_races', entityType: 'race' },
  backgrounds: { table: 'wiki_backgrounds', entityType: 'background' },
  feats: { table: 'wiki_feats', entityType: 'feat' },
  bestiary: { table: 'wiki_bestiary', entityType: 'monster' },
  items: { table: 'wiki_items', entityType: 'item' }
};

/**
 * Фильтры раздела — ключи в jsonb `filters`, которые заполняет импортёр.
 *  select  — точное совпадение с одним из значений (можно несколько через запятую);
 *  multi   — значение хранится списком «бард, волшебник», ищем одно слово списка;
 *  boolean — true/false.
 * `order` — как сортировать значения в выдаче /filters (по умолчанию по алфавиту).
 */
const FILTER_FIELDS = {
  spells: [
    { key: 'level', kind: 'select', order: 'level' },
    { key: 'school', kind: 'select' },
    { key: 'classes', kind: 'multi' },
    { key: 'cast_time_kind', kind: 'select' },
    { key: 'concentration', kind: 'boolean' },
    { key: 'ritual', kind: 'boolean' },
    { key: 'source', kind: 'select' }
  ],
  classes: [
    { key: 'source', kind: 'select' }
  ],
  races: [
    { key: 'size', kind: 'select' },
    { key: 'source', kind: 'select' }
  ],
  backgrounds: [
    { key: 'source', kind: 'select' }
  ],
  feats: [
    { key: 'has_prerequisite', kind: 'boolean' },
    { key: 'source', kind: 'select' }
  ],
  bestiary: [
    { key: 'challenge', kind: 'select', order: 'challenge' },
    { key: 'type', kind: 'select' },
    { key: 'size', kind: 'select' },
    { key: 'legendary', kind: 'boolean' },
    { key: 'source', kind: 'select' }
  ],
  items: [
    { key: 'item_type', kind: 'select' },
    { key: 'rarity', kind: 'select', order: 'rarity' },
    { key: 'attunement', kind: 'boolean' },
    { key: 'source', kind: 'select' }
  ]
};

const RARITY_ORDER = ['обычный', 'необычный', 'редкий', 'очень редкий', 'легендарный', 'артефакт', 'варьируется'];

/** Сортировки списка: SQL-фрагменты фиксированы, от пользователя приходит только ключ. */
const SORTS = {
  name: 'name ASC, updated_at DESC',
  updatedAt: 'updated_at DESC, name ASC',
  level: "nullif(filters->>'level_num', '')::int ASC NULLS LAST, name ASC",
  challenge: "nullif(filters->>'cr_value', '')::numeric ASC NULLS LAST, name ASC",
  rarity: `array_position(ARRAY[${RARITY_ORDER.map((r) => `'${r}'`).join(',')}]::text[], filters->>'rarity') ASC NULLS LAST, name ASC`
};
const SECTION_SORTS = {
  spells: ['name', 'updatedAt', 'level'],
  bestiary: ['name', 'updatedAt', 'challenge'],
  items: ['name', 'updatedAt', 'rarity']
};

const RESERVED_QUERY_KEYS = new Set(['page', 'limit', 'q', 'sort', 'name', 'source', 'locale']);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeSection(sectionRaw) {
  const section = String(sectionRaw || '').trim().toLowerCase();
  if (!SECTION_CONFIG[section]) {
    throw createHttpError(400, 'Invalid wiki section');
  }
  return section;
}

function normalizeLimit(value, fallback = 24) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 120));
}

function normalizePage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, parsed);
}

function normalizeSort(section, value, hasQuery) {
  const sort = typeof value === 'string' ? value.trim() : '';
  if (sort === 'relevance') return hasQuery ? 'relevance' : 'name';
  const allowed = SECTION_SORTS[section] || ['name', 'updatedAt'];
  if (allowed.includes(sort)) return sort;
  // По умолчанию: с поисковым запросом — по точности совпадения, иначе по алфавиту.
  return hasQuery ? 'relevance' : 'name';
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapListRow(section, row) {
  return {
    id: row.public_id,
    slug: row.slug,
    section,
    entityType: SECTION_CONFIG[section].entityType,
    name: row.name,
    nameEn: row.name_en,
    source: row.source,
    summary: row.summary,
    stats: row.filters || {},
    updatedAt: toIso(row.updated_at)
  };
}

function mapDetailRow(section, row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const contentFormat = payload.contentFormat === 'markdown' ? 'markdown' : 'plain';

  return {
    id: row.public_id,
    slug: row.slug,
    section,
    entityType: SECTION_CONFIG[section].entityType,
    name: row.name,
    nameEn: row.name_en,
    source: row.source,
    summary: row.summary,
    content: row.content || '',
    contentFormat,
    stats: row.filters || {},
    // Машиночитаемые поля (статблок монстра, параметры заклинания и т. п.) —
    // для листа персонажа, стола и карточек вики.
    data: payload.data && typeof payload.data === 'object' ? payload.data : null,
    payload,
    body: {
      sections: row.content
        ? [{ title: 'Описание', content: row.content }]
        : []
    },
    updatedAt: toIso(row.updated_at)
  };
}

function splitValues(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Собирает WHERE и параметры запроса списка: поиск (q), фильтры раздела,
 * совместимые старые параметры name/source.
 */
function buildListWhere(section, query) {
  const params = [];
  const where = [];
  const q = typeof query?.q === 'string' ? query.q.trim() : '';

  if (q.length > 120) {
    throw createHttpError(400, 'Search query is too long');
  }

  let rankSql = null;
  if (q) {
    params.push(q.toLowerCase());
    const qIdx = params.length;
    params.push(`%${q.toLowerCase()}%`);
    const likeIdx = params.length;
    where.push(`(
      lower(name) LIKE $${likeIdx}
      OR lower(name_en) LIKE $${likeIdx}
      OR search_vector @@ plainto_tsquery('russian', $${qIdx})
    )`);
    // Сначала точное название, затем начало названия, затем вхождение, затем текст.
    rankSql = `
      CASE
        WHEN lower(name) = $${qIdx} OR lower(name_en) = $${qIdx} THEN 0
        WHEN lower(name) LIKE $${qIdx} || '%' OR lower(name_en) LIKE $${qIdx} || '%' THEN 1
        WHEN lower(name) LIKE $${likeIdx} OR lower(name_en) LIKE $${likeIdx} THEN 2
        ELSE 3
      END ASC,
      ts_rank(search_vector, plainto_tsquery('russian', $${qIdx})) DESC,
      name ASC`;
  }

  const fields = FILTER_FIELDS[section] || [];
  for (const field of fields) {
    const rawValue = query?.[field.key];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) continue;

    if (field.kind === 'boolean') {
      const truthy = /^(true|1|yes|да)$/i.test(value);
      params.push(truthy ? 'true' : 'false');
      where.push(`coalesce(filters->>'${field.key}', 'false') = $${params.length}`);
      continue;
    }

    const values = splitValues(value);
    if (!values.length) continue;
    const ors = [];
    for (const item of values) {
      params.push(item.toLowerCase());
      if (field.kind === 'multi') {
        ors.push(`(',' || replace(lower(coalesce(filters->>'${field.key}', '')), ', ', ',') || ',') LIKE '%,' || $${params.length} || ',%'`);
      } else {
        ors.push(`lower(coalesce(filters->>'${field.key}', '')) = $${params.length}`);
      }
    }
    where.push(`(${ors.join(' OR ')})`);
  }

  // Старые параметры (совместимость с листом персонажа и панелью справочника)
  if (typeof query?.source === 'string' && query.source.trim() && !fields.some((f) => f.key === 'source' && query.source)) {
    params.push(`%${query.source.trim().toLowerCase()}%`);
    where.push(`lower(source) LIKE $${params.length}`);
  }
  if (typeof query?.name === 'string' && query.name.trim()) {
    params.push(`%${query.name.trim().toLowerCase()}%`);
    where.push(`lower(name) LIKE $${params.length}`);
  }
  // Прочие ключи фильтров (не из списка раздела) — точное совпадение по filters->>key,
  // чтобы старые вызовы вида ?school=… продолжали работать.
  for (const [key, rawValue] of Object.entries(query || {})) {
    if (RESERVED_QUERY_KEYS.has(key) || fields.some((f) => f.key === key)) continue;
    if (!/^[a-z_]{1,40}$/.test(key)) continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) continue;
    params.push(key);
    params.push(value.toLowerCase());
    where.push(`lower(coalesce(filters->>$${params.length - 1}, '')) = $${params.length}`);
  }

  return { params, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', rankSql, q };
}

async function listReferenceEntities(sectionRaw, query) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];
  const page = normalizePage(query?.page);
  const limit = normalizeLimit(query?.limit);
  const offset = (page - 1) * limit;

  const { params, whereSql, rankSql, q } = buildListWhere(section, query);
  const sort = normalizeSort(section, query?.sort, Boolean(q));
  const orderSql = sort === 'relevance' ? rankSql : SORTS[sort];

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM ${table} ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const listParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT
      public_id,
      slug,
      name,
      name_en,
      source,
      summary,
      filters,
      updated_at
    FROM ${table}
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT $${listParams.length - 1}
    OFFSET $${listParams.length}`,
    listParams
  );

  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort,
    items: result.rows.map((row) => mapListRow(section, row))
  };
}

/**
 * Поиск по всем разделам сразу: по несколько лучших совпадений на раздел
 * и общее число найденного в каждом.
 */
async function searchAllSections(query) {
  const q = typeof query?.q === 'string' ? query.q.trim() : '';
  if (!q) {
    throw createHttpError(400, 'Search query is required');
  }
  const limit = normalizeLimit(query?.limit, 5);

  const sections = await Promise.all(
    Object.keys(SECTION_CONFIG).map(async (section) => {
      const result = await listReferenceEntities(section, { q, limit, sort: 'relevance' });
      return {
        section,
        entityType: SECTION_CONFIG[section].entityType,
        total: result.total,
        items: result.items
      };
    })
  );

  return {
    query: q,
    total: sections.reduce((sum, s) => sum + s.total, 0),
    sections: sections.filter((s) => s.total > 0)
  };
}

async function getReferenceEntity(sectionRaw, idOrSlug) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];
  const value = String(idOrSlug || '').trim();
  if (!value) {
    throw createHttpError(400, 'Entity id or slug is required');
  }

  const columns = `public_id, slug, name, name_en, source, summary, content, filters, payload, updated_at`;
  const result = await pool.query(
    `SELECT ${columns} FROM ${table} WHERE public_id::text = $1 OR slug = $1 LIMIT 1`,
    [value]
  );

  let row = result.rows[0];

  // Ссылки внутри текстов dnd.su («/spells/205-fireball/») приходят с фронта как
  // «dndsu-205-fireball»: ищем запись по её слагу, по слагу с id (дубли бестиария),
  // по id в начале/конце слага (черты, предыстории, расы) и по исходной ссылке.
  const alias = !row && value.match(/^dndsu-(\d+)-(.+)$/);
  if (alias) {
    const [, id, slug] = alias;
    const aliased = await pool.query(
      `SELECT ${columns} FROM ${table}
       WHERE slug = $1 OR slug = $2 OR slug LIKE $3 OR slug LIKE $4 OR payload->>'link' LIKE $5
       ORDER BY (slug = $1) DESC, (slug = $2) DESC
       LIMIT 1`,
      [slug, `${slug}-${id}`, `${id}-%`, `%-${id}`, `%/${id}-%`]
    );
    row = aliased.rows[0];
  }

  if (!row) {
    throw createHttpError(404, 'Wiki entity not found');
  }

  return mapDetailRow(section, row);
}

function compareLevel(a, b) {
  const num = (v) => (/заговор/i.test(v) ? 0 : Number(v));
  return num(a) - num(b);
}

function compareChallenge(a, b) {
  const num = (v) => {
    const s = String(v).trim();
    const frac = s.match(/^(\d+)\/(\d+)$/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    const n = Number(s);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  return num(a) - num(b);
}

/**
 * Значения фильтров раздела для выпадающих списков. Для `multi`-полей
 * («бард, волшебник») список раскладывается на отдельные значения.
 */
async function getReferenceFilters(sectionRaw) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];
  const fields = FILTER_FIELDS[section] || [];

  const result = await pool.query(
    `SELECT f.key, f.value
     FROM ${table}
     CROSS JOIN LATERAL jsonb_each_text(filters) AS f(key, value)
     WHERE nullif(trim(f.value), '') IS NOT NULL`
  );

  const grouped = new Map();
  for (const row of result.rows) {
    const key = String(row.key || '').trim();
    const field = fields.find((f) => f.key === key);
    if (!field || field.kind === 'boolean') continue;
    const values = field.kind === 'multi' ? splitValues(row.value) : [String(row.value || '').trim()];
    if (!grouped.has(key)) grouped.set(key, new Set());
    for (const v of values) {
      if (v) grouped.get(key).add(v);
    }
  }

  const output = fields.map((field) => {
    if (field.kind === 'boolean') {
      return { key: field.key, type: 'boolean', values: [] };
    }
    const values = Array.from(grouped.get(field.key) || []);
    if (field.order === 'level') values.sort(compareLevel);
    else if (field.order === 'challenge') values.sort(compareChallenge);
    else if (field.order === 'rarity') values.sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
    else values.sort((a, b) => a.localeCompare(b, 'ru'));
    return { key: field.key, type: field.kind === 'multi' ? 'multi' : 'select', values };
  });

  return { section, fields: output, sorts: SECTION_SORTS[section] || ['name', 'updatedAt'] };
}

module.exports = {
  SECTION_CONFIG,
  FILTER_FIELDS,
  listReferenceEntities,
  searchAllSections,
  getReferenceEntity,
  getReferenceFilters
};
