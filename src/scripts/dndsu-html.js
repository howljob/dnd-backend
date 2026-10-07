/**
 * Разбор HTML статей dnd.su и перевод тела статьи в markdown нашей вики.
 *
 * Внешних библиотек у бэкенда нет, поэтому здесь свой терпимый к ошибкам
 * разборщик HTML: строит дерево узлов (тег, атрибуты, дети, текст), затем
 * дерево переводится в markdown, который понимает Utils.renderWikiMarkdown
 * на фронте: заголовки ##…####, абзацы, списки, GFM-таблицы, **жирный**,
 * _курсив_, внутренние ссылки dnd.su («/spells/205-fireball/»).
 *
 * Ничего не переводится и не сочиняется: текст статьи переносится как есть,
 * меняется только разметка.
 */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr', 'meta', 'link', 'col', 'source']);
const RAW_TAGS = new Set(['script', 'style']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'blockquote', 'hr', 'pre', 'figure', 'figcaption', 'dl', 'dt', 'dd'
]);

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** HTML → дерево { tag, attrs, children } / { text }. Терпит незакрытые теги. */
function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const src = String(html || '');
  let i = 0;

  const top = () => stack[stack.length - 1];
  const open = (tag, attrs) => {
    const node = { tag, attrs, children: [] };
    top().children.push(node);
    if (!VOID_TAGS.has(tag)) stack.push(node);
  };
  const closeUntil = (tag) => {
    const idx = stack.map((n) => n.tag).lastIndexOf(tag);
    if (idx <= 0) return false;
    stack.length = idx;
    return true;
  };
  const popWhile = (tags) => {
    while (stack.length > 1 && tags.includes(top().tag)) stack.pop();
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      top().children.push({ text: src.slice(i) });
      break;
    }
    if (lt > i) top().children.push({ text: src.slice(i, lt) });

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const gt = src.indexOf('>', lt);
    if (gt === -1) {
      top().children.push({ text: src.slice(lt) });
      break;
    }
    const inner = src.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase();
      closeUntil(tag);
      continue;
    }

    const m = inner.match(/^([a-zA-Z][\w:-]*)([\s\S]*?)\/?$/);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const selfClosing = /\/$/.test(inner);

    // Неявные закрытия, как делает браузер.
    if (tag === 'p') popWhile(['p']);
    if (tag === 'li') popWhile(['li']);
    if (tag === 'td' || tag === 'th') popWhile(['td', 'th']);
    if (tag === 'tr') popWhile(['td', 'th', 'tr']);
    if (tag === 'tbody' || tag === 'thead') popWhile(['td', 'th', 'tr', 'tbody', 'thead']);
    if (tag === 'table') popWhile(['p']);
    if (/^h[1-6]$/.test(tag)) popWhile(['p']);
    if (tag === 'ul' || tag === 'ol' || tag === 'div') popWhile(['p']);

    if (RAW_TAGS.has(tag)) {
      const closeIdx = src.toLowerCase().indexOf(`</${tag}`, i);
      const endTag = closeIdx === -1 ? src.length : src.indexOf('>', closeIdx) + 1;
      i = endTag <= 0 ? src.length : endTag;
      continue; // содержимое script/style выбрасываем
    }

    open(tag, attrs);
    if (selfClosing && !VOID_TAGS.has(tag)) stack.pop();
  }

  return root;
}

function hasClass(node, name) {
  return Boolean(node?.attrs?.class) && node.attrs.class.split(/\s+/).includes(name);
}

function nodeText(node) {
  if (!node) return '';
  if (node.text !== undefined) return decodeEntities(node.text);
  return (node.children || []).map(nodeText).join('');
}

function collapse(s) {
  return String(s || '').replace(/\s+/g, ' ');
}

/** Относительная ссылка dnd.su, если она ведёт на запись справочника; иначе null. */
function internalHref(href) {
  const h = String(href || '').trim().replace(/^https?:\/\/(?:www\.)?dnd\.su/i, '');
  if (/^\/(spells|bestiary|items|race|class|feats|backgrounds)\/\d+-[^/\s]+\/?$/i.test(h)) return h;
  if (/^\/articles\/[a-z]+\/\d+-[^/\s]+\/?$/i.test(h)) return h;
  return null;
}

/**
 * Заголовки dnd.su набраны капсом («ВЛАДЕНИЕ ОРУЖИЕМ») — приводим к обычному
 * регистру, если в тексте нет ни одной строчной буквы. Сами слова не меняются.
 */
function normalizeHeadingCase(text) {
  const t = collapse(text).trim();
  if (t.length < 4 || /[a-zа-яё]/.test(t)) return t;
  // Коды книг латиницей («(VGM)», «[XGE]») остаются как есть — опускаем только кириллицу.
  const lower = t.replace(/[А-ЯЁ]+/g, (w) => w.toLowerCase());
  return lower.replace(/(^|[\s(«"'\-—–])([а-яё])/u, (m, pre, ch) => pre + ch.toUpperCase());
}

/** Текст заголовка: плашка источника вложенной карточки («DMG14») — в скобках через пробел. */
function headingText(node) {
  if (!node) return '';
  if (node.text !== undefined) return decodeEntities(node.text);
  if (node.tag === 'span' && hasClass(node, 'source-plaque')) {
    const code = collapse(nodeText(node)).trim();
    return code ? ` (${code})` : '';
  }
  if (node.tag === 'sup' && nodeText(node).trim() === '?') return '';
  return (node.children || []).map(headingText).join('');
}

// ---------------------------------------------------------------------------
// Дерево → markdown
// ---------------------------------------------------------------------------

function inlineMd(node, ctx) {
  if (node.text !== undefined) return collapse(decodeEntities(node.text));
  const tag = node.tag;
  if (tag === 'br') return ' ';
  if (tag === 'img' || tag === 'input' || tag === 'wbr') return '';
  // Знаки «?» подсказок dnd.su: <sup><span tooltip-for=…>?</span></sup>
  if (tag === 'sup' && nodeText(node).trim() === '?') return '';
  if (tag === 'span' && node.attrs['tooltip-for'] && nodeText(node).trim() === '?') return '';

  const inner = (node.children || []).map((c) => inlineMd(c, ctx)).join('');
  if (tag === 'strong' || tag === 'b') return wrapMark(inner, '**');
  if (tag === 'em' || tag === 'i') return wrapMark(inner, '_');
  if (tag === 'code') return inner.trim() ? `\`${inner.trim()}\`` : '';
  if (tag === 'a') {
    const label = inner.trim();
    if (!label) return '';
    const href = node.attrs.href || '';
    const internal = internalHref(href);
    if (internal) return `[${label}](${internal})`;
    if (/^https?:\/\//i.test(href) && !/dnd\.su/i.test(href)) return `[${label}](${href})`;
    return label; // якоря «#…», ссылки на dnd.su-страницы вне справочника — просто текст
  }
  return inner;
}

/** «** текст **» ломает разметку — пробелы выносятся наружу маркера. */
function wrapMark(inner, mark) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return inner;
  // Вложенный одинаковый маркер — не дублируем.
  if (m[2].startsWith(mark) && m[2].endsWith(mark)) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

function isBlock(node) {
  return node.text === undefined && BLOCK_TAGS.has(node.tag);
}

/** Переводит детей узла в список markdown-блоков; inline-куски собираются в абзацы. */
function childrenToBlocks(node, ctx) {
  const blocks = [];
  let run = '';
  const flush = () => {
    const text = collapse(run).trim();
    if (text) blocks.push(text);
    run = '';
  };
  for (const child of node.children || []) {
    if (isBlock(child)) {
      flush();
      blocks.push(...blockMd(child, ctx));
    } else if (child.text === undefined && child.tag === 'br' && !run.trim()) {
      // <br> между блоками — просто отступ
    } else if (child.text === undefined && child.tag === 'br') {
      flush();
    } else {
      run += inlineMd(child, ctx);
    }
  }
  flush();
  return blocks;
}

function headingMd(level, text, ctx) {
  const title = normalizeHeadingCase(text);
  if (!title) return [];
  if (ctx.embed) {
    // Вложенная карточка (например, баллиста в «Осадном снаряжении»):
    // её заголовок — на уровень ниже заголовков статьи.
    return level <= 2 ? [`#### ${title}`] : [`**${title}**`];
  }
  const marks = level <= 2 ? '##' : level === 3 ? '###' : '####';
  return [`${marks} ${title}`];
}

function tableMd(node, ctx) {
  const rows = [];
  const walkRows = (n) => {
    for (const c of n.children || []) {
      if (c.text !== undefined) continue;
      if (c.tag === 'tr') rows.push(c);
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walkRows(c);
    }
  };
  walkRows(node);
  if (!rows.length) return [];

  const cellText = (cell) => collapse(
    (cell.children || []).map((c) => inlineMd(c, ctx)).join('')
  ).trim().replace(/\|/g, '/');

  const parsed = rows.map((tr) => {
    const cells = [];
    for (const c of tr.children || []) {
      if (c.text !== undefined || (c.tag !== 'td' && c.tag !== 'th')) continue;
      const span = Math.max(1, Number(c.attrs.colspan) || 1);
      cells.push({ text: cellText(c), span });
    }
    return cells;
  }).filter((cells) => cells.length);
  if (!parsed.length) return [];

  const width = Math.max(...parsed.map((cells) => cells.reduce((s, c) => s + c.span, 0)));
  const line = (cells) => {
    const out = [];
    for (const c of cells) {
      out.push(c.text);
      for (let k = 1; k < c.span; k += 1) out.push('');
    }
    while (out.length < width) out.push('');
    return `| ${out.join(' | ')} |`;
  };

  const lines = [line(parsed[0]), `| ${new Array(width).fill('---').join(' | ')} |`];
  for (const cells of parsed.slice(1)) lines.push(line(cells));
  return [lines.join('\n')];
}

/** Список, где каждый пункт — только якорная ссылка «#…»: оглавление страницы dnd.su. */
function isAnchorToc(node) {
  const lis = (node.children || []).filter((c) => c.text === undefined && c.tag === 'li');
  if (!lis.length) return false;
  return lis.every((li) => {
    const kids = (li.children || []).filter((c) => !(c.text !== undefined && !c.text.trim()));
    return kids.length === 1 && kids[0].tag === 'a' && /^#/.test(kids[0].attrs.href || '');
  });
}

function listMd(node, ordered, ctx) {
  if (isAnchorToc(node)) return [];
  const items = [];
  const trailing = [];
  let index = 0;
  for (const li of node.children || []) {
    if (li.text !== undefined || li.tag !== 'li') continue;
    index += 1;
    const inlineParts = [];
    const blockParts = [];
    for (const c of li.children || []) {
      if (isBlock(c)) blockParts.push(...blockMd(c, ctx));
      else inlineParts.push(inlineMd(c, ctx));
    }
    const text = collapse(inlineParts.join('')).trim();
    if (text) items.push(`${ordered ? `${index}.` : '-'} ${text}`);
    else if (blockParts.length && blockParts[0] && !/^[#|\-]/.test(blockParts[0])) {
      items.push(`${ordered ? `${index}.` : '-'} ${blockParts.shift()}`);
    }
    trailing.push(...blockParts);
  }
  const out = [];
  if (items.length) out.push(items.join('\n'));
  out.push(...trailing);
  return out;
}

function blockMd(node, ctx) {
  const tag = node.tag;
  if (RAW_TAGS.has(tag)) return [];
  if (tag === 'hr') return ['---'];
  const h = tag.match(/^h([1-6])$/);
  if (h) return headingMd(Number(h[1]), headingText(node), ctx);
  if (tag === 'table') return tableMd(node, ctx);
  if (tag === 'ul' || tag === 'ol') return listMd(node, tag === 'ol', ctx);
  if (tag === 'blockquote') return childrenToBlocks(node, ctx).map((b) => `> ${b}`);
  if (tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th' || tag === 'dt' || tag === 'dd') {
    return childrenToBlocks(node, ctx);
  }
  // div/section и прочие обёртки прозрачны; вложенная карточка понижает заголовки.
  const embed = ctx.embed || hasClass(node, 'embed');
  return childrenToBlocks(node, { ...ctx, embed });
}

/** Тело статьи dnd.su (HTML) → markdown. */
function htmlToMarkdown(html) {
  const root = parseHtml(html);
  const blocks = childrenToBlocks(root, { embed: false });
  return blocks
    .map((b) => b.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Вырезает тело статьи dnd.su из страницы целиком: от карточки текста до
 * раздела комментариев. Возвращает '' если разметка не найдена.
 */
function extractArticleBody(pageHtml) {
  const html = String(pageHtml || '');
  const start = html.indexOf('<div class="desc card__article-body"');
  if (start < 0) return '';
  const endMarkers = ['<h2 class="card-title">Комментарии', '<div class="card__footer"', '<section class="comments'];
  let end = -1;
  for (const marker of endMarkers) {
    const idx = html.indexOf(marker, start);
    if (idx > start && (end === -1 || idx < end)) end = idx;
  }
  return html.slice(start, end === -1 ? undefined : end);
}

module.exports = {
  parseHtml,
  nodeText,
  htmlToMarkdown,
  extractArticleBody,
  decodeEntities,
  normalizeHeadingCase
};
