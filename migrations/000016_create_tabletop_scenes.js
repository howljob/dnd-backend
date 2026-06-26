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
      type: 'varchar(80)',
      notNull: true
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
    version: {
      type: 'integer',
      notNull: true,
      default: 1
    },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: 'users'
    },
    updated_by: {
      type: 'uuid',
      notNull: true,
      references: 'users'
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
    'tabletop_scenes',
    'tabletop_scenes_name_not_blank_check',
    "CHECK (btrim(name) <> '')"
  );

  pgm.addConstraint(
    'tabletop_scenes',
    'tabletop_scenes_version_positive_check',
    'CHECK (version >= 1)'
  );

  pgm.createIndex('tabletop_scenes', ['game_id', 'created_at']);
  pgm.createIndex('tabletop_scenes', ['game_id', 'is_active']);

  pgm.createIndex(
    'tabletop_scenes',
    'game_id',
    {
      name: 'tabletop_scenes_one_active_per_game_idx',
      unique: true,
      where: 'is_active = true'
    }
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('tabletop_scenes');
};
