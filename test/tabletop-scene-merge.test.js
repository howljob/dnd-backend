// Слияние правок сцены стола: сдвиг одного токена не стирает остальные,
// добавление и удаление — явной заменой списка.
// Запуск: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeScenePatch, filterPublishedStateForPlayer, sanitizeToken } = require('../src/modules/tabletop/tabletop.service');

const base = () => ({
  tokens: [
    { id: 'a', x: 10, y: 10, size: 48, label: 'Герой', hpCurrent: 12, hpMax: 12 },
    { id: 'b', x: 50, y: 50, size: 44, label: 'Гоблин', hpCurrent: 7, hpMax: 7 },
    { id: 'c', x: 90, y: 90, size: 44, label: 'Волк' }
  ],
  grid: { enabled: false, cellPx: 70, offsetX: 0, offsetY: 0 }
});

test('сцена: сдвиг одного токена сохраняет остальные и его метки', () => {
  const next = mergeScenePatch(base(), { tokens: [{ id: 'b', x: 200, y: 210, size: 44 }] });
  assert.equal(next.tokens.length, 3);
  const b = next.tokens.find((t) => t.id === 'b');
  assert.equal(b.x, 200);
  assert.equal(b.label, 'Гоблин');
  assert.equal(b.hpCurrent, 7);
  assert.ok(next.tokens.some((t) => t.id === 'a') && next.tokens.some((t) => t.id === 'c'));
});

test('сцена: новый токен в списке — список принимается целиком', () => {
  const tokens = [...base().tokens, { id: 'd', x: 1, y: 1, size: 40, label: 'Орк' }];
  const next = mergeScenePatch(base(), { tokens });
  assert.equal(next.tokens.length, 4);
});

test('сцена: удаление — только с tokensMode: replace', () => {
  const without = base().tokens.filter((t) => t.id !== 'c');
  const merged = mergeScenePatch(base(), { tokens: without });
  assert.equal(merged.tokens.length, 3, 'без явного режима токен не удаляется');
  const replaced = mergeScenePatch(base(), { tokens: without, tokensMode: 'replace' });
  assert.equal(replaced.tokens.length, 2);
  assert.ok(!('tokensMode' in replaced));
});

test('сцена для игрока: хиты только своих токенов, заметки мастера скрыты', () => {
  const state = {
    tokens: [
      { id: 'a', x: 1, y: 1, size: 40, label: 'Мой', ownerUserId: 'u1', hpCurrent: 5, hpMax: 10, tempHp: 2, gmNote: 'секрет', conditions: [{ id: 'c1', slug: 'poisoned', icon: '🤢', label: 'Отравлен' }] },
      { id: 'b', x: 2, y: 2, size: 40, label: 'Чужой', ownerUserId: 'u2', hpCurrent: 3, hpMax: 9, gmNote: 'тоже секрет' }
    ]
  };
  const view = filterPublishedStateForPlayer(state, 'u1');
  const mine = view.tokens.find((t) => t.id === 'a');
  const theirs = view.tokens.find((t) => t.id === 'b');
  assert.equal(mine.hpCurrent, 5);
  assert.equal(mine.conditions[0].label, 'Отравлен');
  assert.ok(!('gmNote' in mine));
  assert.ok(!('hpCurrent' in theirs) && !('hpMax' in theirs) && !('tempHp' in theirs));
  assert.ok(!('gmNote' in theirs));
});

test('токен: значения приводятся к безопасным', () => {
  const t = sanitizeToken({
    id: 'a', hpCurrent: '93', hpMax: 'abc', tempHp: -4, gmNote: 'x'.repeat(5000),
    conditions: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, icon: '🔥🔥🔥🔥🔥🔥', label: 'y'.repeat(100) }))
  });
  assert.equal(t.hpCurrent, 93);
  assert.equal(t.hpMax, null);
  assert.equal(t.tempHp, 0);
  assert.equal(t.gmNote.length, 2000);
  assert.equal(t.conditions.length, 12);
  assert.ok(t.conditions[0].label.length <= 40 && t.conditions[0].icon.length <= 8);
});

test('сцена: остальные поля патча сливаются как раньше', () => {
  const next = mergeScenePatch(base(), { tokens: [{ id: 'a', x: 5, y: 5, size: 48 }], grid: { enabled: true } });
  assert.equal(next.grid.enabled, true);
  assert.equal(next.grid.cellPx, 70);
});
