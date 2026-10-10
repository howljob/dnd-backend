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

test('лист: поля трёх страниц официального листа сохраняются и зажимаются в пределах', () => {
  const sheet = normalizeSheet({
    combat: { hpMax: 30, hitDiceUsed: 99, deathSaves: { successes: 5, failures: -1 } },
    proficienciesLanguages: '  Общий, эльфийский  ',
    featuresTraits: 'Второе дыхание',
    attacks: [
      { name: 'Длинный меч', bonus: '+5', damage: '1d8+3 рубящий' },
      { name: '', bonus: '', damage: '' },
      'мусор'
    ],
    money: { gp: 15, cp: -3, pp: 'x' },
    appearance: { age: '27', eyes: 'зелёные', hair: 'рыжие', skin: '', height: '180', weight: '70' },
    allies: { text: 'Арфисты', orgName: 'Арфисты', symbol: 'арфа' },
    additionalFeatures: 'Тёмное зрение',
    treasure: 'Кольцо',
    spellcasting: { className: 'Волшебник', ability: 'INT' },
    spellSlots: { 1: { total: 4, used: 2 }, 3: { total: 2, used: 30 }, 12: { total: 1 } },
    spells: [
      { name: 'Огненный шар', level: 3, prepared: true },
      { name: 'Волшебная рука', type: 'заговор, вызов' },
      { name: 'Щит', type: '1 уровень, ограждение', prepared: 'yes' },
      'Свет'
    ]
  }, 5);
  assert.equal(sheet.combat.hitDiceUsed, 20);
  assert.deepEqual(sheet.combat.deathSaves, { successes: 3, failures: 0 });
  assert.equal(sheet.proficienciesLanguages, 'Общий, эльфийский');
  assert.equal(sheet.featuresTraits, 'Второе дыхание');
  assert.deepEqual(sheet.attacks, [{ name: 'Длинный меч', bonus: '+5', damage: '1d8+3 рубящий' }]);
  assert.deepEqual(sheet.money, { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 });
  assert.equal(sheet.appearance.eyes, 'зелёные');
  assert.equal(sheet.appearance.skin, '');
  assert.deepEqual(sheet.allies, { text: 'Арфисты', orgName: 'Арфисты', symbol: 'арфа' });
  assert.equal(sheet.additionalFeatures, 'Тёмное зрение');
  assert.equal(sheet.treasure, 'Кольцо');
  assert.deepEqual(sheet.spellcasting, { className: 'Волшебник', ability: 'int' });
  assert.deepEqual(sheet.spellSlots[1], { total: 4, used: 2 });
  assert.deepEqual(sheet.spellSlots[3], { total: 2, used: 20 });
  assert.deepEqual(sheet.spellSlots[9], { total: 0, used: 0 });
  assert.equal(Object.keys(sheet.spellSlots).length, 9);
  assert.deepEqual(sheet.spells.map((s) => [s.name, s.level, s.prepared]), [
    ['Огненный шар', 3, true],
    ['Волшебная рука', 0, false],
    ['Щит', 1, true],
    ['Свет', 0, false]
  ]);
  // Пустой лист получает все поля с значениями по умолчанию — фронт на них рассчитывает.
  const empty = normalizeSheet({}, 1);
  assert.deepEqual(empty.attacks, []);
  assert.equal(empty.spellcasting.ability, '');
  assert.deepEqual(empty.combat.deathSaves, { successes: 0, failures: 0 });
  assert.throws(() => normalizeSheet({ attacks: 'нет' }, 1), (e) => e.statusCode === 400);
});

test('лист: избранные броски — только известные виды, без повторов, ключ проверяется', () => {
  const sheet = normalizeSheet({
    favorites: [
      { type: 'check', key: 'str' },
      { type: 'check', key: 'str' },
      { type: 'save', key: 'luck' },
      { type: 'skill', key: 'stealth' },
      { type: 'skill', key: 'flying' },
      { type: 'initiative', key: 'что угодно' },
      { type: 'spellattack' },
      { type: 'weapon', key: 'Длинный меч' },
      { type: 'weapon', key: 'длинный МЕЧ' },
      { type: 'spell', key: 'Огненный шар' },
      { type: 'attack', key: '' },
      { type: 'death' },
      'мусор'
    ]
  }, 3);
  assert.deepEqual(sheet.favorites, [
    { type: 'check', key: 'str' },
    { type: 'skill', key: 'stealth' },
    { type: 'initiative', key: '' },
    { type: 'spellattack', key: '' },
    { type: 'weapon', key: 'Длинный меч' },
    { type: 'spell', key: 'Огненный шар' }
  ]);
  assert.deepEqual(normalizeSheet({}, 1).favorites, []);
  const many = normalizeSheet({ favorites: Array.from({ length: 60 }, (_, i) => ({ type: 'weapon', key: `Меч ${i}` })) }, 1);
  assert.equal(many.favorites.length, 40);
});

test('лист: снаряжение — количество и вес, старые строки — по одному; умения списком', () => {
  const sheet = normalizeSheet({
    equipment: [
      'Верёвка',
      { name: 'Стрелы', qty: '20', weight: '1,5' },
      { name: 'Зелье', qty: 0, weight: '' },
      { name: '', qty: 3 },
      { name: 'Камень', qty: 99999, weight: -5 }
    ],
    features: [
      { name: 'Второе дыхание', source: 'Класс', roll: '1d10+5', description: 'Бонусным действием…', collapsed: 'yes' },
      { name: '', description: '', roll: '' },
      { name: 'Тёмное зрение', source: 'Раса', description: 'Радиус 60 футов' }
    ],
    favorites: [{ type: 'feature', key: 'Второе дыхание' }]
  }, 3);
  assert.deepEqual(sheet.equipment, [
    { name: 'Верёвка', qty: 1, weight: null },
    { name: 'Стрелы', qty: 20, weight: 1.5 },
    { name: 'Зелье', qty: 1, weight: null },
    { name: 'Камень', qty: 9999, weight: 0 }
  ]);
  assert.deepEqual(sheet.features, [
    { name: 'Второе дыхание', source: 'Класс', roll: '1d10+5', description: 'Бонусным действием…', collapsed: true },
    { name: 'Тёмное зрение', source: 'Раса', roll: '', description: 'Радиус 60 футов', collapsed: false }
  ]);
  assert.deepEqual(sheet.favorites, [{ type: 'feature', key: 'Второе дыхание' }]);
  assert.deepEqual(normalizeSheet({}, 1).features, []);
  assert.throws(() => normalizeSheet({ features: 'текст' }, 1), (e) => e.statusCode === 400);
});

test('лист: без своих формул — пустой объект; массив вместо объекта — ошибка 400', () => {
  assert.deepEqual(normalizeSheet({}, 1).weaponOverrides, {});
  assert.throws(() => normalizeSheet({ weaponOverrides: [1, 2] }, 1), (e) => e.statusCode === 400);
});
