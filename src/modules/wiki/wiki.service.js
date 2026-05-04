const pool = require('../../db/pool');
const { logAdminAction } = require('../admin-audit/admin-audit.service');
const { SRD_SEED_ENTITIES, SRD_SEED_RELATIONS } = require('./wiki.seed');

const ALLOWED_LOCALES = ['ru', 'en'];
const ALLOWED_ENTITY_TYPES = ['class', 'race', 'spell', 'feat', 'monster', 'item'];
const ALLOWED_SORTS = ['name', 'updatedAt'];

const CACHE_TTL_MS = 60 * 1000;
const listCache = new Map();
const detailCache = new Map();

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function nowMs() {
  return Date.now();
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt < nowMs()) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(map, key, data) {
  map.set(key, { data, expiresAt: nowMs() + CACHE_TTL_MS });
}

function clearWikiCache() {
  listCache.clear();
  detailCache.clear();
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeLocale(locale) {
  const next = typeof locale === 'string' ? locale.trim().toLowerCase() : 'ru';
  return ALLOWED_LOCALES.includes(next) ? next : 'ru';
}

function normalizeEntityType(type) {
  const next = typeof type === 'string' ? type.trim().toLowerCase() : '';
  return ALLOWED_ENTITY_TYPES.includes(next) ? next : '';
}

function normalizeSort(sort) {
  const next = typeof sort === 'string' ? sort.trim() : 'updatedAt';
  return ALLOWED_SORTS.includes(next) ? next : 'updatedAt';
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 24;
  return Math.max(1, Math.min(parsed, 100));
}

function normalizePage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, parsed);
}

function mapEntityRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    entityType: row.entity_type,
    source: row.source,
    isPublished: row.is_published,
    name: row.name,
    summary: row.summary,
    locale: row.locale,
    stats: row.stats || {},
    updatedAt: toIso(row.updated_at)
  };
}

function mapRelationRow(row) {
  return {
    relationType: row.relation_type,
    target: {
      id: row.target_id,
      slug: row.target_slug,
      entityType: row.target_entity_type,
      name: row.target_name,
      summary: row.target_summary
    }
  };
}

function buildListCacheKey(input) {
  return JSON.stringify(input);
}

async function listWikiEntities(query) {
  const locale = normalizeLocale(query?.locale);
  const rawEntityType = typeof query?.type === 'string' ? query.type.trim().toLowerCase() : '';
  const entityType = normalizeEntityType(rawEntityType);
  const q = typeof query?.q === 'string' ? query.q.trim() : '';
  const rawSort = typeof query?.sort === 'string' ? query.sort.trim() : 'updatedAt';
  const sort = normalizeSort(rawSort);
  const page = normalizePage(query?.page);
  const limit = normalizeLimit(query?.limit);
  const offset = (page - 1) * limit;

  if (rawEntityType && !entityType) {
    throw createHttpError(400, 'Invalid entity type filter');
  }

  if (rawSort && !ALLOWED_SORTS.includes(rawSort)) {
    throw createHttpError(400, 'Invalid sort');
  }

  if (q.length > 120) {
    throw createHttpError(400, 'Search query is too long');
  }

  const cacheKey = buildListCacheKey({ locale, entityType, q, sort, page, limit });
  const cached = getCached(listCache, cacheKey);
  if (cached) return cached;

  const params = [locale];
  const where = ['e.is_published = true', 't.locale = $1'];

  if (entityType) {
    params.push(entityType);
    where.push(`e.entity_type = $${params.length}`);
  }

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(t.name) LIKE $${params.length}
      OR lower(t.summary) LIKE $${params.length}
      OR to_tsvector('simple', coalesce(t.name, '') || ' ' || coalesce(t.summary, '') || ' ' || coalesce(t.body::text, ''))
         @@ plainto_tsquery('simple', $${params.length})
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortSql = sort === 'name' ? 't.name ASC, e.updated_at DESC' : 'e.updated_at DESC, t.name ASC';
  const countResult = await pool.query(
    `SELECT count(*)::int AS total
     FROM wiki_entities e
     INNER JOIN wiki_entity_translations t ON t.wiki_entity_id = e.id
     ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);

  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT
      e.id,
      e.slug,
      e.entity_type,
      e.source,
      e.is_published,
      e.updated_at,
      t.locale,
      t.name,
      t.summary,
      s.stats
    FROM wiki_entities e
    INNER JOIN wiki_entity_translations t ON t.wiki_entity_id = e.id
    LEFT JOIN wiki_entity_stats s ON s.wiki_entity_id = e.id
    ${whereSql}
    ORDER BY ${sortSql}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}`,
    params
  );

  const payload = {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    items: result.rows.map(mapEntityRow)
  };
  setCached(listCache, cacheKey, payload);
  return payload;
}

async function getWikiEntityBySlug(slug, localeRaw) {
  const entitySlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  if (!entitySlug) {
    throw createHttpError(400, 'Entity slug is required');
  }

  const locale = normalizeLocale(localeRaw);
  const cacheKey = `${entitySlug}:${locale}`;
  const cached = getCached(detailCache, cacheKey);
  if (cached) return cached;

  const entityResult = await pool.query(
    `SELECT
      e.id,
      e.slug,
      e.entity_type,
      e.source,
      e.is_published,
      e.created_at,
      e.updated_at,
      t.locale,
      t.name,
      t.summary,
      t.body,
      s.stats
    FROM wiki_entities e
    INNER JOIN wiki_entity_translations t ON t.wiki_entity_id = e.id
    LEFT JOIN wiki_entity_stats s ON s.wiki_entity_id = e.id
    WHERE e.slug = $1
      AND e.is_published = true
      AND t.locale = $2
    LIMIT 1`,
    [entitySlug, locale]
  );

  let row = entityResult.rows[0];
  if (!row) {
    // Locale fallback
    const fallbackResult = await pool.query(
      `SELECT
        e.id,
        e.slug,
        e.entity_type,
        e.source,
        e.is_published,
        e.created_at,
        e.updated_at,
        t.locale,
        t.name,
        t.summary,
        t.body,
        s.stats
      FROM wiki_entities e
      INNER JOIN wiki_entity_translations t ON t.wiki_entity_id = e.id
      LEFT JOIN wiki_entity_stats s ON s.wiki_entity_id = e.id
      WHERE e.slug = $1
        AND e.is_published = true
        AND t.locale = 'en'
      LIMIT 1`,
      [entitySlug]
    );
    row = fallbackResult.rows[0];
  }

  if (!row) {
    throw createHttpError(404, 'Wiki entity not found');
  }

  const relationsResult = await pool.query(
    `SELECT
      r.relation_type,
      target.id AS target_id,
      target.slug AS target_slug,
      target.entity_type AS target_entity_type,
      tt.name AS target_name,
      tt.summary AS target_summary
    FROM wiki_entity_relations r
    INNER JOIN wiki_entities target ON target.id = r.to_entity_id
    INNER JOIN wiki_entity_translations tt
      ON tt.wiki_entity_id = target.id
      AND tt.locale = $2
    WHERE r.from_entity_id = $1
      AND target.is_published = true
    ORDER BY r.relation_type ASC, tt.name ASC`,
    [row.id, row.locale]
  );

  const payload = {
    id: row.id,
    slug: row.slug,
    entityType: row.entity_type,
    source: row.source,
    isPublished: row.is_published,
    locale: row.locale,
    name: row.name,
    summary: row.summary,
    body: row.body || {},
    stats: row.stats || {},
    relations: relationsResult.rows.map(mapRelationRow),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
  setCached(detailCache, cacheKey, payload);
  return payload;
}

function validateTranslation(locale, value) {
  if (!ALLOWED_LOCALES.includes(locale)) {
    throw createHttpError(400, 'Invalid locale');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, `Translation for ${locale} is required`);
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const body = value.body && typeof value.body === 'object' && !Array.isArray(value.body)
    ? value.body
    : {};

  if (!name) {
    throw createHttpError(400, `Translation name for ${locale} is required`);
  }

  return {
    name,
    summary,
    body
  };
}

function validateEntityPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const slug = typeof payload.slug === 'string' ? payload.slug.trim().toLowerCase() : '';
  const entityType = normalizeEntityType(payload.entityType);
  const source = typeof payload.source === 'string' && payload.source.trim()
    ? payload.source.trim()
    : 'srd-5e';
  const isPublished = payload.isPublished !== false;
  const stats = payload.stats && typeof payload.stats === 'object' && !Array.isArray(payload.stats)
    ? payload.stats
    : {};
  const translationsRaw = payload.translations && typeof payload.translations === 'object'
    ? payload.translations
    : {};

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw createHttpError(400, 'Invalid slug');
  }

  if (!entityType) {
    throw createHttpError(400, 'Invalid entityType');
  }

  const hasTranslation = ALLOWED_LOCALES.some((locale) => translationsRaw[locale]);
  if (!hasTranslation) {
    throw createHttpError(400, 'At least one translation is required');
  }

  const translations = {};
  for (const locale of ALLOWED_LOCALES) {
    if (translationsRaw[locale]) {
      translations[locale] = validateTranslation(locale, translationsRaw[locale]);
    }
  }

  return {
    slug,
    entityType,
    source,
    isPublished,
    stats,
    translations
  };
}

async function upsertWikiEntity(auth, data) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const payload = validateEntityPayload(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const entityResult = await client.query(
      `INSERT INTO wiki_entities (
        slug,
        entity_type,
        source,
        is_published
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug)
      DO UPDATE
      SET entity_type = EXCLUDED.entity_type,
          source = EXCLUDED.source,
          is_published = EXCLUDED.is_published,
          updated_at = now()
      RETURNING id, slug, entity_type, source, is_published, created_at, updated_at`,
      [payload.slug, payload.entityType, payload.source, payload.isPublished]
    );

    const entity = entityResult.rows[0];

    await client.query(
      `INSERT INTO wiki_entity_stats (wiki_entity_id, stats)
      VALUES ($1, $2)
      ON CONFLICT (wiki_entity_id)
      DO UPDATE
      SET stats = EXCLUDED.stats,
          updated_at = now()`,
      [entity.id, payload.stats]
    );

    for (const [locale, translation] of Object.entries(payload.translations)) {
      await client.query(
        `INSERT INTO wiki_entity_translations (
          wiki_entity_id,
          locale,
          name,
          summary,
          body
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (wiki_entity_id, locale)
        DO UPDATE
        SET name = EXCLUDED.name,
            summary = EXCLUDED.summary,
            body = EXCLUDED.body,
            updated_at = now()`,
        [entity.id, locale, translation.name, translation.summary, translation.body]
      );
    }

    await logAdminAction({
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: 'wiki.entity.upsert',
      targetType: 'wiki_entity',
      targetId: entity.id,
      details: { slug: payload.slug, entityType: payload.entityType }
    }, client);

    await client.query('COMMIT');
    clearWikiCache();
    return getWikiEntityBySlug(payload.slug, 'en');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertWikiRelation(auth, data) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const payload = data && typeof data === 'object' ? data : {};
  const fromSlug = typeof payload.fromSlug === 'string' ? payload.fromSlug.trim().toLowerCase() : '';
  const toSlug = typeof payload.toSlug === 'string' ? payload.toSlug.trim().toLowerCase() : '';
  const relationType = typeof payload.relationType === 'string' ? payload.relationType.trim().toLowerCase() : '';

  if (!fromSlug || !toSlug || !relationType) {
    throw createHttpError(400, 'fromSlug, toSlug and relationType are required');
  }

  const result = await pool.query(
    `WITH from_entity AS (
      SELECT id FROM wiki_entities WHERE slug = $1 LIMIT 1
    ), to_entity AS (
      SELECT id FROM wiki_entities WHERE slug = $2 LIMIT 1
    )
    INSERT INTO wiki_entity_relations (from_entity_id, to_entity_id, relation_type)
    SELECT from_entity.id, to_entity.id, $3
    FROM from_entity, to_entity
    ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING
    RETURNING id`,
    [fromSlug, toSlug, relationType]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Could not create relation (entities missing or relation already exists)');
  }

  await logAdminAction({
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: 'wiki.relation.upsert',
    targetType: 'wiki_relation',
    targetId: result.rows[0].id,
    details: { fromSlug, toSlug, relationType }
  });

  clearWikiCache();
  return { id: result.rows[0].id, fromSlug, toSlug, relationType };
}

async function importSrdSeed(auth) {
  if (!auth?.userId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const created = [];
  for (const entity of SRD_SEED_ENTITIES) {
    // eslint-disable-next-line no-await-in-loop
    const item = await upsertWikiEntity(auth, {
      slug: entity.slug,
      entityType: entity.entityType,
      source: 'srd-5e',
      isPublished: true,
      stats: entity.stats,
      translations: entity.translations
    });
    created.push(item.slug);
  }

  const relationResults = [];
  for (const relation of SRD_SEED_RELATIONS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const relationResult = await upsertWikiRelation(auth, relation);
      relationResults.push(relationResult.id);
    } catch (error) {
      // Ignore duplicates if import reruns.
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  return {
    importedEntities: created.length,
    importedRelations: relationResults.length
  };
}

module.exports = {
  listWikiEntities,
  getWikiEntityBySlug,
  upsertWikiEntity,
  upsertWikiRelation,
  importSrdSeed,
  clearWikiCache
};
