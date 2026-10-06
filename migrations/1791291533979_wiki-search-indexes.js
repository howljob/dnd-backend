/**
 * Быстрый поиск по вики: полнотекстовый вектор (русский словарь) и
 * триграммные индексы по названиям — поиск по подстроке «огн» и по
 * словоформам «гоблины» перестаёт сканировать таблицы целиком.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const TABLES = [
  'wiki_spells',
  'wiki_classes',
  'wiki_races',
  'wiki_backgrounds',
  'wiki_feats',
  'wiki_bestiary',
  'wiki_items'
];

exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

  for (const table of TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(name, '')), 'A')
        || setweight(to_tsvector('simple', coalesce(name_en, '')), 'A')
        || setweight(to_tsvector('russian', coalesce(summary, '')), 'B')
        || setweight(to_tsvector('russian', left(coalesce(content, ''), 200000)), 'C')
      ) STORED;
    `);
    pgm.sql(`CREATE INDEX ${table}_search_vector_idx ON ${table} USING GIN (search_vector);`);
    pgm.sql(`CREATE INDEX ${table}_name_trgm_idx ON ${table} USING GIN (lower(name) gin_trgm_ops);`);
    pgm.sql(`CREATE INDEX ${table}_name_en_trgm_idx ON ${table} USING GIN (lower(name_en) gin_trgm_ops);`);
  }
};

exports.down = (pgm) => {
  for (const table of TABLES) {
    pgm.sql(`DROP INDEX IF EXISTS ${table}_name_en_trgm_idx;`);
    pgm.sql(`DROP INDEX IF EXISTS ${table}_name_trgm_idx;`);
    pgm.sql(`DROP INDEX IF EXISTS ${table}_search_vector_idx;`);
    pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS search_vector;`);
  }
  // Расширение pg_trgm не удаляем: им могут пользоваться другие объекты.
};
