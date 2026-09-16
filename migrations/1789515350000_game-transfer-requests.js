/**
 * T8.4: передача брошенной игры по запросу группы.
 * Любой одобренный участник инициирует запрос с кандидатом из участников.
 * Мастер одобряет (approved) или отклоняет (declined); если мастер молчит
 * дольше TRANSFER_TIMEOUT_DAYS — любой участник завершает передачу
 * (expired-completed). Персонажи и сессии не трогаются.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('game_transfer_requests', {
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
    initiated_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    candidate_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    status: {
      type: 'varchar(30)',
      notNull: true,
      default: 'pending'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    },
    resolved_at: {
      type: 'timestamptz',
      notNull: false
    }
  });

  pgm.addConstraint(
    'game_transfer_requests',
    'game_transfer_requests_status_check',
    "CHECK (status IN ('pending', 'approved', 'declined', 'expired-completed'))"
  );

  // Не больше одного открытого запроса на игру.
  pgm.createIndex('game_transfer_requests', 'game_id', {
    name: 'game_transfer_requests_one_pending_idx',
    unique: true,
    where: "status = 'pending'"
  });

  pgm.createIndex('game_transfer_requests', ['game_id', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('game_transfer_requests');
};
