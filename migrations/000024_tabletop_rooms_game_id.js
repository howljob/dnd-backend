/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
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

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('tabletop_rooms', 'game_id');
  pgm.dropColumn('tabletop_rooms', 'game_id');
};
