/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('game_memberships', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games'
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users'
    },
    member_role: {
      type: 'varchar(20)',
      notNull: true
    },
    status: {
      type: 'varchar(20)',
      notNull: true
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
    'game_memberships',
    'game_memberships_member_role_check',
    "CHECK (member_role IN ('gm', 'player'))"
  );

  pgm.addConstraint(
    'game_memberships',
    'game_memberships_status_check',
    "CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))"
  );

  pgm.addConstraint(
    'game_memberships',
    'game_memberships_game_id_user_id_key',
    'UNIQUE (game_id, user_id)'
  );

  pgm.createIndex('game_memberships', 'game_id');
  pgm.createIndex('game_memberships', 'user_id');

  pgm.createIndex(
    'game_memberships',
    'game_id',
    {
      name: 'game_memberships_one_approved_gm_idx',
      unique: true,
      where: "member_role = 'gm' AND status = 'approved'"
    }
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('game_memberships');
};
