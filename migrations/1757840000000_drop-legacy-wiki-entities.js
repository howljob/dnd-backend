/**
 * T7.2 — один источник правды для вики.
 *
 * up:
 *  1. Дропает legacy-таблицы модуля wiki (wiki_entities + связанные):
 *     контент полностью живёт в семи таблицах wiki_* модуля wiki-reference.
 *  2. Добавляет таблицам wiki_* колонку is_published (boolean, default true)
 *     и полнотекстовый GIN-индекс по name + name_en + content для поиска.
 *
 * down: восстанавливает СТРУКТУРУ legacy-таблиц по 000015 (без данных —
 * сид удалён вместе с модулем) и убирает is_published/FTS-индексы.
 */

const REFERENCE_TABLES = [
  'wiki_spells',
  'wiki_classes',
  'wiki_races',
  'wiki_backgrounds',
  'wiki_feats',
  'wiki_bestiary',
  'wiki_items'
];

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // 1. Legacy-таблицы: порядок — сначала зависимые (FK на wiki_entities).
  pgm.sql('DROP INDEX IF EXISTS wiki_translations_fts_idx;');
  pgm.dropTable('wiki_entity_relations', { ifExists: true });
  pgm.dropTable('wiki_entity_stats', { ifExists: true });
  pgm.dropTable('wiki_entity_translations', { ifExists: true });
  pgm.dropTable('wiki_entities', { ifExists: true });

  // 2. Недостающее таблицам wiki-reference.
  for (const tableName of REFERENCE_TABLES) {
    pgm.addColumn(tableName, {
      is_published: {
        type: 'boolean',
        notNull: true,
        default: true
      }
    });
    pgm.sql(`
      CREATE INDEX ${tableName}_fts_idx
      ON ${tableName}
      USING GIN (
        to_tsvector(
          'simple',
          coalesce(name, '') || ' ' || coalesce(name_en, '') || ' ' || coalesce(content, '')
        )
      );
    `);
  }
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  for (const tableName of REFERENCE_TABLES) {
    pgm.sql(`DROP INDEX IF EXISTS ${tableName}_fts_idx;`);
    pgm.dropColumn(tableName, 'is_published');
  }

  // Структура legacy-таблиц из 000015 — без сид-данных.
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

  pgm.addConstraint('wiki_entities', 'wiki_entities_slug_unique', 'UNIQUE (slug)');
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
};
