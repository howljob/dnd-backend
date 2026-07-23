/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  const tables = [
    'wiki_spells',
    'wiki_classes',
    'wiki_races',
    'wiki_backgrounds',
    'wiki_feats',
    'wiki_bestiary',
    'wiki_items'
  ];

  for (const tableName of tables) {
    pgm.createTable(tableName, {
      id: {
        type: 'bigserial',
        primaryKey: true
      },
      public_id: {
        type: 'uuid',
        notNull: true,
        default: pgm.func('gen_random_uuid()')
      },
      slug: {
        type: 'varchar(220)',
        notNull: true
      },
      name: {
        type: 'text',
        notNull: true
      },
      name_en: {
        type: 'text',
        notNull: true,
        default: ''
      },
      source: {
        type: 'text',
        notNull: true,
        default: ''
      },
      summary: {
        type: 'text',
        notNull: true,
        default: ''
      },
      content: {
        type: 'text',
        notNull: true,
        default: ''
      },
      filters: {
        type: 'jsonb',
        notNull: true,
        default: pgm.func(`'{}'::jsonb`)
      },
      payload: {
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
      tableName,
      `${tableName}_public_id_unique`,
      'UNIQUE (public_id)'
    );
    pgm.addConstraint(
      tableName,
      `${tableName}_slug_unique`,
      'UNIQUE (slug)'
    );

    pgm.createIndex(tableName, ['name']);
    pgm.createIndex(tableName, ['source']);
    pgm.createIndex(tableName, ['updated_at']);
    pgm.sql(`CREATE INDEX ${tableName}_filters_gin_idx ON ${tableName} USING GIN (filters);`);
  }
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  const tables = [
    'wiki_items',
    'wiki_bestiary',
    'wiki_feats',
    'wiki_backgrounds',
    'wiki_races',
    'wiki_classes',
    'wiki_spells'
  ];

  for (const tableName of tables) {
    pgm.sql(`DROP INDEX IF EXISTS ${tableName}_filters_gin_idx;`);
    pgm.dropTable(tableName);
  }
};
