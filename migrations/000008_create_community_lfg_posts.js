/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('community_lfg_posts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    author_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    post_type: {
      type: 'varchar(20)',
      notNull: true
    },
    title: {
      type: 'varchar(200)',
      notNull: true
    },
    description: {
      type: 'text',
      notNull: true
    },
    game_system: {
      type: 'varchar(120)',
      notNull: true
    },
    game_format: {
      type: 'varchar(20)',
      notNull: true
    },
    preferred_schedule: {
      type: 'varchar(160)',
      notNull: true
    },
    is_active: {
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
    'community_lfg_posts',
    'community_lfg_posts_type_check',
    "CHECK (post_type IN ('player', 'dm'))"
  );

  pgm.addConstraint(
    'community_lfg_posts',
    'community_lfg_posts_format_check',
    "CHECK (game_format IN ('online', 'offline', 'either'))"
  );

  pgm.createIndex('community_lfg_posts', ['is_active', 'created_at']);
  pgm.createIndex('community_lfg_posts', ['author_user_id', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('community_lfg_posts');
};
