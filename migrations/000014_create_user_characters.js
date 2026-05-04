/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('user_characters', {
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
    name: {
      type: 'varchar(120)',
      notNull: true
    },
    game_system: {
      type: 'varchar(120)',
      notNull: true
    },
    class_name: {
      type: 'varchar(120)',
      notNull: true
    },
    race: {
      type: 'varchar(120)',
      notNull: false
    },
    level: {
      type: 'integer',
      notNull: true,
      default: 1
    },
    campaign_name: {
      type: 'varchar(180)',
      notNull: false
    },
    background: {
      type: 'varchar(300)',
      notNull: false
    },
    notes: {
      type: 'text',
      notNull: false
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'active'
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
    'user_characters',
    'user_characters_level_check',
    'CHECK (level >= 1 AND level <= 20)'
  );

  pgm.addConstraint(
    'user_characters',
    'user_characters_status_check',
    "CHECK (status IN ('active', 'archived'))"
  );

  pgm.createIndex('user_characters', ['user_id', 'updated_at']);
  pgm.createIndex('user_characters', ['user_id', 'status', 'updated_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('user_characters');
};
