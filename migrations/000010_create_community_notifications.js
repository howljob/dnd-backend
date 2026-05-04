/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('community_notifications', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    actor_user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users',
      onDelete: 'SET NULL'
    },
    notification_type: {
      type: 'varchar(60)',
      notNull: true
    },
    entity_type: {
      type: 'varchar(60)',
      notNull: true
    },
    entity_id: {
      type: 'uuid',
      notNull: false
    },
    payload: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    is_read: {
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

  pgm.createIndex('community_notifications', ['user_id', 'created_at']);
  pgm.createIndex('community_notifications', ['user_id', 'is_read', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('community_notifications');
};
