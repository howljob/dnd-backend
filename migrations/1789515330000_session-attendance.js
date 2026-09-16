/**
 * T8.2: присутствие на сессии.
 * Мастер после завершения сессии отмечает, кто был (present) и кто нет (absent).
 * Неявка не наказывает автоматически — она просто видна в профиле
 * («посещено X из Y сессий», где Y — сессии с отметкой мастера).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('session_attendance', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'game_sessions',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    status: {
      type: 'varchar(10)',
      notNull: true
    },
    marked_by: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
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
    'session_attendance',
    'session_attendance_status_check',
    "CHECK (status IN ('present', 'absent'))"
  );

  pgm.addConstraint(
    'session_attendance',
    'session_attendance_session_user_key',
    'UNIQUE (session_id, user_id)'
  );

  pgm.createIndex('session_attendance', 'user_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('session_attendance');
};
