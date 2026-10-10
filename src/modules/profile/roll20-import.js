/**
 * Перенос персонажа из Roll20: разбор PDF листа «D&D 5E by Roll20», сохранённого из браузера
 * («Печать → Сохранить как PDF»). Полей формы в таком PDF нет — только текст на местах
 * официального листа, поэтому значения ищутся по подписям («СПАСБРОСКИ», «КЛАСС И УРОВЕНЬ», …)
 * и по их взаимному расположению. Масштаб и сдвиг страницы учитываются: все допуски
 * умножаются на коэффициент s (расстояние «СПАСБРОСКИ» → «НАВЫКИ» относительно эталона).
 *
 * Здесь только чтение PDF и разбор (без базы): extractPdfPages → parseRoll20Pages.
 * Сверка со справочником и сборка черновика персонажа — roll20-import.service.js.
 */

const MAX_PAGES = 40;
const PARSE_TIMEOUT_MS = 20000;

// Эталонное расстояние по вертикали между подписями «СПАСБРОСКИ» и «НАВЫКИ» (лист Roll20, A4, 100 %).
const SAVES_TO_SKILLS = 288.8;

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

/** Сравнение текста: регистр, «ё», лишние пробелы и разложенные буквы не важны. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/** Число из текста листа: «+3», «-1», «−2» (типографский минус), «30 фт.» → 30. */
function parseIntLoose(value) {
  const m = String(value ?? '').replace(/[−–]/g, '-').match(/[+-]?\s*\d+/);
  return m ? Number(m[0].replace(/\s+/g, '')) : null;
}

function isNumeric(value) {
  return /^[+\-−–]?\s*\d+$/.test(String(value ?? '').trim());
}

/**
 * PDF → страницы с кусками текста: { width, height, items: [{ str, x, y, w, h }] }.
 * y — базовая линия от верхнего края страницы, h — размер шрифта.
 */
async function extractPdfPages(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0
  });
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createHttpError(422, 'PDF is too complex to read', 'PDF_UNREADABLE')), PARSE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readPages(task), timeout]);
  } catch (error) {
    if (error.statusCode) throw error;
    throw createHttpError(422, 'PDF could not be read', 'PDF_UNREADABLE');
  } finally {
    clearTimeout(timer);
    task.destroy().catch(() => {});
  }
}

async function readPages(task) {
  const doc = await task.promise;
  let title = '';
  try {
    const meta = await doc.getMetadata();
    title = String(meta?.info?.Title || '');
  } catch {
    title = '';
  }
  const pages = [];
  const count = Math.min(doc.numPages, MAX_PAGES);
  for (let p = 1; p <= count; p += 1) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const it of content.items) {
      const str = String(it.str || '').normalize('NFC');
      if (!str.trim()) continue;
      const [, , , d, e, f] = it.transform;
      items.push({
        str: str.trim(),
        x: e,
        y: viewport.height - f,
        w: Number(it.width) || 0,
        h: Math.abs(d) || Math.abs(it.height) || 0
      });
    }
    pages.push({ width: viewport.width, height: viewport.height, items });
    page.cleanup();
  }
  return { title, pages };
}

/* ------------------------------------------------------------------------ */
/* Поиск по странице                                                         */
/* ------------------------------------------------------------------------ */

const LABELS = {
  saves: ['спасброски', 'saving throws'],
  skills: ['навыки', 'skills'],
  name: ['имя персонажа', 'character name'],
  classLevel: ['класс и уровень', 'class & level', 'class and level'],
  background: ['предыстория', 'background'],
  playerName: ['имя игрока', 'player name'],
  race: ['раса', 'race'],
  alignment: ['мировоззрение', 'alignment'],
  xp: ['очки опыта', 'experience points'],
  inspiration: ['вдохновение', 'inspiration'],
  proficiency: ['бонус мастерства', 'proficiency bonus'],
  passive: ['пассивная мудрость (восприятие)', 'passive wisdom (perception)'],
  otherProfs: ['прочие владения и языки', 'other proficiencies & languages', 'other proficiencies and languages'],
  hpMax: ['максимум хитов', 'hit point maximum'],
  hpCurrent: ['текущие хиты', 'current hit points'],
  hpTemp: ['временные хиты', 'temporary hit points'],
  attackName: ['название', 'name'],
  attackBonus: ['атк', 'atk bonus'],
  attackDamage: ['урон/тип', 'damage/type'],
  attacks: ['атаки и заклинания', 'attacks & spellcasting', 'attacks and spellcasting'],
  equipment: ['снаряжение', 'equipment'],
  traits: ['черты характера', 'personality traits'],
  ideals: ['идеалы', 'ideals'],
  bonds: ['привязанности', 'bonds'],
  flaws: ['слабости', 'flaws'],
  features: ['особенности и черты', 'features & traits', 'features and traits'],
  cantrips: ['заговоры', 'cantrips']
};

const COIN_LABELS = {
  cp: ['cp', 'мм'],
  sp: ['sp', 'см'],
  ep: ['ep', 'эм'],
  gp: ['gp', 'зм'],
  pp: ['pp', 'пм']
};

function labelItems(items, key) {
  const variants = LABELS[key];
  return items.filter((it) => variants.includes(norm(it.str)));
}

function findLabel(items, key) {
  return labelItems(items, key)[0] || null;
}

const ALL_LABEL_TEXTS = new Set(Object.values(LABELS).flat());

function isLabel(item) {
  return ALL_LABEL_TEXTS.has(norm(item.str));
}

function inBox(items, { x1 = -Infinity, x2 = Infinity, y1 = -Infinity, y2 = Infinity }) {
  return items.filter((it) => it.x >= x1 && it.x <= x2 && it.y > y1 && it.y < y2);
}

/** Куски текста → строки (по базовой линии), в строке — слева направо. */
function groupLines(items, tolerance) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(it.y - line.y) <= tolerance) {
      line.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0].x;
    line.right = Math.max(...line.items.map((it) => it.x + it.w));
    line.text = joinItems(line.items);
  }
  return lines;
}

/** Склейка кусков одной строки: пробел ставится, только если между ними есть зазор. */
function joinItems(items) {
  let out = '';
  let prev = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (gap > Math.max(1, prev.h * 0.15)) out += ' ';
    }
    out += it.str;
    prev = it;
  }
  return out.trim();
}

/**
 * Строки многострочного поля → текст. Перенос по ширине поля склеивается пробелом.
 * Если первое слово следующей строки поместилось бы в конец предыдущей — автор сам
 * начал новую строку, перенос сохраняется.
 */
function joinParagraph(lines) {
  if (!lines.length) return '';
  const maxRight = Math.max(...lines.map((l) => l.right));
  let out = lines[0].text;
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1];
    const line = lines[i];
    const first = line.items?.[0];
    const word = line.text.split(' ')[0] || '';
    const charWidth = first && first.str.length ? first.w / first.str.length : 4;
    const wordFits = prev.right + charWidth * (word.length + 1) < maxRight - 1;
    out += wordFits ? `\n${line.text}` : ` ${line.text}`;
  }
  return out.trim();
}

/** Значение над подписью (шапка листа): тот же левый край, строкой выше. */
function valueAbove(items, label, s) {
  if (!label) return '';
  const found = items.filter((it) => !isLabel(it)
    && Math.abs(it.x - label.x) <= 8 * s
    && it.y < label.y - 2 * s
    && it.y > label.y - 16 * s);
  return joinItems(found.sort((a, b) => a.x - b.x));
}

/** Значение левее подписи на той же строке (бонус мастерства, вдохновение, пассивная мудрость). */
function valueLeftOf(items, label, s) {
  if (!label) return '';
  const found = items.filter((it) => !isLabel(it)
    && Math.abs(it.y - label.y) <= 6 * s
    && it.x < label.x - 1
    && it.x > label.x - 45 * s);
  return joinItems(found.sort((a, b) => a.x - b.x));
}

/* ------------------------------------------------------------------------ */
/* Разделы листа                                                             */
/* ------------------------------------------------------------------------ */

/** Строки «число — название» (спасброски, навыки) в полосе над подписью. */
function readRows(items, label, yTop, s) {
  const band = inBox(items, {
    x1: label.x - 25 * s,
    x2: label.x + 85 * s,
    y1: yTop,
    y2: label.y - 3 * s
  }).filter((it) => !isLabel(it));
  return groupLines(band, 3 * s)
    .map((line) => {
      const numItem = line.items.find((it) => isNumeric(it.str));
      if (!numItem) return null;
      const name = joinItems(line.items.filter((it) => it !== numItem));
      return { value: parseIntLoose(numItem.str), name };
    })
    .filter(Boolean);
}

/** Таблица «Название / Атк / Урон» до подписи «Атаки и заклинания». */
function readAttacks(items, s) {
  const out = [];
  for (const header of labelItems(items, 'attackName')) {
    const sameRow = items.filter((it) => Math.abs(it.y - header.y) <= 3 * s && it.x > header.x);
    const atk = sameRow.find((it) => LABELS.attackBonus.includes(norm(it.str)));
    const dmg = sameRow.find((it) => LABELS.attackDamage.includes(norm(it.str)));
    if (!atk || !dmg) continue;
    const footer = labelItems(items, 'attacks')
      .filter((it) => it.y > header.y && Math.abs(it.x - header.x) < 120 * s)
      .sort((a, b) => a.y - b.y)[0];
    const yEnd = footer ? footer.y - 3 * s : header.y + 160 * s;
    const band = inBox(items, { x1: header.x - 10 * s, x2: dmg.x + 75 * s, y1: header.y + 3 * s, y2: yEnd })
      .filter((it) => !isLabel(it));
    for (const line of groupLines(band, 3 * s)) {
      const name = joinItems(line.items.filter((it) => it.x < atk.x - 5 * s));
      const bonus = joinItems(line.items.filter((it) => it.x >= atk.x - 5 * s && it.x < dmg.x - 5 * s));
      const damage = joinItems(line.items.filter((it) => it.x >= dmg.x - 5 * s));
      if (name || bonus || damage) out.push({ name, bonus, damage });
    }
  }
  return out;
}

/** Кошелёк и строки снаряжения над подписью «Снаряжение» (на первой и второй странице). */
function readEquipment(items, s) {
  const money = {};
  const equipment = [];
  for (const label of labelItems(items, 'equipment')) {
    const coins = items.filter((it) => it.y < label.y
      && it.x > label.x - 70 * s && it.x < label.x + 120 * s
      && Object.values(COIN_LABELS).some((v) => v.includes(norm(it.str))));
    if (!coins.length) continue;
    const coinY = Math.max(...coins.map((c) => c.y));
    const coinRow = coins.filter((c) => Math.abs(c.y - coinY) <= 3 * s).sort((a, b) => a.x - b.x);
    const numbers = inBox(items, { x1: label.x - 70 * s, x2: label.x + 120 * s, y1: coinY - 20 * s, y2: coinY - 3 * s })
      .filter((it) => isNumeric(it.str));
    for (const num of numbers) {
      const coin = coinRow.find((c) => c.x > num.x);
      if (!coin) continue;
      const key = Object.keys(COIN_LABELS).find((k) => COIN_LABELS[k].includes(norm(coin.str)));
      if (key && !(key in money)) money[key] = parseIntLoose(num.str);
    }
    const band = inBox(items, { x1: label.x - 62 * s, x2: label.x + 120 * s, y1: coinY + 4 * s, y2: label.y - 3 * s })
      .filter((it) => !isLabel(it));
    let current = null;
    let prevY = -Infinity;
    for (const line of groupLines(band, 2 * s)) {
      const first = line.items[0];
      const rest = line.items.slice(1);
      if (isNumeric(first.str) && rest.length) {
        current = { name: joinItems(rest), qty: Math.max(1, parseIntLoose(first.str) || 1) };
        equipment.push(current);
      } else if (current && line.y - prevY < 10 * s) {
        current.name = `${current.name} ${line.text}`.trim();
      } else {
        current = { name: line.text, qty: 1 };
        equipment.push(current);
      }
      prevY = line.y;
    }
  }
  return { money, equipment };
}

/** Первая страница: шапка, характеристики, спасброски, навыки, бой, атаки, личность, особенности. */
function parseMainPage(page, s, saves, skills) {
  const items = page.items;
  const out = {};

  const classLabel = findLabel(items, 'classLevel');
  const nameLabel = findLabel(items, 'name');
  if (nameLabel) {
    const xLimit = classLabel ? classLabel.x - 10 * s : nameLabel.x + 150 * s;
    const candidates = items.filter((it) => !isLabel(it)
      && it.x < xLimit
      && it.y < nameLabel.y - 5 * s && it.y > nameLabel.y - 40 * s);
    const nearestY = Math.max(...candidates.map((it) => it.y));
    out.name = joinItems(candidates.filter((it) => Math.abs(it.y - nearestY) <= 3 * s).sort((a, b) => a.x - b.x));
  }
  out.classLevel = valueAbove(items, classLabel, s);
  out.background = valueAbove(items, findLabel(items, 'background'), s);
  out.playerName = valueAbove(items, findLabel(items, 'playerName'), s);
  out.race = valueAbove(items, findLabel(items, 'race'), s);
  out.alignment = valueAbove(items, findLabel(items, 'alignment'), s);
  out.experience = parseIntLoose(valueAbove(items, findLabel(items, 'xp'), s));

  // Характеристики: шесть крупных чисел (модификаторы) в левой колонке, значение — кружок под ними.
  const bodySize = 7.1 * s;
  const mods = items
    .filter((it) => it.h >= bodySize * 2.2 && it.x < saves.x - 20 * s && isNumeric(it.str))
    .sort((a, b) => a.y - b.y);
  out.abilities = mods.slice(0, 6).map((mod) => {
    const score = items.find((it) => it !== mod && isNumeric(it.str) && it.h < mod.h
      && Math.abs(it.x - mod.x) <= 8 * s && it.y > mod.y + 8 * s && it.y < mod.y + 32 * s);
    return { modifier: parseIntLoose(mod.str), score: score ? parseIntLoose(score.str) : null };
  });

  const pbLabel = findLabel(items, 'proficiency');
  out.proficiencyBonus = parseIntLoose(valueLeftOf(items, pbLabel, s));
  out.inspiration = valueLeftOf(items, findLabel(items, 'inspiration'), s);
  out.passivePerception = parseIntLoose(valueLeftOf(items, findLabel(items, 'passive'), s));

  out.saves = readRows(items, saves, (pbLabel ? pbLabel.y : saves.y - 100 * s) + 10 * s, s);
  out.skills = readRows(items, skills, saves.y + 5 * s, s);

  const passiveLabel = findLabel(items, 'passive');
  const otherLabel = findLabel(items, 'otherProfs');
  if (otherLabel) {
    const band = inBox(items, {
      x1: otherLabel.x - 45 * s,
      x2: otherLabel.x + 140 * s,
      y1: (passiveLabel ? passiveLabel.y : skills.y) + 8 * s,
      y2: otherLabel.y - 3 * s
    }).filter((it) => !isLabel(it));
    out.otherProfs = joinParagraph(groupLines(band, 3 * s));
  }

  // Правая колонка: черты характера, идеалы, привязанности, слабости, список особенностей.
  const traits = findLabel(items, 'traits');
  const ideals = findLabel(items, 'ideals');
  const bonds = findLabel(items, 'bonds');
  const flaws = findLabel(items, 'flaws');
  const featuresLabel = findLabel(items, 'features');
  const rightX = traits ? traits.x - 60 * s : page.width * 0.66;
  const block = (yTop, label) => {
    if (!label) return '';
    const band = inBox(items, { x1: rightX, y1: yTop, y2: label.y - 3 * s }).filter((it) => !isLabel(it));
    return joinParagraph(groupLines(band, 3 * s));
  };
  out.traits = block(traits ? traits.y - 70 * s : 0, traits);
  out.ideals = block(traits ? traits.y + 3 * s : 0, ideals);
  out.bonds = block(ideals ? ideals.y + 3 * s : 0, bonds);
  out.flaws = block(bonds ? bonds.y + 3 * s : 0, flaws);
  out.featureNames = [];
  if (featuresLabel && flaws) {
    const band = inBox(items, { x1: featuresLabel.x - 60 * s, y1: flaws.y + 3 * s, y2: featuresLabel.y - 3 * s })
      .filter((it) => !isLabel(it));
    out.featureNames = groupLines(band, 3 * s).map((l) => l.text).filter(Boolean);
  }

  // Бой: КД, инициатива, скорость — строка над «Максимум хитов»; затем хиты и кости хитов.
  const hpMax = findLabel(items, 'hpMax');
  const hpCur = findLabel(items, 'hpCurrent');
  const hpTemp = findLabel(items, 'hpTemp');
  const xpLabel = findLabel(items, 'xp');
  if (hpMax) {
    const middleRight = traits ? rightX - 5 * s : hpMax.x + 175 * s;
    const middleLeft = hpMax.x - 15 * s;
    const top = inBox(items, { x1: middleLeft, x2: middleRight, y1: (xpLabel ? xpLabel.y : hpMax.y - 110 * s) + 20 * s, y2: hpMax.y - 20 * s })
      .filter((it) => !isLabel(it))
      .sort((a, b) => a.x - b.x);
    out.armorClassRaw = top[0]?.str || '';
    out.initiative = top[1] ? parseIntLoose(top[1].str) : null;
    out.speed = top[2] ? parseIntLoose(top[2].str) : null;
    const maxValue = items.find((it) => !isLabel(it) && Math.abs(it.y - hpMax.y) <= 4 * s && it.x > hpMax.x + hpMax.w && it.x < middleRight);
    out.hpMax = maxValue ? parseIntLoose(maxValue.str) : null;
    const numberIn = (y1, y2) => {
      const found = inBox(items, { x1: middleLeft, x2: middleRight, y1, y2 }).filter((it) => !isLabel(it) && isNumeric(it.str));
      return found.length ? parseIntLoose(found[0].str) : null;
    };
    if (hpCur) out.hpCurrent = numberIn(hpMax.y + 4 * s, hpCur.y - 3 * s);
    if (hpCur && hpTemp) out.hpTemp = numberIn(hpCur.y + 3 * s, hpTemp.y - 3 * s);
    if (hpTemp) {
      const attackHeader = labelItems(items, 'attackName').find((it) => it.y > hpTemp.y);
      const band = inBox(items, {
        x1: middleLeft,
        x2: hpMax.x + 85 * s,
        y1: hpTemp.y + 3 * s,
        y2: attackHeader ? attackHeader.y - 3 * s : hpTemp.y + 80 * s
      }).filter((it) => !isLabel(it));
      const total = band.find((it) => isNumeric(it.str));
      const die = band.find((it) => /\d*\s*[dкД]\s*\d+/i.test(it.str));
      out.hitDiceTotal = total ? parseIntLoose(total.str) : null;
      out.hitDie = die ? die.str : '';
    }
  }

  out.attacks = readAttacks(items, s);
  const { money, equipment } = readEquipment(items, s);
  out.money = money;
  out.equipment = equipment;
  return out;
}

/** Страница заклинаний: базовая характеристика, класс, коробки кругов с ячейками и названиями. */
function parseSpellPage(page, s) {
  const items = page.items;
  const out = { ability: '', className: '', levels: [] };
  const caps = items.filter((it) => norm(it.str) === 'spellcasting');
  for (const cap of caps) {
    const next = items.find((it) => Math.abs(it.x - cap.x) < 20 * s && it.y > cap.y && it.y < cap.y + 10 * s);
    const kind = norm(next?.str || '');
    const value = items.filter((it) => !/^(spellcasting|ability|class|spell save dc|spell attack|bonus)$/.test(norm(it.str))
      && Math.abs(it.x - cap.x) < 35 * s
      && it.y < cap.y - 5 * s && it.y > cap.y - 35 * s);
    const text = joinItems(value.sort((a, b) => a.x - b.x));
    if (kind === 'ability') out.ability = text;
    if (kind === 'class') out.className = text;
  }

  // Заголовок коробки: цифра круга и справа на той же строке «ЗАГОВОРЫ» или число ячеек.
  const headers = [];
  for (const it of items) {
    if (!/^\d$/.test(it.str)) continue;
    const right = items
      .filter((o) => o !== it && Math.abs(o.y - it.y) <= 2.5 * s && o.x > it.x + 10 * s && o.x < it.x + 130 * s)
      .sort((a, b) => a.x - b.x);
    const isCantrip = right.some((o) => LABELS.cantrips.includes(norm(o.str)));
    const slotNums = right.filter((o) => isNumeric(o.str));
    if (!isCantrip && !slotNums.length) continue;
    headers.push({
      level: Number(it.str),
      x: it.x,
      y: it.y,
      total: slotNums[0] ? parseIntLoose(slotNums[0].str) : null,
      used: slotNums[1] ? parseIntLoose(slotNums[1].str) : null,
      items: [it, ...right]
    });
  }
  if (!headers.length) return out;
  const headerItems = new Set(headers.flatMap((h) => h.items));
  const firstY = Math.min(...headers.map((h) => h.y));
  const spellItems = items.filter((it) => !headerItems.has(it) && it.y > firstY);
  const byHeader = new Map(headers.map((h) => [h, []]));
  for (const it of spellItems) {
    const owner = headers
      .filter((h) => Math.abs(it.x - h.x) <= 15 * s && h.y < it.y)
      .sort((a, b) => b.y - a.y)[0];
    if (owner) byHeader.get(owner).push(it);
  }
  for (const h of headers.sort((a, b) => a.level - b.level)) {
    const names = groupLines(byHeader.get(h), 2.5 * s).map((l) => l.text).filter(Boolean);
    out.levels.push({ level: h.level, total: h.total, used: h.used, names });
  }
  return out;
}

/**
 * Страницы «Особенности и черты»: строки по колонкам сверху вниз. Колонки стоят тесно
 * (зазор меньше ширины слова), поэтому сначала текст раскладывается по колонкам —
 * по левым краям, с которых начинается много строк, — и только потом собирается в строки.
 */
function featureLines(pages, s) {
  const lines = [];
  for (const page of pages) {
    const body = page.items.filter((it) => it.h < 14 * s);
    const starts = [];
    for (const it of [...body].sort((a, b) => a.x - b.x)) {
      const last = starts[starts.length - 1];
      if (last && it.x - last.x <= 3 * s) last.count += 1;
      else starts.push({ x: it.x, count: 1 });
    }
    const edges = starts.filter((st) => st.count >= 3).map((st) => st.x);
    if (!edges.length) continue;
    const columns = edges.map(() => []);
    for (const it of body) {
      let index = 0;
      edges.forEach((x, i) => {
        if (x <= it.x + 3 * s) index = i;
      });
      columns[index].push(it);
    }
    for (const col of columns) lines.push(...groupLines(col, 2.5 * s));
  }
  return lines;
}

function parseFeatureDescriptions(lines, names) {
  const result = new Map();
  const pending = names.map((name) => ({ name, key: norm(name).replace(/…$/, '').trim(), truncated: /…$/.test(name) }));
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current) result.set(current.name, { fullName: current.fullName, description: joinParagraph(buffer) });
    buffer = [];
  };
  for (const line of lines) {
    const key = norm(line.text);
    const match = pending.find((p) => !p.used && (p.truncated ? key.startsWith(p.key) : key === p.key));
    if (match) {
      flush();
      match.used = true;
      current = { name: match.name, fullName: line.text };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return result;
}

/**
 * Разбор всего PDF. Бросает 422 NOT_ROLL20_SHEET, если первой страницы листа Roll20 не нашлось.
 * Возвращает «сырые» значения листа — без справочника и без догадок.
 */
function parseRoll20Pages({ title, pages }) {
  let main = null;
  let s = 1;
  let saves = null;
  let skills = null;
  for (const page of pages) {
    const sv = findLabel(page.items, 'saves');
    const sk = findLabel(page.items, 'skills');
    if (sv && sk && sk.y > sv.y) {
      main = page;
      saves = sv;
      skills = sk;
      s = (sk.y - sv.y) / SAVES_TO_SKILLS;
      break;
    }
  }
  if (!main) {
    throw createHttpError(422, 'This PDF does not look like a Roll20 character sheet', 'NOT_ROLL20_SHEET');
  }

  const result = parseMainPage(main, s, saves, skills);
  result.campaign = /\|\s*roll20\s*$/i.test(title) ? title.replace(/\|\s*roll20\s*$/i, '').trim() : '';

  // Остальные страницы: продолжение снаряжения и атак, заклинания, «Особенности и черты».
  const featurePages = [];
  let section = '';
  result.spells = null;
  for (const page of pages) {
    if (page === main) continue;
    const heading = page.items.find((it) => it.h >= 14 * s && it.y < 60 * s);
    if (heading) section = LABELS.features.includes(norm(heading.str)) ? 'features' : 'other';
    if (page.items.some((it) => norm(it.str) === 'spellcasting')) {
      if (!result.spells) result.spells = parseSpellPage(page, s);
      continue;
    }
    if (section === 'features') {
      featurePages.push(page);
      continue;
    }
    // Карточки заклинаний и прочие страницы с заголовком не нужны — описания есть в справочнике.
    if (section) continue;
    if (findLabel(page.items, 'equipment') || findLabel(page.items, 'attacks')) {
      const extra = readEquipment(page.items, s);
      result.equipment.push(...extra.equipment);
      for (const [k, v] of Object.entries(extra.money)) {
        if (!(k in result.money)) result.money[k] = v;
      }
      result.attacks.push(...readAttacks(page.items, s));
    }
  }
  result.featureDescriptions = parseFeatureDescriptions(featureLines(featurePages, s), result.featureNames);
  return result;
}

/* ------------------------------------------------------------------------ */
/* Черновик персонажа                                                        */
/* ------------------------------------------------------------------------ */

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
// Навыки в листе Roll20 идут по английскому алфавиту — в том же порядке, что и у нас.
const SKILL_IDS = [
  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
  'history', 'insight', 'intimidation', 'investigation', 'medicine',
  'nature', 'perception', 'performance', 'persuasion', 'religion',
  'sleight_of_hand', 'stealth', 'survival'
];
const HIT_DICE = ['1d6', '1d8', '1d10', '1d12'];

const ALIGNMENTS = {
  LG: 'Законно-доброе',
  NG: 'Нейтрально-доброе',
  CG: 'Хаотично-доброе',
  LN: 'Законно-нейтральное',
  NN: 'Истинно-нейтральное',
  CN: 'Хаотично-нейтральное',
  LE: 'Законно-злое',
  NE: 'Нейтрально-злое',
  CE: 'Хаотично-злое'
};

/** «Хаотично - Злой», «Chaotic Evil» → значение из списка листа («Хаотично-злое»); иначе как есть. */
function mapAlignment(raw) {
  const text = norm(raw).replace(/\s*-\s*/g, '-');
  if (!text) return '';
  const parts = text.split(/[-\s]+/).filter(Boolean);
  const ethicOf = (word) => {
    if (/^(законн|lawful)/.test(word)) return 'L';
    if (/^(хаотичн|chaotic)/.test(word)) return 'C';
    if (/^(нейтрал|neutral|истинн|true)/.test(word)) return 'N';
    return '';
  };
  const moralOf = (word) => {
    if (/^(добр|good)/.test(word)) return 'G';
    if (/^(зл|evil)/.test(word)) return 'E';
    if (/^(нейтрал|neutral)/.test(word)) return 'N';
    return '';
  };
  const ethic = ethicOf(parts[0] || '');
  let moral = parts.length > 1 ? moralOf(parts[parts.length - 1]) : '';
  if (parts.length === 1 && ethic === 'N') moral = 'N';
  if (ethic && moral) return ALIGNMENTS[`${ethic}${moral}`];
  return String(raw || '').trim();
}

/** Подклассы справочника хранятся с пометками вида «Первобытный страж \[Primal guardian\]». */
function cleanSubclass(name) {
  return String(name || '').replace(/\\?\[[^\]]*\\?\]/g, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
}

function containsWord(haystack, needle) {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s(,/])${escaped}($|[\\s),/\\d])`).test(haystack);
}

/**
 * Класс и уровень из поля «Класс и уровень»: «Школа Некромантии Wizard 9», часто обрезанное
 * многоточием («Школа Некромантии Wi…»). Класс — по названию (рус./англ.), по подклассу
 * справочника или по началу обрезанного слова.
 */
function resolveClass(rawText, classes) {
  let text = String(rawText || '').trim();
  const truncated = /(…|\.\.\.)$/.test(text);
  text = text.replace(/(…|\.\.\.)$/, '').trim();
  let level = null;
  if (!truncated) {
    const m = text.match(/(\d{1,2})\s*$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) {
      level = Number(m[1]);
      text = text.slice(0, m.index).trim();
    }
  }
  const key = norm(text);
  let cls = classes.find((c) => [c.name, c.nameEn].some((n) => n && containsWord(key, norm(n)))) || null;
  let how = cls ? 'name' : '';
  const subMatches = [];
  for (const c of classes) {
    const sub = (c.subclasses || []).map(cleanSubclass).find((sc) => sc.length >= 4 && key.includes(norm(sc)));
    if (sub) subMatches.push({ c, sub });
  }
  const lastWord = truncated ? key.split(' ').pop() : '';
  const prefixMatches = lastWord.length >= 2
    ? classes.filter((c) => [c.name, c.nameEn].some((n) => n && norm(n).startsWith(lastWord)))
    : [];
  if (!cls) {
    const narrowed = subMatches.length > 1 ? subMatches.filter((m) => prefixMatches.includes(m.c)) : subMatches;
    if (narrowed.length === 1) {
      cls = narrowed[0].c;
      how = 'subclass';
    } else if (prefixMatches.length === 1) {
      cls = prefixMatches[0];
      how = 'prefix';
    }
  }
  const subclass = cls ? (subMatches.find((m) => m.c === cls)?.sub || '') : '';
  return { cls, how, subclass, level, truncated, text };
}

/** Кость хитов: «1d6», «d6», «к6», «9d6» → «1d6» из списка листа. */
function normalizeHitDie(value) {
  const m = String(value || '').toLowerCase().replace(/к/g, 'd').match(/d\s*(\d+)/);
  const die = m ? `1d${m[1]}` : '';
  return HIT_DICE.includes(die) ? die : '';
}

/**
 * Обрезанное название («Лёгкий арба…») дописывается, если ровно один вариант из известных
 * названий (снаряжение листа, оружие и заклинания справочника) начинается так же.
 */
function completeTruncated(name, candidates) {
  const text = String(name || '').trim();
  if (!/(…|\.\.\.)$/.test(text)) return { name: text, status: 'full' };
  const prefix = norm(text.replace(/(…|\.\.\.)$/, ''));
  if (prefix.length < 3) return { name: text, status: 'truncated' };
  const found = new Map();
  for (const candidate of candidates) {
    const n = norm(candidate);
    if (n.startsWith(prefix) && n.length > prefix.length) found.set(n, candidate);
  }
  if (found.size === 1) return { name: [...found.values()][0], status: 'completed' };
  return { name: text, status: 'truncated' };
}

/** «Арбалет, лёгкий» (так в таблице dnd.su) → ещё и «Лёгкий арбалет» (так пишут в листах). */
function weaponNameVariants(name) {
  const out = [name];
  const m = String(name || '').match(/^([^,]+),\s*(.+)$/);
  if (m) {
    const adjective = m[2].trim();
    out.push(`${adjective.charAt(0).toUpperCase()}${adjective.slice(1)} ${m[1].trim().toLowerCase()}`);
  }
  return out;
}

function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
}

function abilityFromText(value) {
  const t = norm(value);
  if (/^(интеллект|intelligence|int)/.test(t)) return 'int';
  if (/^(мудрост|wisdom|wis)/.test(t)) return 'wis';
  if (/^(харизм|charisma|cha)/.test(t)) return 'cha';
  return '';
}

/**
 * Разобранный лист + справочник → черновик персонажа в формате API и список «проверьте».
 * wiki: { classes: [{ name, nameEn, hitDice, subclasses }], spells: Map(norm → { name, level }),
 *         weapons: [названия] }.
 */
function buildDraft(raw, wiki) {
  const report = [];
  const add = (code, params = {}) => report.push({ code, params });

  // Класс и уровень.
  const classInfo = resolveClass(raw.classLevel, wiki.classes || []);
  let className = '';
  if (classInfo.cls) {
    className = classInfo.subclass ? `${classInfo.cls.name} (${classInfo.subclass})` : classInfo.cls.name;
    if (classInfo.how !== 'name') add(classInfo.how === 'subclass' ? 'classFromSubclass' : 'classFromPrefix', { raw: raw.classLevel, className });
  } else {
    className = classInfo.text;
    add('classUnknown', { raw: raw.classLevel || '' });
  }
  let level = classInfo.level;
  if (!level && Number.isInteger(raw.hitDiceTotal) && raw.hitDiceTotal >= 1 && raw.hitDiceTotal <= 20) {
    level = raw.hitDiceTotal;
    add('levelFromHitDice', { level });
  }
  if (!level) {
    level = 1;
    add('levelUnknown');
  }

  // Характеристики.
  const abilities = {};
  ABILITY_KEYS.forEach((key, i) => {
    const row = raw.abilities?.[i];
    let score = row?.score;
    if (!Number.isInteger(score) && Number.isInteger(row?.modifier)) {
      score = 10 + row.modifier * 2;
      add('abilityFromModifier', { ability: key });
    }
    abilities[key] = Number.isInteger(score) ? Math.max(1, Math.min(30, score)) : 10;
  });
  if ((raw.abilities || []).length < 6) add('abilitiesIncomplete');

  const pb = Number.isInteger(raw.proficiencyBonus) ? raw.proficiencyBonus : Math.ceil(level / 4) + 1;

  // Владения: число в листе минус модификатор характеристики = бонус мастерства (×2 — экспертиза).
  const saveThrowProficiencies = {};
  ABILITY_KEYS.forEach((key, i) => {
    const row = raw.saves?.[i];
    saveThrowProficiencies[key] = Boolean(row && Number.isInteger(row.value) && row.value - abilityMod(abilities[key]) >= pb);
  });
  const SKILL_ABILITY = {
    acrobatics: 'dex', animal_handling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha',
    history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis',
    nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int',
    sleight_of_hand: 'dex', stealth: 'dex', survival: 'wis'
  };
  const skillProficiencies = {};
  const expertise = [];
  const skillsRead = (raw.skills || []).length === SKILL_IDS.length;
  SKILL_IDS.forEach((id, i) => {
    const row = skillsRead ? raw.skills[i] : null;
    const diff = row && Number.isInteger(row.value) ? row.value - abilityMod(abilities[SKILL_ABILITY[id]]) : 0;
    skillProficiencies[id] = diff >= pb;
    if (pb > 0 && diff >= pb * 2) expertise.push(id);
  });
  if (!skillsRead) add('skillsUnread');
  if (expertise.length) add('expertise', { skills: expertise });

  // Бой.
  const acText = String(raw.armorClassRaw || '');
  const acNumbers = (acText.match(/\d+/g) || []).map(Number);
  const armorClass = acNumbers.length ? acNumbers[0] : 10;
  if (acNumbers.length > 1) add('armorClassChoice', { raw: acText, value: armorClass });
  const hpMax = Number.isInteger(raw.hpMax) && raw.hpMax > 0 ? raw.hpMax : 10;
  if (!Number.isInteger(raw.hpMax)) add('hpMaxMissing');
  let hpCurrent = raw.hpCurrent;
  if (!Number.isInteger(hpCurrent)) {
    hpCurrent = hpMax;
    add('hpCurrentFromMax', { value: hpMax });
  }
  const hitDie = normalizeHitDie(raw.hitDie) || normalizeHitDie(classInfo.cls?.hitDice) || '1d8';

  // Заклинания: сверка со справочником, круг — из справочника, повторы убираются.
  const spells = [];
  const seen = new Set();
  const custom = [];
  const moved = [];
  const duplicates = [];
  for (const box of raw.spells?.levels || []) {
    for (const name of box.names) {
      const found = wiki.spells?.get(norm(name));
      const entry = found ? { name: found.name, level: found.level } : { name, level: box.level };
      const key = norm(entry.name);
      if (seen.has(key)) {
        duplicates.push(entry.name);
        continue;
      }
      seen.add(key);
      if (!found) custom.push(name);
      else if (found.level !== box.level) moved.push({ name: found.name, from: box.level, to: found.level });
      spells.push({ ...entry, prepared: false });
    }
  }
  if (moved.length) add('spellsMoved', { spells: moved });
  if (duplicates.length) add('spellsDuplicates', { names: [...new Set(duplicates)] });
  if (custom.length) add('spellsCustom', { names: custom });
  const spellSlots = {};
  for (let lvl = 1; lvl <= 9; lvl += 1) {
    const box = (raw.spells?.levels || []).find((b) => b.level === lvl);
    spellSlots[lvl] = { total: Math.max(0, box?.total || 0), used: Math.max(0, box?.used || 0) };
  }

  // Особенности: название из списка первой страницы (полное — со страницы описаний), описание свёрнуто.
  const features = (raw.featureNames || []).map((name) => {
    const desc = raw.featureDescriptions?.get(name);
    return {
      name: desc?.fullName || name,
      source: '',
      roll: '',
      description: desc?.description || '',
      collapsed: Boolean(desc?.description)
    };
  });

  // Атаки: обрезанные названия дописываются по снаряжению, оружию и заклинаниям.
  const equipment = (raw.equipment || []).filter((e) => e.name).map((e) => ({ name: e.name, qty: e.qty || 1, weight: null }));
  const candidates = [
    ...equipment.map((e) => e.name),
    ...(wiki.weapons || []).flatMap(weaponNameVariants),
    ...spells.map((sp) => sp.name),
    ...features.map((f) => f.name)
  ];
  const completed = [];
  const truncatedAttacks = [];
  const attacks = (raw.attacks || []).map((row) => {
    const result = completeTruncated(row.name, candidates);
    if (result.status === 'completed') completed.push({ from: row.name, to: result.name });
    if (result.status === 'truncated') truncatedAttacks.push(row.name);
    return { name: result.name, bonus: row.bonus || '', damage: row.damage || '' };
  });
  if (completed.length) add('attacksCompleted', { items: completed });
  if (truncatedAttacks.length) add('attacksTruncated', { names: [...new Set(truncatedAttacks)] });

  const money = {};
  for (const coin of ['cp', 'sp', 'ep', 'gp', 'pp']) {
    money[coin] = Number.isInteger(raw.money?.[coin]) ? Math.max(0, raw.money[coin]) : 0;
  }

  const alignment = mapAlignment(raw.alignment);
  const inspiration = Boolean(raw.inspiration) && !/^(0|нет|no|false)$/i.test(String(raw.inspiration).trim());
  const castAbility = abilityFromText(raw.spells?.ability || '');

  if (!raw.name) add('nameMissing');
  if (raw.campaign) add('campaignFromTitle', { name: raw.campaign });
  add('notInPdf');

  const sheet = {
    alignment,
    experience: Number.isInteger(raw.experience) ? raw.experience : 0,
    proficiencyBonus: pb,
    inspiration,
    abilities,
    skillProficiencies,
    saveThrowProficiencies,
    combat: {
      armorClass,
      initiative: Number.isInteger(raw.initiative) ? raw.initiative : abilityMod(abilities.dex),
      speed: Number.isInteger(raw.speed) ? raw.speed : 30,
      hpCurrent,
      hpMax,
      tempHp: Number.isInteger(raw.hpTemp) ? raw.hpTemp : 0,
      hitDice: hitDie,
      hitDiceUsed: 0,
      deathSaves: { successes: 0, failures: 0 }
    },
    equipment,
    spells,
    personality: {
      traits: raw.traits || '',
      ideals: raw.ideals || '',
      bonds: raw.bonds || '',
      flaws: raw.flaws || ''
    },
    proficienciesLanguages: raw.otherProfs || '',
    features,
    attacks,
    money,
    spellcasting: { className: raw.spells?.className || '', ability: castAbility },
    spellSlots
  };

  return {
    character: {
      name: raw.name || '',
      className,
      level,
      race: raw.race || '',
      background: raw.background || '',
      gameSystem: 'D&D 5e',
      campaignName: raw.campaign || '',
      notes: '',
      status: 'active',
      sheet
    },
    report
  };
}

module.exports = {
  norm,
  parseIntLoose,
  extractPdfPages,
  parseRoll20Pages,
  buildDraft,
  mapAlignment,
  resolveClass,
  completeTruncated,
  createHttpError
};
