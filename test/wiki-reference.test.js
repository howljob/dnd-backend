// Вики: поиск по разделам и по всей вики, точные фильтры, сортировки,
// машиночитаемые данные записи. Требует импортированной вики в базе
// (npm run wiki:import-reference); без неё тест пропускается.
//
// Запуск: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const pool = require('../src/db/pool');

let server;
let baseUrl;
let hasWiki = false;

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  let json = null;
  try {
    json = await res.json();
  } catch {
    // не-JSON ответ
  }
  return { status: res.status, json };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const count = await pool.query('SELECT count(*)::int AS c FROM wiki_bestiary');
  hasWiki = Number(count.rows[0]?.c || 0) > 100;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('вики: поиск, фильтры, сортировки, данные записи', async (t) => {
  if (!hasWiki) {
    t.skip('вики не импортирована в базу');
    return;
  }

  // Поиск по разделу: сначала точное название.
  const spells = await get(`/api/wiki/reference/spells/entities?q=${encodeURIComponent('огненный шар')}`);
  assert.equal(spells.status, 200);
  assert.equal(spells.json.items[0]?.name, 'Огненный шар');
  assert.equal(spells.json.sort, 'relevance');

  // Без запроса — по алфавиту.
  const list = await get('/api/wiki/reference/spells/entities?limit=3');
  assert.equal(list.json.sort, 'name');
  const names = list.json.items.map((i) => i.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ru')));

  // Точные фильтры: опасность «1» не ловит «1/2» и «10».
  const cr1 = await get('/api/wiki/reference/bestiary/entities?challenge=1&limit=120');
  assert.ok(cr1.json.total > 0);
  assert.ok(cr1.json.items.every((i) => i.stats.challenge === '1'), 'в выдаче опасность не «1»');

  // Фильтр по классу внутри списка «бард, волшебник».
  const wizardRituals = await get(`/api/wiki/reference/spells/entities?classes=${encodeURIComponent('волшебник')}&ritual=true&level=1&limit=50`);
  assert.ok(wizardRituals.json.total > 0);
  assert.ok(wizardRituals.json.items.every((i) => i.stats.ritual === true && i.stats.level === '1' && /волшебник/.test(i.stats.classes)));

  // Сортировка по опасности.
  const dragons = await get(`/api/wiki/reference/bestiary/entities?type=${encodeURIComponent('Дракон')}&sort=challenge&limit=50`);
  const crs = dragons.json.items.map((i) => Number(i.stats.cr_value));
  assert.deepEqual(crs, [...crs].sort((a, b) => a - b));

  // Поиск по всей вики.
  const all = await get(`/api/wiki/reference/search?q=${encodeURIComponent('гоблин')}`);
  assert.equal(all.status, 200);
  const bestiary = all.json.sections.find((s) => s.section === 'bestiary');
  assert.ok(bestiary && bestiary.total > 0);
  assert.equal(bestiary.items[0].name, 'Гоблин');
  const empty = await get('/api/wiki/reference/search');
  assert.equal(empty.status, 400);

  // Значения фильтров раздела.
  const filters = await get('/api/wiki/reference/bestiary/filters');
  const challenge = filters.json.fields.find((f) => f.key === 'challenge');
  assert.ok(challenge.values.includes('1/4') && challenge.values.includes('22'));
  assert.ok(!challenge.values.some((v) => /опыта/.test(v)), 'в значениях опасности остался текст');
  assert.deepEqual(filters.json.sorts, ['name', 'updatedAt', 'challenge']);

  // Машиночитаемые данные монстра для стола.
  const goblin = await get('/api/wiki/reference/bestiary/entities/goblin');
  assert.equal(goblin.json.item.name, 'Гоблин');
  assert.equal(goblin.json.item.data.armorClass, 15);
  assert.equal(goblin.json.item.data.hitPoints, 7);
  assert.equal(goblin.json.item.data.abilities.dex.modifier, 2);
  assert.ok(goblin.json.item.data.actions.some((a) => a.name === 'Скимитар'));

  // Данные заклинания для листа персонажа.
  const fireball = spells.json.items[0];
  const detail = await get(`/api/wiki/reference/spells/entities/${encodeURIComponent(fireball.slug)}`);
  assert.equal(detail.json.item.data.level, 3);
  assert.equal(detail.json.item.data.school, 'Воплощение');
  assert.ok(detail.json.item.data.components.material);
  assert.ok(detail.json.item.data.classes.includes('волшебник'));

  // Заклинание по английскому имени — так они записаны в текстах монстров («волшебная стрела [magic missile]»).
  const byEn = await get(`/api/wiki/reference/spells/entities/${encodeURIComponent('en:magic missile')}`);
  assert.equal(byEn.status, 200);
  assert.equal(byEn.json.item.name, 'Волшебная стрела');
  const byEnPunct = await get(`/api/wiki/reference/spells/entities/${encodeURIComponent("en:Tasha's hideous laughter")}`);
  assert.equal(byEnPunct.status, 200);
  assert.equal(byEnPunct.json.item.data.level, 1);

  // Раздел «Состояния»: 15 записей с dnd.su, эффекты списком, текст markdown с таблицей истощения.
  const conditions = await get('/api/wiki/reference/conditions/entities?limit=50');
  assert.equal(conditions.status, 200);
  assert.equal(conditions.json.total, 15);
  const frightened = await get('/api/wiki/reference/conditions/entities/frightened');
  assert.equal(frightened.json.item.name, 'Испуганный');
  assert.equal(frightened.json.item.entityType, 'condition');
  assert.equal(frightened.json.item.data.effects.length, 2);
  const exhaustion = await get('/api/wiki/reference/conditions/entities/exhaustion');
  assert.ok(/\| Степень \| Эффект \|/.test(exhaustion.json.item.content));

  // Статблок монстра: после знака подсказки «?» dnd.su иммунитеты чистые.
  const flameskull = await get('/api/wiki/reference/bestiary/entities/flameskull');
  assert.equal(flameskull.json.item.name, 'Пылающий череп');
  assert.ok(!/\?/.test(flameskull.json.item.data.conditionImmunities), flameskull.json.item.data.conditionImmunities);
});
