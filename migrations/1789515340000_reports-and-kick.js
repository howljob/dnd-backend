/**
 * T8.3: кик и жалобы.
 * - Статус 'kicked' у game_memberships: мастер удаляет участника; запись остаётся,
 *   чтобы человек не мог снова подать заявку в ту же игру.
 * - Таблица reports: жалоба любого участника игры на любого участника той же игры,
 *   включая мастера. Разбирает администратор (open → resolved/dismissed).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('game_memberships', 'game_memberships_status_check');
  pgm.addConstraint(
    'game_memberships',
    'game_memberships_status_check',
    "CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'kicked'))"
  );

  pgm.createTable('reports', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    reporter_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    target_user_id: {
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
    reason: {
      type: 'text',
      notNull: true
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'open'
    },
    resolved_by: {
      type: 'uuid',
      notNull: false,
      references: 'users',
      onDelete: 'SET NULL'
    },
    resolved_at: {
      type: 'timestamptz',
      notNull: false
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'reports',
    'reports_status_check',
    "CHECK (status IN ('open', 'resolved', 'dismissed'))"
  );

  pgm.addConstraint(
    'reports',
    'reports_no_self_report',
    'CHECK (reporter_id <> target_user_id)'
  );

  pgm.createIndex('reports', ['status', 'created_at']);
  pgm.createIndex('reports', 'target_user_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('reports');

  // Вернуть прежний список статусов можно только без записей 'kicked'.
  pgm.sql("DELETE FROM game_memberships WHERE status = 'kicked'");
  pgm.dropConstraint('game_memberships', 'game_memberships_status_check');
  pgm.addConstraint(
    'game_memberships',
    'game_memberships_status_check',
    "CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))"
  );
};
