/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
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
  pgm.sql(`CREATE INDEX tabletop_rooms_state_gin_idx ON tabletop_rooms USING GIN (state);`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS tabletop_rooms_state_gin_idx;');
  pgm.dropTable('tabletop_rooms');
};

