/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true
    },
    password_hash: {
      type: 'varchar(255)',
      notNull: true
    },
    role: {
      type: 'varchar(50)',
      notNull: true
    },
    display_name: {
      type: 'varchar(255)',
      notNull: true
    },
    language: {
      type: 'varchar(10)',
      notNull: true,
      default: 'ru'
    },
    telegram_chat_id: {
      type: 'varchar(100)',
      notNull: false
    },
    email_notifications_enabled: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    telegram_notifications_enabled: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('player', 'gm', 'admin'))"
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('users', 'users_role_check');
  pgm.dropTable('users');
  pgm.dropExtension('pgcrypto', { ifExists: true });
};
