/**
 * T6.1: серверный лог событий игрового стола (броски, действия, служебные события).
 * id — bigserial: монотонный порядок нужен для пагинации (?before=) и докачки
 * пропущенных событий после переподключения (?after=lastEventId).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('table_events', {
    id: {
      type: 'bigserial',
      primaryKey: true
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games',
      onDelete: 'CASCADE'
    },
    session_id: {
      type: 'uuid',
      notNull: false,
      references: 'game_sessions',
      onDelete: 'SET NULL'
    },
    type: {
      type: 'text',
      notNull: true
    },
    actor_user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users',
      onDelete: 'SET NULL'
    },
    actor_name: {
      type: 'text',
      notNull: false
    },
    payload: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    is_private: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('table_events', ['game_id', 'created_at']);
  pgm.createIndex('table_events', ['game_id', 'id']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('table_events');
};
