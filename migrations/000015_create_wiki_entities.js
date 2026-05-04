const { SRD_SEED_ENTITIES, SRD_SEED_RELATIONS } = require('../src/modules/wiki/wiki.seed');

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('wiki_entities', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    slug: {
      type: 'varchar(180)',
      notNull: true
    },
    entity_type: {
      type: 'varchar(20)',
      notNull: true
    },
    source: {
      type: 'varchar(40)',
      notNull: true,
      default: 'srd-5e'
    },
    is_published: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'wiki_entities',
    'wiki_entities_slug_unique',
    'UNIQUE (slug)'
  );

  pgm.addConstraint(
    'wiki_entities',
    'wiki_entities_type_check',
    "CHECK (entity_type IN ('class', 'race', 'spell', 'feat', 'monster', 'item'))"
  );

  pgm.createTable('wiki_entity_translations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    wiki_entity_id: {
      type: 'uuid',
      notNull: true,
      references: 'wiki_entities',
      onDelete: 'CASCADE'
    },
    locale: {
      type: 'varchar(10)',
      notNull: true
    },
    name: {
      type: 'varchar(200)',
      notNull: true
    },
    summary: {
      type: 'text',
      notNull: true,
      default: ''
    },
    body: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'wiki_entity_translations',
    'wiki_entity_translations_locale_check',
    "CHECK (locale IN ('ru', 'en'))"
  );

  pgm.addConstraint(
    'wiki_entity_translations',
    'wiki_entity_translations_unique_entity_locale',
    'UNIQUE (wiki_entity_id, locale)'
  );

  pgm.createTable('wiki_entity_stats', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    wiki_entity_id: {
      type: 'uuid',
      notNull: true,
      references: 'wiki_entities',
      onDelete: 'CASCADE'
    },
    stats: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'wiki_entity_stats',
    'wiki_entity_stats_entity_unique',
    'UNIQUE (wiki_entity_id)'
  );

  pgm.createTable('wiki_entity_relations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    from_entity_id: {
      type: 'uuid',
      notNull: true,
      references: 'wiki_entities',
      onDelete: 'CASCADE'
    },
    to_entity_id: {
      type: 'uuid',
      notNull: true,
      references: 'wiki_entities',
      onDelete: 'CASCADE'
    },
    relation_type: {
      type: 'varchar(60)',
      notNull: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'wiki_entity_relations',
    'wiki_entity_relations_unique_link',
    'UNIQUE (from_entity_id, to_entity_id, relation_type)'
  );

  pgm.createIndex('wiki_entities', ['entity_type', 'is_published']);
  pgm.createIndex('wiki_entities', ['updated_at']);
  pgm.createIndex('wiki_entity_translations', ['locale', 'name']);
  pgm.createIndex('wiki_entity_relations', ['from_entity_id', 'relation_type']);
  pgm.createIndex('wiki_entity_relations', ['to_entity_id', 'relation_type']);

  pgm.sql(`
    CREATE INDEX wiki_translations_fts_idx
    ON wiki_entity_translations
    USING GIN (
      to_tsvector(
        'simple',
        coalesce(name, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body::text, '')
      )
    );
  `);

  for (const entity of SRD_SEED_ENTITIES) {
    pgm.sql(
      `INSERT INTO wiki_entities (slug, entity_type, source, is_published)
       VALUES (${sqlString(entity.slug)}, ${sqlString(entity.entityType)}, 'srd-5e', true);`
    );

    pgm.sql(
      `INSERT INTO wiki_entity_stats (wiki_entity_id, stats)
       SELECT id, ${sqlString(JSON.stringify(entity.stats || {}))}::jsonb
       FROM wiki_entities
       WHERE slug = ${sqlString(entity.slug)}
       LIMIT 1;`
    );

    for (const locale of Object.keys(entity.translations || {})) {
      const translation = entity.translations[locale];
      pgm.sql(
        `INSERT INTO wiki_entity_translations (
          wiki_entity_id,
          locale,
          name,
          summary,
          body
        )
        SELECT
          id,
          ${sqlString(locale)},
          ${sqlString(translation.name || '')},
          ${sqlString(translation.summary || '')},
          ${sqlString(JSON.stringify(translation.body || {}))}::jsonb
        FROM wiki_entities
        WHERE slug = ${sqlString(entity.slug)}
        LIMIT 1;`
      );
    }
  }

  for (const relation of SRD_SEED_RELATIONS) {
    pgm.sql(
      `INSERT INTO wiki_entity_relations (from_entity_id, to_entity_id, relation_type)
       SELECT from_entity.id, to_entity.id, ${sqlString(relation.relationType)}
       FROM wiki_entities from_entity
       CROSS JOIN wiki_entities to_entity
       WHERE from_entity.slug = ${sqlString(relation.fromSlug)}
         AND to_entity.slug = ${sqlString(relation.toSlug)}
       LIMIT 1;`
    );
  }
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS wiki_translations_fts_idx;');
  pgm.dropTable('wiki_entity_relations');
  pgm.dropTable('wiki_entity_stats');
  pgm.dropTable('wiki_entity_translations');
  pgm.dropTable('wiki_entities');
};
