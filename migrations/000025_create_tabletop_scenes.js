/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('tabletop_scenes', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games',
      onDelete: 'CASCADE'
    },
    name: {
      type: 'varchar(180)',
      notNull: true,
      default: 'Scene'
    },
    sort_order: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    draft_state: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    published_state: {
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

  pgm.createIndex('tabletop_scenes', ['game_id', 'sort_order']);
  pgm.createIndex('tabletop_scenes', ['game_id', 'updated_at']);
  pgm.sql(`
    CREATE UNIQUE INDEX tabletop_scenes_one_active_per_game
    ON tabletop_scenes (game_id)
    WHERE is_active = true;
  `);
  pgm.sql(`CREATE INDEX tabletop_scenes_draft_gin_idx ON tabletop_scenes USING GIN (draft_state);`);
  pgm.sql(`CREATE INDEX tabletop_scenes_published_gin_idx ON tabletop_scenes USING GIN (published_state);`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS tabletop_scenes_published_gin_idx;');
  pgm.sql('DROP INDEX IF EXISTS tabletop_scenes_draft_gin_idx;');
  pgm.sql('DROP INDEX IF EXISTS tabletop_scenes_one_active_per_game;');
  pgm.dropTable('tabletop_scenes');
};
