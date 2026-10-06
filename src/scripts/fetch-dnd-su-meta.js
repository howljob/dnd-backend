/**
 * Дотягивает с dnd.su то, чего нет в выгрузках:
 *  - бестиарий: русское имя и книга-источник монстра (из <title> страницы:
 *    «Древний зеленый дракон / Бестиарий D&D 5 / Monster Manual»);
 *  - заклинания: признак «ритуал» и строка «уровень, школа» для сверки
 *    (из <li class="size-type-alignment">1 уровень, прорицание (ритуал)</li>).
 *
 * Результат кладётся в assets/wiki фронтенда и коммитится — импортёр читает
 * его оттуда, на сервере в интернет ходить не нужно:
 *   bestiary/names-ru.json   { [slug]: { name, source, url } }
 *   spells/meta-dnd-su.json  { [link]: { nameRu, nameEn, ritual, typeLine } }
 *
 * Скрипт докачивает: записи, которые уже есть в файле, не запрашиваются.
 * Ничего не выдумывает: если страница не отдала заголовок, записи нет.
 *
 * Запуск (сырой дамп бестиария нужен ради url каждой страницы):
 *   WIKI_OUTPUT_DIR=C:/projects/dnd/output WIKI_ASSETS_DIR=C:/projects/dnd/assets/wiki \
 *   node src/scripts/fetch-dnd-su-meta.js [bestiary|spells|all]
 */
const fs = require('fs');
const path = require('path');
const { slugFromUrl } = require('./build-wiki-trimmed-sources');

const OUTPUT_DIR = process.env.WIKI_OUTPUT_DIR || 'C:/projects/dnd/output';
const ASSETS_WIKI_DIR = process.env.WIKI_ASSETS_DIR || 'C:/projects/dnd/assets/wiki';
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 3);
const DELAY_MS = Number(process.env.FETCH_DELAY_MS || 250);
const USER_AGENT = 'Mozilla/5.0 (compatible; dnd-hub-wiki-import/1.0)';

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const keys = Object.keys(data).sort((a, b) => a.localeCompare(b, 'ru'));
  const body = `{\n${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(data[k])}`).join(',\n')}\n}\n`;
  fs.writeFileSync(filePath, body, 'utf8');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

/** Читает страницу, пока не встретит нужный фрагмент (не качает всё целиком). */
async function fetchHead(url, stopMarker, maxBytes = 400000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        redirect: 'follow',
        signal: controller.signal
      });
      if (response.status === 404) return { status: 404, html: '', finalUrl: response.url };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let html = '';
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { value, done } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.includes(stopMarker) || html.length > maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      return { status: response.status, html, finalUrl: response.url };
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, html: '', finalUrl: url };
}

function parseTitle(html) {
  const m = String(html).match(/<title>([^<]*)<\/title>/i);
  if (!m) return null;
  // Разделитель — « / » с пробелами: в самих названиях бывает «/» («Антипатия/симпатия»).
  const parts = decodeEntities(m[1]).split(' / ').map((p) => p.trim());
  if (parts.length < 2) return null;
  if (/404|не найдена/i.test(parts[0])) return null;
  return { name: parts[0], source: parts.length >= 3 ? parts[parts.length - 1] : '' };
}

async function runPool(items, worker) {
  let index = 0;
  let done = 0;
  const total = items.length;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= total) return;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[current]);
      done += 1;
      if (done % 50 === 0 || done === total) {
        // eslint-disable-next-line no-console
        console.log(`[${new Date().toISOString()}] ${done}/${total}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
}

async function fetchBestiaryNames() {
  const rawPath = path.join(OUTPUT_DIR, 'bestiary-non-homebrew-all.json');
  const rows = readJson(rawPath, null);
  if (!Array.isArray(rows)) throw new Error(`Нет сырого дампа бестиария: ${rawPath}`);

  const outPath = path.join(ASSETS_WIKI_DIR, 'bestiary', 'names-ru.json');
  const result = readJson(outPath, {});

  // Слаги строим так же, как build-wiki-trimmed-sources.js: повтор → «slug-id».
  const seen = new Set();
  const targets = [];
  for (const row of rows) {
    if (row?.error) continue;
    const u = slugFromUrl(row.url);
    if (!u) continue;
    let slug = u.slug;
    if (seen.has(slug)) slug = `${slug}-${u.id}`;
    seen.add(slug);
    if (result[slug]?.name) continue;
    targets.push({ slug, url: row.url });
  }
  // eslint-disable-next-line no-console
  console.log(`Бестиарий: всего ${seen.size}, уже есть ${seen.size - targets.length}, запросить ${targets.length}`);

  let saved = 0;
  const failures = [];
  await runPool(targets, async ({ slug, url }) => {
    try {
      const { status, html, finalUrl } = await fetchHead(url, '</title>');
      const title = status === 404 ? null : parseTitle(html);
      if (!title) {
        failures.push(`${slug}: ${status === 404 ? '404' : 'нет заголовка'} ${url}`);
        return;
      }
      result[slug] = { name: title.name, source: title.source, url: finalUrl || url };
      saved += 1;
      if (saved % 50 === 0) writeJson(outPath, result);
    } catch (error) {
      failures.push(`${slug}: ${String(error?.message || error)} ${url}`);
    }
  });

  writeJson(outPath, result);
  // eslint-disable-next-line no-console
  console.log(`Бестиарий готов: записей в файле ${Object.keys(result).length}, новых ${saved}, ошибок ${failures.length}`);
  if (failures.length) {
    fs.writeFileSync(path.join(ASSETS_WIKI_DIR, 'bestiary', 'names-ru.failures.txt'), `${failures.join('\n')}\n`, 'utf8');
  }
}

async function fetchSpellMeta() {
  const spellsPath = path.join(ASSETS_WIKI_DIR, 'spells', 'spells-all.json');
  const spells = readJson(spellsPath, null);
  if (!Array.isArray(spells)) throw new Error(`Нет spells-all.json: ${spellsPath}`);

  const outPath = path.join(ASSETS_WIKI_DIR, 'spells', 'meta-dnd-su.json');
  const result = readJson(outPath, {});
  const targets = spells.filter((s) => s.link && !result[s.link]);
  // eslint-disable-next-line no-console
  console.log(`Заклинания: всего ${spells.length}, уже есть ${spells.length - targets.length}, запросить ${targets.length}`);

  let saved = 0;
  const failures = [];
  await runPool(targets, async (spell) => {
    try {
      // «Время накладывания» встречается в меню страницы раньше карточки — ждём строку параметров.
      const { status, html } = await fetchHead(spell.link, 'Дистанция:</strong>');
      const title = status === 404 ? null : parseTitle(html);
      const typeLine = decodeEntities((html.match(/class="size-type-alignment"[^>]*>([^<]*)</i) || [])[1] || '');
      if (!title || !typeLine) {
        failures.push(`${spell.name_en}: ${status === 404 ? '404' : 'нет данных'} ${spell.link}`);
        return;
      }
      result[spell.link] = {
        nameRu: title.name,
        nameEn: spell.name_en,
        source: title.source,
        typeLine,
        ritual: /ритуал/i.test(typeLine)
      };
      saved += 1;
      if (saved % 50 === 0) writeJson(outPath, result);
    } catch (error) {
      failures.push(`${spell.name_en}: ${String(error?.message || error)} ${spell.link}`);
    }
  });

  writeJson(outPath, result);
  // eslint-disable-next-line no-console
  console.log(`Заклинания готовы: записей в файле ${Object.keys(result).length}, новых ${saved}, ошибок ${failures.length}`);
  if (failures.length) {
    fs.writeFileSync(path.join(ASSETS_WIKI_DIR, 'spells', 'meta-dnd-su.failures.txt'), `${failures.join('\n')}\n`, 'utf8');
  }
}

async function run() {
  const what = String(process.argv[2] || 'all').toLowerCase();
  if (what === 'bestiary' || what === 'all') await fetchBestiaryNames();
  if (what === 'spells' || what === 'all') await fetchSpellMeta();
}

if (require.main === module) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('fetch-dnd-su-meta failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { parseTitle, decodeEntities };
