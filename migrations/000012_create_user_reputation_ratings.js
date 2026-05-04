/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('user_reputation_ratings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    target_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    author_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    game_id: {
      type: 'uuid',
      notNull: false,
      references: 'games',
      onDelete: 'SET NULL'
    },
    context_role: {
      type: 'varchar(20)',
      notNull: true
    },
    score: {
      type: 'numeric(3,2)',
      notNull: true
    },
    comment: {
      type: 'varchar(500)',
      notNull: false
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'user_reputation_ratings',
    'user_reputation_ratings_context_role_check',
    "CHECK (context_role IN ('player', 'gm', 'social'))"
  );

  pgm.addConstraint(
    'user_reputation_ratings',
    'user_reputation_ratings_score_check',
    'CHECK (score >= 0 AND score <= 5)'
  );

  pgm.addConstraint(
    'user_reputation_ratings',
    'user_reputation_ratings_no_self_rating',
    'CHECK (target_user_id <> author_user_id)'
  );

  pgm.createIndex('user_reputation_ratings', ['target_user_id', 'context_role', 'created_at']);
  pgm.createIndex('user_reputation_ratings', ['author_user_id', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('user_reputation_ratings');
};
