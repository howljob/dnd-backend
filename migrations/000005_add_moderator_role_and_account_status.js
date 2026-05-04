/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('users', 'users_role_check');

  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('player', 'gm', 'moderator', 'admin'))"
  );

  pgm.addColumn('users', {
    account_status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'active'
    }
  });

  pgm.addConstraint(
    'users',
    'users_account_status_check',
    "CHECK (account_status IN ('active', 'suspended', 'deleted'))"
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('users', 'users_account_status_check');
  pgm.dropColumn('users', 'account_status');

  pgm.dropConstraint('users', 'users_role_check');

  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('player', 'gm', 'admin'))"
  );
};
