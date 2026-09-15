/**
 * T8.1: оценка привязана к сессии.
 * - user_reputation_ratings.session_id (FK game_sessions) — новая оценка обязана
 *   ссылаться на завершённую сессию (правило контролирует сервис).
 * - Уникальность (author_user_id, target_user_id, session_id): один раз за сессию
 *   на человека. Старые записи с session_id IS NULL — легаси, остаются и входят
 *   в средний балл.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('user_reputation_ratings', {
    session_id: {
      type: 'uuid',
      notNull: false,
      references: 'game_sessions',
      onDelete: 'SET NULL'
    }
  });

  pgm.createIndex(
    'user_reputation_ratings',
    ['author_user_id', 'target_user_id', 'session_id'],
    {
      name: 'user_reputation_ratings_once_per_session_idx',
      unique: true,
      where: 'session_id IS NOT NULL'
    }
  );

  pgm.createIndex('user_reputation_ratings', 'session_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('user_reputation_ratings', 'session_id');
  pgm.dropIndex('user_reputation_ratings', ['author_user_id', 'target_user_id', 'session_id'], {
    name: 'user_reputation_ratings_once_per_session_idx'
  });
  pgm.dropColumn('user_reputation_ratings', 'session_id');
};
