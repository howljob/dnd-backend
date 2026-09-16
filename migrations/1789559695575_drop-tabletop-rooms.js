/**
 * T6.4: консолидация API стола — legacy «комнаты» удалены.
 * Единственная модель — сцены, привязанные к игре (tabletop_scenes).
 * Данные комнат никуда не переносятся: рабочее состояние стола давно живёт
 * в tabletop_scenes, а state комнат фронт никогда не читал (grep по js/ пуст).
 *
 * down восстанавливает структуру таблицы в точности по 000017 + 000024
 * (сами данные, разумеется, не восстановимы).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS tabletop_rooms_state_gin_idx;');
  pgm.dropTable('tabletop_rooms');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Структура из 000017_create_tabletop_rooms.js
  pgm.createTable('tabletop_rooms', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    owner_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    name: {
      type: 'varchar(180)',
      notNull: true,
      default: 'Tabletop room'
    },
    player_user_ids: {
      type: 'uuid[]',
      notNull: true,
      default: pgm.func(`'{}'::uuid[]`)
    },
    state: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
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

  pgm.createIndex('tabletop_rooms', ['owner_user_id', 'updated_at']);
  pgm.createIndex('tabletop_rooms', ['updated_at']);
  pgm.sql('CREATE INDEX tabletop_rooms_state_gin_idx ON tabletop_rooms USING GIN (state);');

  // Дополнение из 000024_tabletop_rooms_game_id.js
  pgm.addColumn('tabletop_rooms', {
    game_id: {
      type: 'uuid',
      notNull: false,
      references: 'games',
      onDelete: 'CASCADE'
    }
  });
  pgm.createIndex('tabletop_rooms', 'game_id', { unique: true });
};
