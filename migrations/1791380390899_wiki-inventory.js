/**
 * Раздел вики «Инвентарь»: статьи dnd.su об оружии, доспехах, снаряжении,
 * инструментах, ядах и прочем. Таблица той же формы, что у остальных
 * справочников (как 1791336206485_wiki-conditions), с поисковым вектором и
 * триграммными индексами. Данные заливает import-wiki-reference.js из
 * assets/wiki/inventory/articles.json (докачка — fetch-dnd-su-meta.js inventory).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const TABLE = 'wiki_inventory';

exports.up = (pgm) => {
  pgm.createTable(TABLE, {
    id: { type: 'bigserial', primaryKey: true },
    public_id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()') },
    slug: { type: 'varchar(220)', notNull: true },
    name: { type: 'text', notNull: true },
    name_en: { type: 'text', notNull: true, default: '' },
    source: { type: 'text', notNull: true, default: '' },
    summary: { type: 'text', notNull: true, default: '' },
    content: { type: 'text', notNull: true, default: '' },
    filters: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    payload: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.addConstraint(TABLE, `${TABLE}_public_id_unique`, 'UNIQUE (public_id)');
  pgm.addConstraint(TABLE, `${TABLE}_slug_unique`, 'UNIQUE (slug)');
  pgm.createIndex(TABLE, ['name']);
  pgm.createIndex(TABLE, ['source']);
  pgm.createIndex(TABLE, ['updated_at']);
  pgm.sql(`CREATE INDEX ${TABLE}_filters_gin_idx ON ${TABLE} USING GIN (filters);`);

  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  pgm.sql(`
    ALTER TABLE ${TABLE}
    ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('russian', coalesce(name, '')), 'A')
      || setweight(to_tsvector('simple', coalesce(name_en, '')), 'A')
      || setweight(to_tsvector('russian', coalesce(summary, '')), 'B')
      || setweight(to_tsvector('russian', left(coalesce(content, ''), 200000)), 'C')
    ) STORED;
  `);
  pgm.sql(`CREATE INDEX ${TABLE}_search_vector_idx ON ${TABLE} USING GIN (search_vector);`);
  pgm.sql(`CREATE INDEX ${TABLE}_name_trgm_idx ON ${TABLE} USING GIN (lower(name) gin_trgm_ops);`);
  pgm.sql(`CREATE INDEX ${TABLE}_name_en_trgm_idx ON ${TABLE} USING GIN (lower(name_en) gin_trgm_ops);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS ${TABLE}_name_en_trgm_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS ${TABLE}_name_trgm_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS ${TABLE}_search_vector_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS ${TABLE}_filters_gin_idx;`);
  pgm.dropTable(TABLE);
};
