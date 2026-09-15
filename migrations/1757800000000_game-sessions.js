/**
 * T4.1: сессии игр, тип игры (кампания/разовая), анкета стола,
 * текст заявки игрока («о себе» и концепт персонажа).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('game_sessions', {
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
    starts_at: {
      type: 'timestamptz',
      notNull: true
    },
    duration_minutes: {
      type: 'integer',
      notNull: false
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'scheduled'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'game_sessions',
    'game_sessions_status_check',
    "CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled'))"
  );

  pgm.addConstraint(
    'game_sessions',
    'game_sessions_duration_minutes_check',
    'CHECK (duration_minutes IS NULL OR duration_minutes > 0)'
  );

  pgm.createIndex('game_sessions', 'game_id');
  pgm.createIndex('game_sessions', 'starts_at');

  pgm.addColumns('games', {
    kind: {
      type: 'text',
      notNull: true,
      default: 'campaign'
    },
    table_profile: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    }
  });

  pgm.addConstraint(
    'games',
    'games_kind_check',
    "CHECK (kind IN ('campaign', 'one_shot'))"
  );

  pgm.addColumns('game_memberships', {
    application_message: {
      type: 'text',
      notNull: false
    },
    character_concept: {
      type: 'text',
      notNull: false
    }
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('game_memberships', ['application_message', 'character_concept']);
  pgm.dropConstraint('games', 'games_kind_check');
  pgm.dropColumns('games', ['kind', 'table_profile']);
  pgm.dropTable('game_sessions');
};
