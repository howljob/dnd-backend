/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    bio: {
      type: 'text',
      notNull: false
    },
    avatar_url: {
      type: 'text',
      notNull: false
    }
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('users', 'avatar_url');
  pgm.dropColumn('users', 'bio');
};
