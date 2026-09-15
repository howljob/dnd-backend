/**
 * Юнит-проверка санитизации и разбора классовых .md без базы данных.
 * Запуск: WIKI_ASSETS_DIR=<...>/assets/wiki node src/scripts/import-wiki-reference.selftest.js
 * Выход 0 — все проверки прошли; иначе выход 1 со списком ошибок.
 */
const fs = require('fs');
const path = require('path');
const {
  sanitizeText,
  trimMarkdownPreamble,
  parseMarkdownWikiEntry,
  normalizeTrimmedRow
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
check('контент заметно короче сырого файла', barbarian.content.length < barbarianMd.length * 0.5,
  `${barbarian.content.length} из ${barbarianMd.length}`);
check('умения класса сохранились', barbarian.content.includes('### ЯРОСТЬ'));
check('нет строк «Распечатать»', !/(^|\n)\s*\*?\s*Распечатать\s*(\n|$)/.test(barbarian.content));
check('summary без символов разметки', !/[#>|*`]/.test(barbarian.summary), JSON.stringify(barbarian.summary));
check('summary осмысленный', barbarian.summary.length > 20, JSON.stringify(barbarian.summary));

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

if (failures.length) {
  // eslint-disable-next-line no-console
  failures.forEach((f) => console.error(f));
  // eslint-disable-next-line no-console
  console.error(`\n${failures.length} проверок провалено`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log('OK: все проверки импортёра прошли');
