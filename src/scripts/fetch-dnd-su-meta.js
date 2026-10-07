/**
 * Дотягивает с dnd.su то, чего нет в выгрузках:
 *  - бестиарий: русское имя и книга-источник монстра (из <title> страницы:
 *    «Древний зеленый дракон / Бестиарий D&D 5 / Monster Manual»);
 *  - заклинания: признак «ритуал» и строка «уровень, школа» для сверки
 *    (из <li class="size-type-alignment">1 уровень, прорицание (ритуал)</li>);
 *  - состояния (испуганный, отравленный, …): статья «Состояния» целиком.
 *
 * Результат кладётся в assets/wiki фронтенда и коммитится — импортёр читает
 * его оттуда, на сервере в интернет ходить не нужно:
 *   bestiary/names-ru.json      { [slug]: { name, source, url } }
 *   spells/meta-dnd-su.json     { [link]: { nameRu, nameEn, ritual, typeLine } }
 *   conditions/conditions.json  [ { slug, name, name_en, text, effects, url } ]
 *   inventory/articles.json     [ { slug, id, name, name_en, source, url, text } ] — статьи
 *                               раздела «Инвентарь» целиком (markdown), см. dndsu-html.js
 *
 * Скрипт докачивает: записи, которые уже есть в файле, не запрашиваются
 * (для инвентаря перекачать всё — ключ --force).
 * Ничего не выдумывает: если страница не отдала заголовок, записи нет.
 *
 * Запуск (сырой дамп бестиария нужен ради url каждой страницы):
 *   WIKI_OUTPUT_DIR=C:/projects/dnd/output WIKI_ASSETS_DIR=C:/projects/dnd/assets/wiki \
 *   node src/scripts/fetch-dnd-su-meta.js [bestiary|spells|conditions|inventory|all]
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

// ---------------------------------------------------------------------------
// Состояния (frightened, poisoned, …) — одна статья dnd.su «Состояния».
// Результат: conditions/conditions.json — массив { slug, name, name_en, text, effects, url }.
// text — markdown (пункты, абзацы, таблица степеней истощения), ссылки на другие
// состояния и заклинания сохранены как внутренние ссылки dnd.su.
// ---------------------------------------------------------------------------
const CONDITIONS_URL = 'https://dnd.su/articles/mechanics/27-conditions/';

function htmlInlineToMarkdown(html) {
  return String(html || '')
    // ссылки на другие состояния («#incapacitated») и на записи dnd.su («/spells/25-thunderwave/»)
    .replace(/<a\b[^>]*href="#([a-z-]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, slug, label) => `[${label.replace(/<[^>]+>/g, '')}](/conditions/${slug}/)`)
    .replace(/<a\b[^>]*href="(\/(?:spells|bestiary|items|feats|backgrounds|race|class)\/\d+-[^"/]+\/?)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `[${label.replace(/<[^>]+>/g, '')}](${href})`)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseConditionsArticle(html) {
  const start = html.indexOf('<h3 class="underlined"');
  const end = html.indexOf('<h2 class="card-title">Комментарии');
  if (start < 0) throw new Error('Не найдено ни одного заголовка состояния');
  const body = html.slice(start, end > start ? end : undefined);
  const blocks = body.split(/<h3 class="underlined"/i).slice(1);
  const result = [];

  for (const block of blocks) {
    const headEnd = block.indexOf('</h3>');
    const head = block.slice(0, headEnd);
    const rest = block.slice(headEnd + 5);
    const slug = (head.match(/id=['"]([a-z-]+)['"]/i) || [])[1];
    const nameEn = decodeEntities((head.match(/title="([A-Za-z -]+)"/) || [])[1] || '');
    // head начинается с хвоста открывающего тега («…>»), затем вложенные span.
    const name = decodeEntities(head.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!slug || !name) continue;

    const lines = [];
    const effects = [];
    const tokenRe = /<ul>([\s\S]*?)<\/ul>|<table>([\s\S]*?)<\/table>|<p>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = tokenRe.exec(rest)) !== null) {
      if (m[1] !== undefined) {
        const items = [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((li) => decodeEntities(htmlInlineToMarkdown(li[1]))).filter(Boolean);
        for (const item of items) {
          lines.push(`- ${item}`);
          effects.push(item.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
        }
        lines.push('');
      } else if (m[2] !== undefined) {
        const rows = [...m[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) => (
          [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((td) => decodeEntities(htmlInlineToMarkdown(td[1])))
        )).filter((cells) => cells.length);
        if (rows.length) {
          lines.push(`| ${rows[0].join(' | ')} |`);
          lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
          for (const cells of rows.slice(1)) lines.push(`| ${cells.join(' | ')} |`);
          lines.push('');
        }
      } else if (m[3] !== undefined) {
        const text = decodeEntities(htmlInlineToMarkdown(m[3]));
        if (text) {
          lines.push(text);
          lines.push('');
        }
      }
    }

    result.push({
      slug,
      name,
      name_en: nameEn,
      text: lines.join('\n').trim(),
      effects,
      url: `${CONDITIONS_URL}#${slug}`
    });
  }
  return result;
}

async function fetchConditions() {
  const outPath = path.join(ASSETS_WIKI_DIR, 'conditions', 'conditions.json');
  const { status, html } = await fetchHead(CONDITIONS_URL, '<h2 class="card-title">Комментарии', 1500000);
  if (status !== 200 || !html) throw new Error(`Статья состояний не загрузилась: HTTP ${status}`);
  const conditions = parseConditionsArticle(html);
  if (conditions.length < 10) throw new Error(`Разобрано подозрительно мало состояний: ${conditions.length}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(conditions, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Состояния готовы: ${conditions.length} → ${outPath}`);
}

// ---------------------------------------------------------------------------
// Инвентарь — раздел статей dnd.su /articles/inventory/ (оружие, доспехи,
// снаряжение, инструменты, яды, безделушки…). Каждая статья целиком → markdown.
// Результат: inventory/articles.json — массив { slug, id, name, name_en, source, url, text }.
// Сводная статья «Доспехи, Оружие, Снаряжение и Инструменты» пропускается —
// она дублирует четыре отдельные статьи.
// ---------------------------------------------------------------------------
const INVENTORY_LIST_URL = 'https://dnd.su/articles/inventory/';
const INVENTORY_SKIP = new Set(['armor-arms-equipment-tools']);

function parseInventoryLinks(listHtml) {
  const links = [...String(listHtml || '').matchAll(/href=['"](\/articles\/inventory\/(\d+)-([a-z0-9_-]+)\/?)['"]/gi)];
  const seen = new Set();
  const result = [];
  for (const m of links) {
    const slug = m[3].toLowerCase().replace(/_/g, '-');
    if (seen.has(slug)) continue;
    seen.add(slug);
    result.push({ slug, id: Number(m[2]), url: `https://dnd.su${m[1]}` });
  }
  return result;
}

/** Заголовок статьи «Оружие [Arms]» → { name, nameEn }. */
function parseArticleHeading(pageHtml) {
  const m = String(pageHtml || '').match(/<h2 class="card-title"[^>]*>([\s\S]*?)<\/h2>/i);
  const text = m ? decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
  const br = text.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return br ? { name: br[1].trim(), nameEn: br[2].trim() } : { name: text, nameEn: '' };
}

async function fetchInventory() {
  const { htmlToMarkdown, extractArticleBody } = require('./dndsu-html');
  const outPath = path.join(ASSETS_WIKI_DIR, 'inventory', 'articles.json');
  const existing = readJson(outPath, []);
  const bySlug = new Map((Array.isArray(existing) ? existing : []).map((a) => [a.slug, a]));

  // Список карточек идёт до конца страницы — читаем её целиком.
  const list = await fetchHead(INVENTORY_LIST_URL, '</html>', 2000000);
  if (list.status !== 200 || !list.html) throw new Error(`Список статей инвентаря не загрузился: HTTP ${list.status}`);
  const links = parseInventoryLinks(list.html).filter((l) => !INVENTORY_SKIP.has(l.slug));
  if (links.length < 10) throw new Error(`Найдено подозрительно мало статей инвентаря: ${links.length}`);
  const force = process.argv.includes('--force');
  const targets = links.filter((l) => force || !bySlug.get(l.slug)?.text);
  // eslint-disable-next-line no-console
  console.log(`Инвентарь: статей ${links.length}, уже есть ${links.length - targets.length}, запросить ${targets.length}`);

  const failures = [];
  await runPool(targets, async (link) => {
    try {
      const { status, html } = await fetchHead(link.url, '<h2 class="card-title">Комментарии', 2500000);
      const title = status === 404 ? null : parseTitle(html);
      const body = extractArticleBody(html);
      if (!title || !body) {
        failures.push(`${link.slug}: ${status === 404 ? '404' : 'нет тела статьи'} ${link.url}`);
        return;
      }
      const heading = parseArticleHeading(html);
      const text = htmlToMarkdown(body);
      if (text.length < 200) {
        failures.push(`${link.slug}: слишком короткий текст (${text.length}) ${link.url}`);
        return;
      }
      bySlug.set(link.slug, {
        slug: link.slug,
        id: link.id,
        name: heading.name || title.name,
        name_en: heading.nameEn,
        source: title.source,
        url: link.url,
        text
      });
    } catch (error) {
      failures.push(`${link.slug}: ${String(error?.message || error)} ${link.url}`);
    }
  });

  const articles = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Инвентарь готов: статей в файле ${articles.length}, ошибок ${failures.length}`);
  if (failures.length) {
    fs.writeFileSync(path.join(ASSETS_WIKI_DIR, 'inventory', 'articles.failures.txt'), `${failures.join('\n')}\n`, 'utf8');
  }
}

async function run() {
  const what = String(process.argv[2] || 'all').toLowerCase();
  if (what === 'bestiary' || what === 'all') await fetchBestiaryNames();
  if (what === 'spells' || what === 'all') await fetchSpellMeta();
  if (what === 'conditions' || what === 'all') await fetchConditions();
  if (what === 'inventory' || what === 'all') await fetchInventory();
}

if (require.main === module) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('fetch-dnd-su-meta failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { parseTitle, decodeEntities, parseConditionsArticle, parseInventoryLinks, parseArticleHeading };
