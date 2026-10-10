// Перенос персонажа из Roll20: PDF листа (сохранён из браузера) → черновик персонажа и список
// «проверьте». Образец — test/fixtures/roll20-sheet.pdf (волшебник 9 уровня, лист на русском).
//
// Запуск: npm test (база должна быть поднята и мигрирована; проверки справочника — при
// импортированной вики).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const app = require('../src/app');
const pool = require('../src/db/pool');
const roll20 = require('../src/modules/profile/roll20-import');

let server;
let baseUrl;

async function api(method, urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function upload(token, { name, mime, bytes }) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), name);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${baseUrl}/api/profile/characters/import/roll20`, { method: 'POST', headers, body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function registerAndLogin() {
  const email = `roll20-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = 'Roll20-Passw0rd!';
  const reg = await api('POST', '/api/auth/register', { email, password, displayName: 'Roll20 import' });
  assert.equal(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
  await pool.query('UPDATE users SET email_confirmed_at = now() WHERE email = $1', [email]);
  const login = await api('POST', '/api/auth/login', { email, password });
  assert.equal(login.status, 200);
  return login.json.token;
}

/** Минимальный правильный PDF с одной строкой текста — не лист Roll20. */
function tinyPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('разбор: мировоззрение, класс по подклассу и началу слова, дописывание обрезанных названий', () => {
  assert.equal(roll20.mapAlignment('Хаотично - Злой'), 'Хаотично-злое');
  assert.equal(roll20.mapAlignment('Lawful Good'), 'Законно-доброе');
  assert.equal(roll20.mapAlignment('Нейтральный'), 'Истинно-нейтральное');
  assert.equal(roll20.mapAlignment('Своё мировоззрение'), 'Своё мировоззрение');

  const classes = [
    { name: 'Волшебник', nameEn: 'Wizard', hitDice: '1d6', subclasses: ['Школа Некромантии', 'Маг Лорхолда'] },
    { name: 'Колдун', nameEn: 'Warlock', hitDice: '1d8', subclasses: ['Маг Лорхолда'] },
    { name: 'Воин', nameEn: 'Fighter', hitDice: '1d10', subclasses: ['Чемпион'] }
  ];
  const necro = roll20.resolveClass('Школа Некромантии Wi…', classes);
  assert.equal(necro.cls.name, 'Волшебник');
  assert.equal(necro.how, 'subclass');
  assert.equal(necro.subclass, 'Школа Некромантии');
  assert.equal(necro.level, null, 'уровень обрезан многоточием');
  const fighter = roll20.resolveClass('Чемпион Fighter 5', classes);
  assert.equal(fighter.cls.name, 'Воин');
  assert.equal(fighter.level, 5);
  const ambiguous = roll20.resolveClass('Маг Лорхолда Wa…', classes);
  assert.equal(ambiguous.cls.name, 'Колдун', 'подкласс есть у двух классов — решает начало слова');
  assert.equal(roll20.resolveClass('Кто-то непонятный', classes).cls, null);

  assert.deepEqual(roll20.completeTruncated('Лёгкий арба…', ['Лёгкий арбалет', 'Короткий меч']), { name: 'Лёгкий арбалет', status: 'completed' });
  assert.equal(roll20.completeTruncated('Тёмная Ско…', ['Лёгкий арбалет']).status, 'truncated');
  assert.equal(roll20.completeTruncated('Короткий меч', []).status, 'full');
});

test('перенос из Roll20: PDF листа → черновик, ошибки файла и доступ', async () => {
  const token = await registerAndLogin();
  const pdf = fs.readFileSync(path.join(__dirname, 'fixtures', 'roll20-sheet.pdf'));

  // Без входа — нельзя.
  const anon = await upload(null, { name: 'sheet.pdf', mime: 'application/pdf', bytes: pdf });
  assert.equal(anon.status, 401);

  // Не PDF и PDF не от Roll20 — понятные коды ошибок.
  const notPdf = await upload(token, { name: 'sheet.pdf', mime: 'application/pdf', bytes: Buffer.from('просто текст') });
  assert.equal(notPdf.status, 400);
  assert.equal(notPdf.json.code, 'NOT_PDF');
  const foreign = await upload(token, { name: 'other.pdf', mime: 'application/pdf', bytes: tinyPdf('Hello') });
  assert.equal(foreign.status, 422, JSON.stringify(foreign.json));
  assert.equal(foreign.json.code, 'NOT_ROLL20_SHEET');

  const res = await upload(token, { name: 'Элдор | Roll20.pdf', mime: 'application/pdf', bytes: pdf });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const { character, report } = res.json;
  const sheet = character.sheet;
  const codes = report.map((r) => r.code);

  // Шапка и первая страница.
  assert.equal(character.name, 'Элкдор Аркен');
  assert.equal(character.race, 'Тёмный');
  assert.equal(character.background, 'Отшельник');
  assert.equal(character.campaignName, 'Поглощённые туманом', 'название игры из заголовка PDF');
  assert.equal(character.level, 9, 'уровень обрезан — берётся из костей хитов');
  assert.ok(codes.includes('levelFromHitDice'));
  assert.equal(sheet.alignment, 'Хаотично-злое');
  assert.deepEqual(sheet.abilities, { str: 16, dex: 18, con: 15, int: 16, wis: 14, cha: 12 });
  assert.equal(sheet.proficiencyBonus, 4);
  assert.deepEqual(Object.keys(sheet.saveThrowProficiencies).filter((k) => sheet.saveThrowProficiencies[k]), ['int', 'wis']);
  assert.deepEqual(
    Object.keys(sheet.skillProficiencies).filter((k) => sheet.skillProficiencies[k]).sort(),
    ['arcana', 'investigation', 'medicine', 'perception', 'religion']
  );
  assert.equal(sheet.combat.armorClass, 14);
  assert.ok(codes.includes('armorClassChoice'), '«14(17)» — взято первое число');
  assert.equal(sheet.combat.initiative, 4);
  assert.equal(sheet.combat.speed, 30);
  assert.equal(sheet.combat.hpMax, 49);
  assert.equal(sheet.combat.hpCurrent, 49);
  assert.deepEqual(sheet.money, { cp: 833, sp: 19, ep: 0, gp: 150, pp: 0 });
  assert.match(sheet.proficienciesLanguages, /^ИНСТРУМЕНТ: Кинжалы, дротики/);
  assert.match(sheet.personality.traits, /^Я абсолютно безмятежен/);
  assert.match(sheet.personality.bonds, /мою жену - Син$/);

  // Снаряжение с обеих страниц, перенос строки внутри названия склеен.
  assert.equal(sheet.equipment.length, 25);
  assert.ok(sheet.equipment.some((e) => e.name === 'Боевой посох с снимаемым Магическим Шаром (фокусировка)'));
  assert.ok(sheet.equipment.some((e) => e.name === 'Свиток разговор с животными' && e.qty === 2));

  // Атаки: «Лёгкий арба…» дописано, остальные обрезанные — в отчёте.
  assert.equal(sheet.attacks.length, 6);
  assert.deepEqual(sheet.attacks[1], { name: 'Короткий меч', bonus: '+8', damage: '1d6+4' });
  assert.ok(codes.includes('attacksTruncated'));

  // Особенности: 15 названий, описания со страницы «Особенности и черты» без примеси соседних колонок.
  assert.equal(sheet.features.length, 15);
  const fey = sheet.features.find((f) => f.name === 'Наследие Фей');
  assert.equal(fey.description, 'Вы совершаете с преимуществом спасброски от состояния «очарованный», и вас невозможно магически усыпить');
  assert.equal(sheet.features.find((f) => f.name === 'Откровение').description, '');

  // Заклинания: базовая характеристика, ячейки, свои записи остаются.
  assert.equal(sheet.spellcasting.ability, 'int');
  assert.equal(sheet.spellSlots[1].total, 4);
  assert.equal(sheet.spellSlots[5].total, 1);
  assert.ok(sheet.spells.some((s) => s.name === '.Усыпление + 1/п или Туманный шаг' && s.level === 1));

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM wiki_classes');
  if (rows[0].n > 0) {
    // Справочник импортирован: класс по подклассу, круги заклинаний и повторы.
    assert.equal(character.className, 'Волшебник (Школа Некромантии)');
    assert.equal(sheet.combat.hitDice, '1d6');
    assert.ok(codes.includes('classFromSubclass'));
    assert.equal(sheet.spells.length, 43);
    assert.equal(sheet.spells.filter((s) => s.name === 'Высшая невидимость').length, 1);
    assert.equal(sheet.spells.find((s) => s.name === 'Высшая невидимость').level, 4);
    assert.equal(sheet.attacks[0].name, 'Лёгкий арбалет');
    assert.ok(codes.includes('spellsDuplicates'));
    assert.ok(codes.includes('spellsCustom'));
  }

  // Черновик сохраняется обычным созданием персонажа.
  const saved = await api('POST', '/api/profile/characters', character, token);
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
});
