/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('users', 'users_role_check');

  pgm.sql(`
    UPDATE users
    SET role = 'user'
    WHERE role IN ('player', 'gm');
  `);

  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('user', 'moderator', 'admin'))"
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('users', 'users_role_check');

  pgm.sql(`
    UPDATE users
    SET role = 'player'
    WHERE role = 'user';
  `);

  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('player', 'gm', 'moderator', 'admin'))"
  );
};
