/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO game_memberships (
      game_id,
      user_id,
      member_role,
      status,
      created_at,
      updated_at
    )
    SELECT
      g.id,
      g.creator_id,
      CASE
        WHEN u.role = 'gm' THEN 'gm'
        ELSE 'player'
      END,
      'approved',
      now(),
      now()
    FROM games g
    INNER JOIN users u ON u.id = g.creator_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM game_memberships gm
      WHERE gm.game_id = g.id
        AND gm.user_id = g.creator_id
    );
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = () => {};
