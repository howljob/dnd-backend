/**
 * T5.7 — продуктовые метрики (первое событие: storage_limit_approach —
 * приближение суммарного размера файлов пользователя к лимиту хранилища).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('metrics_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    name: {
      type: 'varchar(120)',
      notNull: true
    },
    user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users',
      onDelete: 'SET NULL'
    },
    payload: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('metrics_events', ['name', 'created_at']);
  pgm.createIndex('metrics_events', ['user_id', 'name', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('metrics_events');
};
