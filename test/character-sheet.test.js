// Лист персонажа: нормализация своих формул оружия (weaponOverrides) — шестерёнка у кнопки «Урон» за столом.
// Запуск: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSheet } = require('../src/modules/profile/character-sheet');

test('лист: свои формулы оружия сохраняются и чистятся', () => {
  const sheet = normalizeSheet({
    equipment: ['Секира Гурта', 'Кинжал'],
    weaponOverrides: {
      'Секира Гурта': { hit: '1d20 + 6', damage: '3К12+4' },
      'Кинжал': { hit: '', damage: 'abc' },
      'Пусто': { hit: '', damage: '' },
      'Только урон': { damage: '1d8+1d6+2' }
    }
  }, 5);
  assert.deepEqual(sheet.weaponOverrides, {
    'Секира Гурта': { hit: '1d20+6', damage: '3d12+4' },
    'Только урон': { damage: '1d8+1d6+2' }
  });
});

test('лист: без своих формул — пустой объект; массив вместо объекта — ошибка 400', () => {
  assert.deepEqual(normalizeSheet({}, 1).weaponOverrides, {});
  assert.throws(() => normalizeSheet({ weaponOverrides: [1, 2] }, 1), (e) => e.statusCode === 400);
});
