/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('site_content', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    content_key: {
      type: 'varchar(200)',
      notNull: true
    },
    locale: {
      type: 'varchar(10)',
      notNull: true
    },
    content: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    updated_by: {
      type: 'uuid',
      notNull: false,
      references: 'users'
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
    'site_content',
    'site_content_key_locale_unique',
    'UNIQUE (content_key, locale)'
  );

  pgm.addConstraint(
    'site_content',
    'site_content_locale_check',
    "CHECK (locale IN ('ru', 'en'))"
  );

  pgm.createIndex('site_content', ['content_key', 'locale']);

  pgm.createTable('admin_audit_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    actor_user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users'
    },
    actor_role: {
      type: 'varchar(50)',
      notNull: true
    },
    action: {
      type: 'varchar(200)',
      notNull: true
    },
    target_type: {
      type: 'varchar(100)',
      notNull: true
    },
    target_id: {
      type: 'varchar(120)',
      notNull: false
    },
    details: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(`'{}'::jsonb`)
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('admin_audit_logs', 'created_at');
  pgm.createIndex('admin_audit_logs', ['action', 'target_type']);
  pgm.createIndex('admin_audit_logs', 'actor_user_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('admin_audit_logs');
  pgm.dropTable('site_content');
};
