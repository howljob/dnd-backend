/**
 * Юнит-проверка санитизации и разбора классовых .md без базы данных.
 * Запуск: WIKI_ASSETS_DIR=<...>/assets/wiki node src/scripts/import-wiki-reference.selftest.js
 * Выход 0 — все проверки прошли; иначе выход 1 со списком ошибок.
 */
const fs = require('fs');
const path = require('path');
const {
  sanitizeText,
  sanitizeWikiMarkdown,
  trimMarkdownPreamble,
  parseMarkdownWikiEntry,
  normalizeTrimmedRow,
  fixGluedTableHeaders
} = require('./import-wiki-reference');

const ASSETS_WIKI_DIR = process.env.WIKI_ASSETS_DIR || 'C:/projects/dnd/assets/wiki';

const failures = [];
function check(name, condition, detail) {
  if (condition) return;
  failures.push(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. barbarian.md: комментарии и мусор вырезаны, структура разобрана ---
const barbarianPath = path.join(ASSETS_WIKI_DIR, 'classes', 'barbarian.md');
const barbarianMd = fs.readFileSync(barbarianPath, 'utf8');
const barbarian = parseMarkdownWikiEntry('classes', 'barbarian', barbarianMd);

check('имя разобрано', barbarian.name === 'Варвар', barbarian.name);
check('имя en разобрано', barbarian.nameEn === 'Barbarian', barbarian.nameEn);
check('контент начинается с основного заголовка', barbarian.content.startsWith('## Варвар'), JSON.stringify(barbarian.content.slice(0, 40)));
check('нет Boosty (навигационная шапка)', !barbarian.content.includes('Boosty'));
check('нет секции Комментарии', !/(^|\n)#{1,6}\s*Комментарии/.test(barbarian.content));
check('нет тел комментариев', !barbarian.content.includes('Авторизуйтесь, чтобы оставлять комментарии'));
check('нет секции Галерея', !/(^|\n)#{1,6}\s*Галерея/.test(barbarian.content));
// Комментарии и галерея занимают около половины сырого файла (порог 0.55 — запас на вёрстку)
check('контент заметно короче сырого файла', barbarian.content.length < barbarianMd.length * 0.55,
  `${barbarian.content.length} из ${barbarianMd.length}`);
check('умения класса сохранились', barbarian.content.includes('### ЯРОСТЬ'));
check('нет строк «Распечатать»', !/(^|\n)\s*\*?\s*Распечатать\s*(\n|$)/.test(barbarian.content));
check('summary без символов разметки', !/[#>|*`]/.test(barbarian.summary), JSON.stringify(barbarian.summary));
check('summary осмысленный', barbarian.summary.length > 20, JSON.stringify(barbarian.summary));

// Склеенные шапки таблиц dnd.su расклеены (координатор, пункт 1)
check('нет «Уровеньур» в контенте', !barbarian.content.includes('Уровеньур'));
check('нет «Яростькя» в контенте', !barbarian.content.includes('Яростькя'));
check('нет «Неограниченно∞»', !barbarian.content.includes('Неограниченно∞'));
check('шапка «Уровень» на месте', /\|\s*Уровень\s*\|/.test(barbarian.content));
check('шапка «Урон ярости» на месте', /\|\s*Урон ярости\s*\|/.test(barbarian.content));
check('fixGluedTableHeaders точечный', fixGluedTableHeaders('| Уровеньур | Яростькя |') === '| Уровень | Ярость |');

// Мусорные хвосты-коды у заголовков статблоков и лесенка характеристик
check('хвост HB HB:GH срезан', sanitizeWikiMarkdown('## Первобытный боец \\[Primal striker\\]HB HB:GH \nтекст')
  === '## Первобытный боец \\[Primal striker\\]\nтекст');
check('хвостов HB:GH нет в контенте варвара', !barbarian.content.includes('HB:GH'), '');
const ladder = sanitizeWikiMarkdown('* Сил  \n15 (**+2**)  \nЛов  \n15 (**+2**)  \nИнт  \n4 (**\\-3**)');
check('лесенка характеристик склеена в пары',
  ladder === '**Сил** 15 (**+2**)\n**Лов** 15 (**+2**)\n**Инт** 4 (**\\-3**)', JSON.stringify(ladder));
check('в контенте варвара лесенки нет', !/(^|\n)\*?[ \t]*(Сил|Лов|Тел|Инт|Мдр|Хар)[ \t]*\n/.test(barbarian.content), '');

const structure = barbarian.payload.sections;
check('payload.sections присутствует', Boolean(structure));
check('таблица уровней найдена', /Уровень/.test(structure?.levelTable || ''));
check('таблица уровней доходит до 20', /\n\|\s*20\s*\|/.test(structure?.levelTable || ''));
check('ЯРОСТЬ в списке умений', (structure?.features || []).some((t) => /ЯРОСТЬ/i.test(t)));
check('Путь берсерка в подклассах', (structure?.subclasses || []).includes('Путь берсерка'));
check('Пути дикости не считаются подклассом', !(structure?.subclasses || []).includes('Пути дикости'));
check('в toc есть главный заголовок', (structure?.toc || []).some((e) => e.kind === 'main'));

// --- 2. Преамбула обрезается у всех 13 классов ---
const classesDir = path.join(ASSETS_WIKI_DIR, 'classes');
const classFiles = fs.readdirSync(classesDir).filter((f) => f.endsWith('.md'));
check('13 классовых файлов', classFiles.length === 13, String(classFiles.length));
for (const file of classFiles) {
  const md = fs.readFileSync(path.join(classesDir, file), 'utf8');
  const trimmed = trimMarkdownPreamble(md);
  check(`${file}: преамбула обрезана`, /^##\s+\S/.test(trimmed.trimStart()), JSON.stringify(trimmed.slice(0, 40)));
  check(`${file}: нет навигации dnd.su`, !trimmed.includes('Boosty'));
  const entry = parseMarkdownWikiEntry('classes', file.replace(/\.md$/, ''), md);
  check(`${file}: имя разобрано`, Boolean(entry.name && entry.nameEn));
  check(`${file}: нет комментариев в контенте`, !/(^|\n)#{1,6}\s*Комментарии/.test(entry.content));
  check(`${file}: таблица уровней найдена`, /Уровень/.test(entry.payload.sections?.levelTable || ''));
  check(`${file}: есть подклассы`, (entry.payload.sections?.subclasses || []).length > 0);
}

// --- 3. sanitizeText: строка «Комментарии» режется по границе строки ---
check('sanitizeText режет хвост с Комментарии',
  sanitizeText('Полезный текст.\nКомментарии\nмусор форума') === 'Полезный текст.');
check('sanitizeText не трогает слово в середине предложения',
  sanitizeText('Оставьте комментарии мастеру.') === 'Оставьте комментарии мастеру.');

// --- 4. Урезанные датасеты: нормализация записи ---
const trimmed = normalizeTrimmedRow('bestiary', {
  slug: 'ancient-green-dragon',
  name: 'Ancient green dragon',
  name_en: 'Ancient green dragon',
  source: 'Monster Manual',
  description: 'Громадный Дракон, законно-злой\n\nОпасность 22 (41 000 опыта)\n\nКомментарии\nмусор',
  filters: { type: 'Громадный Дракон', challenge: '22' }
});
check('trimmed: slug сохранён', trimmed.slug === 'ancient-green-dragon');
check('trimmed: комментарии вырезаны', !trimmed.content.includes('мусор'), JSON.stringify(trimmed.content));
check('trimmed: фильтры перенесены', trimmed.filters.challenge === '22');

// --- 5. Разбор данных dnd.su в поля (wiki-parsers.js) ---
const parsers = require('./wiki-parsers');

const goblinText = [
  'Маленький? Гуманоид (Гоблиноид), нейтрально-злой',
  'Класс Доспеха 15 (кожаный доспех, щит)',
  'Хиты 7 (2к6)',
  'Скорость 30 футов',
  'Сил8 (-1)Лов14 (+2)Тел10 (+0)Инт10 (+0)Мдр8 (-1)Хар8 (-1)',
  'Навыки Скрытность +6',
  'Чувства тёмное зрение? 60 футов, пассивное Восприятие 9',
  'Языки Общий, Гоблинский',
  'Опасность 1/4 (50 опыта)',
  'Бонус мастерства +2',
  'Ловкий побег. Гоблин может в каждом своем ходу бонусным действием совершать действие Засада или Отход.',
  'Действия\nСкимитар. Рукопашная атака оружием: +4 к попаданию, досягаемость 5 футов, одна цель. Попадание: 5 (1к6 + 2) рубящего урона.',
  'Короткий лук. Дальнобойная атака оружием: +4 к попаданию, дистанция 80 футов/320 футов, одна цель. Попадание: 5 (1к6 + 2) колющего урона.',
  'Описание\n«БРИИ-ЯРК!»\n\nГоблины — это маленькие, эгоистичные существа. Кто выключил свет?'
].join('\n\n');
const goblin = parsers.parseMonsterStatBlock(goblinText);
check('монстр: знак подсказки «?» убран у размера и чувств', goblin.data.size === 'Маленький' && goblin.data.senses[0] === 'тёмное зрение 60 футов', JSON.stringify([goblin.data.size, goblin.data.senses]));
check('монстр: настоящий вопрос в описании сохранён', goblin.data.description.includes('Кто выключил свет?'));
check('монстр: тип и мировоззрение', goblin.data.typeBase === 'Гуманоид' && goblin.data.type === 'Гуманоид (Гоблиноид)' && goblin.data.alignment === 'нейтрально-злой');
check('монстр: КД, хиты, кость хитов', goblin.data.armorClass === 15 && goblin.data.armorClassNote === 'кожаный доспех, щит' && goblin.data.hitPoints === 7 && goblin.data.hitDice === '2к6');
check('монстр: скорость', goblin.data.speed.walk === 30);
check('монстр: шесть характеристик', goblin.data.abilities?.dex?.score === 14 && goblin.data.abilities?.dex?.modifier === 2 && goblin.data.abilities?.str?.modifier === -1);
check('монстр: навыки и пассивное восприятие', goblin.data.skills['Скрытность'] === 6 && goblin.data.passivePerception === 9);
check('монстр: опасность и опыт', goblin.data.challenge === '1/4' && goblin.data.challengeValue === 0.25 && goblin.data.xp === 50 && goblin.data.proficiencyBonus === 2);
check('монстр: умение и действия разложены', goblin.data.traits.length === 1 && goblin.data.traits[0].name === 'Ловкий побег' && goblin.data.actions.map((a) => a.name).join(',') === 'Скимитар,Короткий лук');
check('монстр: краткое описание из данных', goblin.summary === 'Маленький Гуманоид (Гоблиноид), нейтрально-злой · Опасность 1/4', goblin.summary);
check('монстр: фильтры', goblin.filters.size === 'Маленький' && goblin.filters.type === 'Гуманоид' && goblin.filters.cr_value === 0.25 && goblin.filters.legendary === false);
check('монстр: опасность с пояснением', parsers.parseMonsterStatBlock('Большой? Зверь\n\nКласс Доспеха 10\n\nХиты 5\n\nОпасность 22 (41 000 опыта) или 23 в логове').data.challenge === '22');
check('монстр: размер «или меньше»', parsers.parseMonsterHeadline('Большой или меньшего размера Конструкт, без мировоззрения').typeBase === 'Конструкт');
check('монстр: род размера приводится к одному виду', parsers.parseMonsterHeadline('Средняя? Аберрация, законно-злая').sizeKey === 'Средний');
check('монстр: рой', parsers.parseMonsterHeadline('Средний рой крошечных Зверей, без мировоззрения').typeBase === 'Рой');
check('умение: имя не длиннее 5 слов', parsers.splitNamedEntry('Кровопийца может отцепиться, потратив 5 футов перемещения. Он делает это') === null);
check('умение: скобки допустимы', parsers.splitNamedEntry('Легендарное сопротивление (3/день). Если дракон проваливает спасбросок…')?.name === 'Легендарное сопротивление (3/день)');

const fireball = parsers.parseSpellData({
  level: '3', school: 'Воплощение', cast_time: '1 действие', range: '150 футов',
  components: 'В, С, М (крошечный шарик из гуано летучей мыши и серы)', duration: 'Мгновенная',
  classes: 'волшебник, чародей, бардTCE', subclasses: 'домен света (жрец)',
  description: 'Яркий луч вылетает из вашего пальца.\n\nНа больших уровнях. Урон увеличивается на 1к6.'
}, { ritual: false });
check('заклинание: уровень числом', fireball.data.level === 3 && fireball.filters.level_num === 3);
check('заклинание: заговор = 0', parsers.parseSpellData({ level: 'Заговор', classes: '', description: '' }, null).data.level === 0);
check('заклинание: компоненты', fireball.data.components.verbal && fireball.data.components.somatic && fireball.data.components.material && fireball.data.components.materialText.startsWith('крошечный шарик'));
check('заклинание: классы, TCE отделён', fireball.data.classes.join(',') === 'волшебник,чародей' && fireball.data.classesTasha.join(',') === 'бард' && fireball.filters.classes === 'волшебник, чародей, бард');
check('заклинание: «На больших уровнях» отдельно', fireball.data.atHigherLevels === 'Урон увеличивается на 1к6.' && !fireball.data.description.includes('На больших'));
check('заклинание: ритуал с dnd.su, концентрация из длительности', fireball.data.ritual === false && parsers.parseSpellData({ duration: 'Концентрация, вплоть до 1 минуты', classes: '', description: '' }, { ritual: true }).data.ritual === true && parsers.parseSpellData({ duration: 'Концентрация, вплоть до 1 минуты', classes: '', description: '' }, null).data.concentration === true);
check('заклинание: реакции сведены для фильтра', parsers.parseSpellData({ cast_time: '1 реакция, совершаемая вами, когда…', classes: '', description: '' }, null).filters.cast_time_kind === '1 реакция');

const mithral = parsers.parseItemData('Официальные материалы от Wizards of the Coast и от издательств.\n\n Мифрильные полулаты +1 [+1 Mithral Half Plate]AI\n\nДоспех (полулаты), редкий\n\nРекомендованная стоимость: 501-5 000 зм\n\nВы получаете бонус +1 к КД.', '1 mithral half plate', '1 mithral half plate');
check('предмет: имя из заголовка статьи', mithral.data.nameRu === 'Мифрильные полулаты +1' && mithral.data.nameEn === '+1 Mithral Half Plate' && mithral.data.sourceCodes.join() === 'AI');
check('предмет: тип, подтип, редкость, стоимость', mithral.data.type === 'Доспех' && mithral.data.subtype === 'полулаты' && mithral.data.rarity === 'редкий' && mithral.data.cost === '501-5 000 зм');
check('предмет: служебная шапка и строка типа убраны из текста', mithral.description === 'Вы получаете бонус +1 к КД.', JSON.stringify(mithral.description));
const ring = parsers.parseItemData('Кольцо падения пёрышком [Ring of feather falling]DMG14 DMG24\n\nКольцо, редкое (требуется настройка)\n\nЕсли вы падаете…', '', '');
check('предмет: настройка и коды книг', ring.data.attunement === true && ring.data.sourceCodes.join(',') === 'DMG14,DMG24' && ring.data.rarity === 'редкий');
check('предмет: «очень редкий» не путается с «редкий»', parsers.parseItemData('Жезл [Rod]\n\nЖезл, очень редкий\n\nТекст.', '', '').data.rarity === 'очень редкий');

const feat = parsers.parseFeatData('## Агент Порядка\n**Источник:** Planescape\n\nТребование: 4 уровень, черта «Наследник»\nВы можете направлять силы порядка. Детали.\nУвеличение характеристик. Увеличьте значение.');
check('черта: требование отдельным полем и убрано из текста', feat.data.prerequisite === '4 уровень, черта «Наследник»' && !feat.data.description.includes('Требование:'));
check('черта: заголовок и источник не дублируются в тексте', !feat.data.description.startsWith('##') && !feat.data.description.includes('Источник'));
check('черта: краткое описание без разметки', feat.summary.startsWith('Вы можете направлять силы порядка.'), feat.summary);

const race = parsers.parseRaceData('## Аасимар [Aasimar]\n**Источник:** «MPMM»\n\nТекст.\n\nСкорость. Ваша базовая скорость ходьбы — 30 футов.\n\nРазмер. Ваш размер — Маленький или Средний.');
check('раса: размер и скорость', race.data.sizes.join('/') === 'Маленький/Средний' && race.data.speedFeet === 30 && race.filters.size === 'Маленький или Средний' && race.filters.speed === '30 футов');

const background = parsers.parseBackgroundData('## Антрополог [Anthropologist]\n**Источник:** ToA\n\nВас привлекали культуры.\n\nВладение навыками: Проницательность, Религия.\n\nВладение языками: Два на ваш выбор.');
check('предыстория: навыки и языки', background.data.skills.join('/') === 'Проницательность/Религия' && background.data.languages === 'Два на ваш выбор' && background.data.tools === '');

// --- Бросок заклинания для панели действий стола ---
const fireballRoll = parsers.parseSpellRoll('Все существа в сфере должны совершить спасбросок Ловкости. Цель получает 8к6 урона огнём при провале или половину этого урона при успехе.\n\nНа больших уровнях. Если вы накладываете это заклинание, используя ячейку 4-го уровня или выше, урон увеличивается на 1к6 за каждый уровень ячейки выше третьего.', 3);
check('бросок: кость, тип и спасбросок', fireballRoll.kind === 'damage' && fireballRoll.formula === '8d6' && fireballRoll.damageType === 'огонь' && fireballRoll.save === 'dex', JSON.stringify(fireballRoll));
check('бросок: рост по ячейке', fireballRoll.perSlot?.formula === '1d6' && fireballRoll.perSlot?.step === 1);
const boltRoll = parsers.parseSpellRoll('Совершите по цели дальнобойную атаку заклинанием. При попадании цель получает урон огнём 1к10. Урон этого заклинания увеличивается на 1к10, когда вы достигаете 5-го уровня (2к10), 11-го уровня (3к10), 17-го уровня (4к10).', 0);
check('бросок: атака заклинанием и рост заговора', boltRoll.attack === 'ranged' && boltRoll.cantripScaling?.[5] === '2d10' && boltRoll.cantripScaling?.[17] === '4d10', JSON.stringify(boltRoll));
const cureRoll = parsers.parseSpellRoll('Существо, которого вы касаетесь, восстанавливает количество хитов, равное 1к8 + ваш модификатор базовой характеристики.', 1);
check('бросок: лечение с модификатором', cureRoll.kind === 'healing' && cureRoll.formula === '1d8' && cureRoll.addsAbilityModifier === true);
check('бросок: «ё» в разложенной форме распознаётся', parsers.parseSpellRoll('Цель получает 2к6 урона огнём.', 1).damageType === 'огонь');
check('бросок: без костей — нет данных', parsers.parseSpellRoll('Вы создаёте иллюзию.', 1) === null);

// --- Инвентарь: таблицы оружия и доспехов из markdown ---
const armsMd = '| Название | Стоимость | Урон | Вес | Свойства |\n| --- | --- | --- | --- | --- |\n| **_Простое рукопашное оружие_** |  |  |  |  |\n| Кинжал | 2 зм | 1к4 колющий | 1 фнт. | Лёгкое, метательное (дис. 20/60), фехтовальное |\n| **_Воинское дальнобойное оружие_** |  |  |  |  |\n| Длинный лук | 50 зм | 1к8 колющий | 2 фнт. | Боеприпас (дис. 150/600), двуручное, тяжёлое |\n| Длинный меч | 15 зм | 1к8 рубящий | 3 фнт. | Универсальное (1к10) |';
const weapons = parsers.parseWeaponTable(armsMd);
check('оружие: три строки без заголовков категорий', weapons.length === 3, String(weapons.length));
check('оружие: кинжал — фехтовальное, метательное, дистанция', weapons[0].damageFormula === '1d4' && weapons[0].damageType === 'колющий' && weapons[0].propertyKeys.includes('finesse') && weapons[0].range === '20/60' && weapons[0].ranged === false);
check('оружие: лук — дальнобойное воинское', weapons[1].ranged === true && weapons[1].martial === true && weapons[1].propertyKeys.includes('ammunition'));
check('оружие: универсальная кость', weapons[2].versatileFormula === '1d10');
const armorMd = '| Доспех | Стоимость | Класс доспеха (КД) | Сила | Скрытность | Вес |\n| --- | --- | --- | --- | --- | --- |\n| **_Средний доспех_** |  |  |  |  |  |\n| Кираса | 400 зм. | 14 + модификатор ЛОВ (макс. 2) | - | - | 20 фнт. |\n| **_Тяжёлый доспех_** |  |  |  |  |  |\n| Кольчуга | 75 зм. | 16 | 13 | Помеха | 55 фнт. |';
const armorRows = parsers.parseArmorTable(armorMd);
check('доспехи: КД, ловкость, сила, скрытность', armorRows.length === 2 && armorRows[0].acBase === 14 && armorRows[0].dexMax === 2 && armorRows[1].acBase === 16 && armorRows[1].strength === '13' && armorRows[1].stealthDisadvantage === true && armorRows[1].category === 'Тяжёлый доспех');
check('инвентарь: вид статьи по слагу', parsers.parseInventoryData('arms', armsMd).kind === 'weapons' && parsers.parseInventoryData('poisons', '').kind === 'article');

// --- HTML статей dnd.su → markdown ---
const dndsuHtml = require('./dndsu-html');
const articleMd = dndsuHtml.htmlToMarkdown('<div class="desc"><p>Текст <strong>жирный </strong>и <a href="#x">якорь</a>, <a href="/spells/205-fireball/">огненный шар</a>.</p><br><h3 class="underlined">ВЛАДЕНИЕ ОРУЖИЕМ (XGE)</h3><table><tbody><tr class="table_header"><td>Название</td><td>Урон</td></tr><tr><td colspan="2"><em>Простое</em></td></tr><tr><td>Булава</td><td>1к6 дробящий</td></tr></tbody></table><ul><li><a href="#a">Оглавление</a></li></ul><ul><li>Пункт</li></ul><script>var x=1;</script></div>');
check('html→md: жирный, ссылки, якоря', articleMd.includes('Текст **жирный** и якорь, [огненный шар](/spells/205-fireball/).'), JSON.stringify(articleMd));
check('html→md: заголовок капсом приведён к обычному регистру, код книги сохранён', articleMd.includes('### Владение оружием (XGE)'), JSON.stringify(articleMd));
check('html→md: таблица с объединённой строкой', articleMd.includes('| Название | Урон |\n| --- | --- |\n| _Простое_ |  |\n| Булава | 1к6 дробящий |'), JSON.stringify(articleMd));
check('html→md: оглавление из якорей выброшено, обычный список остался', !articleMd.includes('Оглавление') && articleMd.includes('- Пункт') && !articleMd.includes('var x'), JSON.stringify(articleMd));

if (failures.length) {
  // eslint-disable-next-line no-console
  failures.forEach((f) => console.error(f));
  // eslint-disable-next-line no-console
  console.error(`\n${failures.length} проверок провалено`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log('OK: все проверки импортёра прошли');
