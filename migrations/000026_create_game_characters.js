/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('game_characters', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    game_id: {
      type: 'uuid',
      notNull: true,
      references: 'games',
      onDelete: 'CASCADE'
    },
    character_id: {
      type: 'uuid',
      notNull: true,
      references: 'user_characters',
      onDelete: 'CASCADE'
    },
    user_id: {
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
    'game_characters',
    'game_characters_unique_character_per_game',
    'UNIQUE (game_id, character_id)'
  );

  pgm.createIndex('game_characters', ['game_id', 'user_id']);
  pgm.createIndex('game_characters', ['user_id', 'game_id']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('game_characters');
};
