/**
 * T3.2: подтверждение email + одноразовые токены (подтверждение почты / сброс пароля).
 *
 * - users.email_confirmed_at — когда почта подтверждена (NULL = не подтверждена).
 *   Все существующие на момент миграции пользователи считаются подтверждёнными (backfill).
 * - auth_action_tokens — одноразовые токены со сроком жизни; в базе хранится только
 *   SHA-256-хэш токена, сырой токен уходит пользователю в письме.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    email_confirmed_at: {
      type: 'timestamptz',
      notNull: false
    }
  });

  // Существующие до миграции пользователи — подтверждены.
  pgm.sql('UPDATE users SET email_confirmed_at = now() WHERE email_confirmed_at IS NULL');

  pgm.createTable('auth_action_tokens', {
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
    token_hash: {
      type: 'varchar(64)',
      notNull: true,
      unique: true
    },
    type: {
      type: 'varchar(30)',
      notNull: true
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true
    },
    used_at: {
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
    'auth_action_tokens',
    'auth_action_tokens_type_check',
    "CHECK (type IN ('confirm_email', 'password_reset'))"
  );

  pgm.createIndex('auth_action_tokens', ['user_id', 'type', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('auth_action_tokens');
  pgm.dropColumn('users', 'email_confirmed_at');
};
