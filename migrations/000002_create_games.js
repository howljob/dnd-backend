/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('game_types', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    slug: {
      type: 'varchar(100)',
      notNull: true,
      unique: true
    },
    name: {
      type: 'varchar(200)',
      notNull: true,
      unique: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createTable('game_statuses', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    slug: {
      type: 'varchar(100)',
      notNull: true,
      unique: true
    },
    name: {
      type: 'varchar(200)',
      notNull: true,
      unique: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  pgm.createTable('games', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    creator_id: {
      type: 'uuid',
      notNull: true,
      references: 'users'
    },
    title: {
      type: 'varchar(200)',
      notNull: true
    },
    game_type_id: {
      type: 'uuid',
      notNull: true,
      references: 'game_types'
    },
    description: {
      type: 'text',
      notNull: true
    },
    starts_at: {
      type: 'timestamptz',
      notNull: true
    },
    max_players: {
      type: 'integer',
      notNull: true
    },
    language: {
      type: 'varchar(10)',
      notNull: true
    },
    player_level: {
      type: 'varchar(20)',
      notNull: true
    },
    is_paid: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    price_amount: {
      type: 'numeric(10,2)',
      notNull: false
    },
    format: {
      type: 'varchar(20)',
      notNull: true
    },
    location: {
      type: 'text',
      notNull: false
    },
    status_id: {
      type: 'uuid',
      notNull: true,
      references: 'game_statuses'
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
    'games',
    'games_max_players_check',
    'CHECK (max_players > 0)'
  );

  pgm.addConstraint(
    'games',
    'games_language_check',
    "CHECK (language IN ('ru', 'en'))"
  );

  pgm.addConstraint(
    'games',
    'games_player_level_check',
    "CHECK (player_level IN ('beginner', 'intermediate', 'advanced'))"
  );

  pgm.addConstraint(
    'games',
    'games_format_check',
    "CHECK (format IN ('online', 'offline'))"
  );

  pgm.addConstraint(
    'games',
    'games_price_amount_check',
    `CHECK (
      (is_paid = false AND price_amount IS NULL)
      OR
      (is_paid = true AND price_amount IS NOT NULL AND price_amount > 0)
    )`
  );

  pgm.addConstraint(
    'games',
    'games_location_check',
    `CHECK (
      (format = 'offline' AND location IS NOT NULL AND btrim(location) <> '')
      OR
      (format = 'online' AND location IS NULL)
    )`
  );

  pgm.createIndex('games', 'creator_id');
  pgm.createIndex('games', 'game_type_id');
  pgm.createIndex('games', 'status_id');
  pgm.createIndex('games', 'starts_at');

  pgm.sql(`
    INSERT INTO game_types (slug, name)
    VALUES
      ('dnd', 'Dungeons & Dragons'),
      ('call-of-cthulhu', 'Call of Cthulhu'),
      ('pathfinder', 'Pathfinder'),
      ('vampire', 'Vampire: The Masquerade'),
      ('other', 'Other');
  `);

  pgm.sql(`
    INSERT INTO game_statuses (slug, name)
    VALUES
      ('active', 'Active'),
      ('cancelled', 'Cancelled'),
      ('completed', 'Completed');
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('games');
  pgm.dropTable('game_statuses');
  pgm.dropTable('game_types');
};
