/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('community_posts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    author_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    post_kind: {
      type: 'varchar(20)',
      notNull: true,
      default: 'text'
    },
    title: {
      type: 'varchar(200)',
      notNull: false
    },
    content_text: {
      type: 'text',
      notNull: true
    },
    visibility: {
      type: 'varchar(20)',
      notNull: true,
      default: 'public'
    },
    metadata: {
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
    },
    deleted_at: {
      type: 'timestamptz',
      notNull: false
    }
  });

  pgm.addConstraint(
    'community_posts',
    'community_posts_post_kind_check',
    "CHECK (post_kind IN ('text', 'lfg'))"
  );

  pgm.addConstraint(
    'community_posts',
    'community_posts_visibility_check',
    "CHECK (visibility IN ('public'))"
  );

  pgm.createIndex('community_posts', ['created_at']);
  pgm.createIndex('community_posts', ['author_user_id', 'created_at']);
  pgm.createIndex('community_posts', ['deleted_at', 'created_at']);

  pgm.createTable('community_post_reactions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    post_id: {
      type: 'uuid',
      notNull: true,
      references: 'community_posts',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    reaction_type: {
      type: 'varchar(20)',
      notNull: true,
      default: 'like'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'community_post_reactions',
    'community_post_reactions_reaction_type_check',
    "CHECK (reaction_type IN ('like'))"
  );
  pgm.addConstraint(
    'community_post_reactions',
    'community_post_reactions_unique_per_user',
    'UNIQUE (post_id, user_id, reaction_type)'
  );
  pgm.createIndex('community_post_reactions', ['post_id']);
  pgm.createIndex('community_post_reactions', ['user_id', 'created_at']);

  pgm.createTable('community_post_comments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    post_id: {
      type: 'uuid',
      notNull: true,
      references: 'community_posts',
      onDelete: 'CASCADE'
    },
    author_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    content_text: {
      type: 'text',
      notNull: true
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
    },
    deleted_at: {
      type: 'timestamptz',
      notNull: false
    }
  });

  pgm.createIndex('community_post_comments', ['post_id', 'created_at']);
  pgm.createIndex('community_post_comments', ['author_user_id', 'created_at']);

  pgm.createTable('community_follows', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    follower_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    followee_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.addConstraint(
    'community_follows',
    'community_follows_unique_relation',
    'UNIQUE (follower_user_id, followee_user_id)'
  );
  pgm.addConstraint(
    'community_follows',
    'community_follows_no_self_follow',
    'CHECK (follower_user_id <> followee_user_id)'
  );
  pgm.createIndex('community_follows', ['follower_user_id', 'created_at']);
  pgm.createIndex('community_follows', ['followee_user_id', 'created_at']);

  pgm.createTable('community_activity_events', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    actor_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    event_type: {
      type: 'varchar(80)',
      notNull: true
    },
    entity_type: {
      type: 'varchar(80)',
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
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createIndex('community_activity_events', ['created_at']);
  pgm.createIndex('community_activity_events', ['actor_user_id', 'created_at']);
  pgm.createIndex('community_activity_events', ['event_type', 'created_at']);

  pgm.sql(`
    INSERT INTO community_posts (
      author_user_id,
      post_kind,
      title,
      content_text,
      visibility,
      metadata,
      created_at,
      updated_at
    )
    SELECT
      author_user_id,
      'lfg',
      title,
      description,
      'public',
      jsonb_build_object(
        'type', post_type,
        'system', game_system,
        'format', game_format,
        'schedule', preferred_schedule
      ),
      created_at,
      updated_at
    FROM community_lfg_posts
    WHERE is_active = true
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('community_activity_events');
  pgm.dropTable('community_follows');
  pgm.dropTable('community_post_comments');
  pgm.dropTable('community_post_reactions');
  pgm.dropTable('community_posts');
};
