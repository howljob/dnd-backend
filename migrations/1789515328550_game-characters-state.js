/**
 * T5.4 — модель «шаблон + копия на стол».
 *
 * game_characters получает:
 *   - state jsonb NOT NULL DEFAULT '{}' — независимый прогресс копии на этом
 *     столе (hp, tempHp, level, inventory, notes). Урон в одной игре не виден
 *     в другой и не трогает шаблон.
 *   - created_from_sheet jsonb NULL — снимок листа шаблона на момент привязки
 *     (для отображения листа копии без обращения к шаблону).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('game_characters', {
    state: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    created_from_sheet: {
      type: 'jsonb',
      notNull: false
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('game_characters', ['state', 'created_from_sheet', 'updated_at']);
};
