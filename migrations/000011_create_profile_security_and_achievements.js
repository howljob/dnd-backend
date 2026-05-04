/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('user_sessions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    token_id: {
      type: 'uuid',
      notNull: true,
      unique: true
    },
    user_agent: {
      type: 'varchar(500)',
      notNull: false
    },
    ip_address: {
      type: 'varchar(120)',
      notNull: false
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    last_seen_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    revoked_at: {
      type: 'timestamptz',
      notNull: false
    },
    revoked_reason: {
      type: 'varchar(80)',
      notNull: false
    }
  });

  pgm.createIndex('user_sessions', ['user_id', 'last_seen_at']);
  pgm.createIndex('user_sessions', ['user_id', 'revoked_at']);

  pgm.createTable('user_achievement_progress', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    achievement_id: {
      type: 'varchar(120)',
      notNull: true
    },
    metric_key: {
      type: 'varchar(120)',
      notNull: true
    },
    progress_value: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    target_value: {
      type: 'integer',
      notNull: true,
      default: 1
    },
    points: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    rarity: {
      type: 'varchar(20)',
      notNull: true,
      default: 'common'
    },
    tier: {
      type: 'varchar(20)',
      notNull: true,
      default: 'bronze'
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'mvp'
    },
    unlocked_at: {
      type: 'timestamptz',
      notNull: false
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
    'user_achievement_progress',
    'user_achievement_progress_unique_user_achievement',
    'UNIQUE (user_id, achievement_id)'
  );

  pgm.addConstraint(
    'user_achievement_progress',
    'user_achievement_progress_rarity_check',
    "CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary'))"
  );

  pgm.addConstraint(
    'user_achievement_progress',
    'user_achievement_progress_tier_check',
    "CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum'))"
  );

  pgm.addConstraint(
    'user_achievement_progress',
    'user_achievement_progress_status_check',
    "CHECK (status IN ('mvp', 'future'))"
  );

  pgm.createIndex('user_achievement_progress', ['user_id', 'updated_at']);
  pgm.createIndex('user_achievement_progress', ['user_id', 'unlocked_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('user_achievement_progress');
  pgm.dropTable('user_sessions');
};
