const pool = require('../db/pool');
const { SRD_SEED_ENTITIES, SRD_SEED_RELATIONS } = require('../modules/wiki/wiki.seed');

async function upsertEntity(client, entity) {
  const entityResult = await client.query(
    `INSERT INTO wiki_entities (slug, entity_type, source, is_published)
     VALUES ($1, $2, 'srd-5e', true)
     ON CONFLICT (slug)
     DO UPDATE
     SET entity_type = EXCLUDED.entity_type,
         source = EXCLUDED.source,
         is_published = EXCLUDED.is_published,
         updated_at = now()
     RETURNING id`,
    [entity.slug, entity.entityType]
  );
  const entityId = entityResult.rows[0].id;

  await client.query(
    `INSERT INTO wiki_entity_stats (wiki_entity_id, stats)
     VALUES ($1, $2)
     ON CONFLICT (wiki_entity_id)
     DO UPDATE SET stats = EXCLUDED.stats, updated_at = now()`,
    [entityId, entity.stats || {}]
  );

  for (const [locale, translation] of Object.entries(entity.translations || {})) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO wiki_entity_translations (wiki_entity_id, locale, name, summary, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wiki_entity_id, locale)
       DO UPDATE
       SET name = EXCLUDED.name,
           summary = EXCLUDED.summary,
           body = EXCLUDED.body,
           updated_at = now()`,
      [entityId, locale, translation.name || '', translation.summary || '', translation.body || {}]
    );
  }
}

async function upsertRelation(client, relation) {
  await client.query(
    `WITH from_entity AS (
      SELECT id FROM wiki_entities WHERE slug = $1 LIMIT 1
    ), to_entity AS (
      SELECT id FROM wiki_entities WHERE slug = $2 LIMIT 1
    )
    INSERT INTO wiki_entity_relations (from_entity_id, to_entity_id, relation_type)
    SELECT from_entity.id, to_entity.id, $3
    FROM from_entity, to_entity
    ON CONFLICT (from_entity_id, to_entity_id, relation_type) DO NOTHING`,
    [relation.fromSlug, relation.toSlug, relation.relationType]
  );
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const entity of SRD_SEED_ENTITIES) {
      // eslint-disable-next-line no-await-in-loop
      await upsertEntity(client, entity);
    }

    for (const relation of SRD_SEED_RELATIONS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertRelation(client, relation);
    }

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`Imported ${SRD_SEED_ENTITIES.length} wiki entities and ${SRD_SEED_RELATIONS.length} relations`);
  } catch (error) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Wiki SRD import failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
