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

const RESERVED_QUERY_KEYS = new Set(['page', 'limit', 'q', 'sort', 'name', 'source', 'locale']);
const ALLOWED_SORTS = new Set(['name', 'updatedAt']);

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

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 24;
  return Math.max(1, Math.min(parsed, 120));
}

function normalizePage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, parsed);
}

function normalizeSort(value) {
  const sort = typeof value === 'string' ? value.trim() : 'updatedAt';
  if (!ALLOWED_SORTS.has(sort)) {
    return 'updatedAt';
  }
  return sort;
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
    payload,
    body: {
      sections: row.content
        ? [{ title: 'Описание', content: row.content }]
        : []
    },
    updatedAt: toIso(row.updated_at)
  };
}

async function listReferenceEntities(sectionRaw, query) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];
  const page = normalizePage(query?.page);
  const limit = normalizeLimit(query?.limit);
  const q = typeof query?.q === 'string' ? query.q.trim() : '';
  const sort = normalizeSort(query?.sort);
  const offset = (page - 1) * limit;

  if (q.length > 120) {
    throw createHttpError(400, 'Search query is too long');
  }

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(name) LIKE $${params.length}
      OR lower(name_en) LIKE $${params.length}
      OR lower(source) LIKE $${params.length}
      OR lower(content) LIKE $${params.length}
    )`);
  }

  for (const [key, rawValue] of Object.entries(query || {})) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) continue;

    params.push(key);
    params.push(value);
    where.push(`coalesce(filters ->> $${params.length - 1}, '') ILIKE '%' || $${params.length} || '%'`);
  }

  if (query?.source && typeof query.source === 'string' && query.source.trim()) {
    const raw = query.source.trim();
    const parts = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      const value = parts[0] || raw;
      params.push(`%${value.toLowerCase()}%`);
      where.push(`lower(source) LIKE $${params.length}`);
    } else {
      const or = [];
      for (const value of parts) {
        params.push(`%${value.toLowerCase()}%`);
        or.push(`lower(source) LIKE $${params.length}`);
      }
      where.push(`(${or.join(' OR ')})`);
    }
  }

  if (query?.name && typeof query.name === 'string' && query.name.trim()) {
    const value = query.name.trim();
    params.push(value);
    where.push(`lower(name) LIKE '%' || lower($${params.length}) || '%'`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortSql = sort === 'name' ? 'name ASC, updated_at DESC' : 'updated_at DESC, name ASC';

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM ${table} ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);

  params.push(limit);
  params.push(offset);

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
    ORDER BY ${sortSql}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}`,
    params
  );

  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    items: result.rows.map((row) => mapListRow(section, row))
  };
}

async function getReferenceEntity(sectionRaw, idOrSlug) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];
  const value = String(idOrSlug || '').trim();
  if (!value) {
    throw createHttpError(400, 'Entity id or slug is required');
  }

  const result = await pool.query(
    `SELECT
      public_id,
      slug,
      name,
      name_en,
      source,
      summary,
      content,
      filters,
      payload,
      updated_at
    FROM ${table}
    WHERE public_id::text = $1 OR slug = $1
    LIMIT 1`,
    [value]
  );

  const row = result.rows[0];
  if (!row) {
    throw createHttpError(404, 'Wiki entity not found');
  }

  return mapDetailRow(section, row);
}

async function getReferenceFilters(sectionRaw) {
  const section = normalizeSection(sectionRaw);
  const { table } = SECTION_CONFIG[section];

  const result = await pool.query(
    `SELECT key, value
     FROM ${table}
     CROSS JOIN LATERAL jsonb_each_text(filters) AS f(key, value)
     WHERE nullif(trim(value), '') IS NOT NULL`
  );

  const grouped = new Map();
  for (const row of result.rows) {
    const key = String(row.key || '').trim();
    const value = String(row.value || '').trim();
    if (!key || !value) continue;
    if (!grouped.has(key)) {
      grouped.set(key, new Set());
    }
    grouped.get(key).add(value);
  }

  // Ensure "source" is always available for UI, even if importer did not
  // duplicate it into filters JSONB.
  const sourcesResult = await pool.query(
    `SELECT DISTINCT nullif(trim(source), '') AS source
     FROM ${table}
     WHERE nullif(trim(source), '') IS NOT NULL`
  );
  const sourceValues = sourcesResult.rows
    .map((row) => String(row.source || '').trim())
    .filter(Boolean);
  if (sourceValues.length) {
    if (!grouped.has('source')) {
      grouped.set('source', new Set());
    }
    const set = grouped.get('source');
    for (const value of sourceValues) {
      set.add(value);
    }
  }

  const fields = [];
  for (const [key, valuesSet] of grouped.entries()) {
    const values = Array.from(valuesSet).sort((a, b) => a.localeCompare(b, 'ru'));
    fields.push({
      key,
      type: values.length <= 80 ? 'select' : 'text',
      values: values.length <= 80 ? values : []
    });
  }

  fields.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  return { section, fields };
}

module.exports = {
  SECTION_CONFIG,
  listReferenceEntities,
  getReferenceEntity,
  getReferenceFilters
};
