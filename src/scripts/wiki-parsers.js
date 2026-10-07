/**
 * Разбор текстов dnd.su в машиночитаемые поля (payload.data) и плоские
 * значения для фильтров (filters). Ничего не домысливает: каждое поле — это
 * фрагмент исходного текста, найденный по устойчивой метке dnd.su. Если
 * метки нет — поле пустое (null / '' / []).
 *
 * Потребители: страница вики, лист персонажа (заклинания), стол (токен
 * монстра из бестиария), мастер создания персонажа.
 */

// ---------------------------------------------------------------------------
// Общие помощники
// ---------------------------------------------------------------------------

/**
 * dnd.su рисует всплывающую подсказку значком «?» после термина: «Средний? Гуманоид»,
 * «тёмное зрение? 60 футов», «Иммунитет к состоянию отравление?». Знак не
 * часть текста. Убираем его только после известных терминов (размеры,
 * состояния, чувства) — настоящие вопросы в описаниях («Кто выключил свет?»)
 * не трогаем.
 */
// «\w» и «\b» в JS не знают кириллицу — всё через явные классы букв.
const TOOLTIP_TERMS = [
  'крошечн[а-яё]*', 'маленьк[а-яё]*', 'средн[а-яё]*', 'больш[а-яё]*', 'огромн[а-яё]*', 'громадн[а-яё]*',
  'зрение', 'вибрации', 'чутьё', 'отравление', 'очарование', 'испуг', 'истощение',
  'паралич', 'окаменение', 'ослепление', 'опутанность', 'глухота', 'захват',
  'ошеломление', 'бессознательность', 'недееспособность', 'сбит с ног', 'с ног', 'ног',
  'сбивание с ног', 'сбивание', 'сбит[а-яё]* с ног', 'лежащ[а-яё]* ничком', 'ничком',
  'захвачен[а-яё]*', 'невидимость',
  // те же состояния в тексте умений: «становится испуганным?», «отравленным?»
  'испуганн[а-яё]*', 'отравленн[а-яё]*', 'очарованн[а-яё]*', 'парализованн[а-яё]*',
  'опутанн[а-яё]*', 'ошеломл[её]нн[а-яё]*', 'схваченн[а-яё]*', 'ослепл[её]нн[а-яё]*',
  'оглохш[а-яё]*', 'окаменевш[а-яё]*', 'недееспособн[а-яё]*', 'невидим[а-яё]*',
  'бессознательн[а-яё]*', 'истощени[а-яё]*'
];
const TOOLTIP_WORD_RE = new RegExp(`^(${TOOLTIP_TERMS.join('|')})$`, 'i');

function stripTooltipMarks(text) {
  return String(text || '').replace(/([А-Яа-яЁё][а-яё]*(?: с ног| ничком)?)\?(?=[\s,.;:)]|$)/g, (match, word) => (
    TOOLTIP_WORD_RE.test(word) ? word : match
  ));
}

function cleanSpaces(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

function toInt(value) {
  const n = Number(String(value ?? '').replace(/[^\d\-+]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** «1/4» → 0.25, «22» → 22, «—» → null */
function parseChallengeValue(display) {
  const s = String(display || '').trim();
  if (!s || s === '—' || s === '-') return null;
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Абзацы: разделены пустой строкой; внутри абзаца переносы сохраняем. */
function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * «Имя. Текст…» — умение или действие. Имя короткое (до 7 слов), текст
 * непустой; иначе это вводный абзац или продолжение предыдущего.
 */
function splitNamedEntry(paragraph) {
  const m = String(paragraph || '').match(/^([^.\n]{2,90}?)\.\s+([\s\S]+)$/);
  if (!m) return null;
  const name = m[1].trim();
  // Имя умения: до 5 слов до скобки, без запятых и двоеточий
  // («Легендарное сопротивление (3/день)», «Ядовитое дыхание (перезарядка 5–6)»).
  const beforeParen = name.split('(')[0].trim();
  if (!beforeParen || beforeParen.split(/\s+/).length > 5) return null;
  if (/[,:;]/.test(beforeParen)) return null;
  if (/^\d/.test(name)) return null; // «1 уровень (4 ячейки): …», «1/день каждое: …»
  return { name, text: m[2].trim() };
}

// ---------------------------------------------------------------------------
// Бестиарий
// ---------------------------------------------------------------------------

const MONSTER_SECTION_TITLES = new Map([
  ['Действия', 'actions'],
  ['Бонусные действия', 'bonusActions'],
  ['Реакции', 'reactions'],
  ['Легендарные действия', 'legendaryActions'],
  ['Мифические действия', 'mythicActions'],
  ['Логово', 'lair'],
  ['Действия логова', 'lairActions'],
  ['Местные эффекты', 'regionalEffects'],
  ['Вариантные действия', 'variantActions'],
  ['Описание', 'description']
]);

const SIZE_WORDS = /^(Крошечн|Маленьк|Средн|Больш|Огромн|Громадн)/i;

function parseMonsterHeadline(line) {
  const text = String(line || '').trim();
  const sizeMatch = text.match(/^(\S+)\s*(.*)$/);
  if (!sizeMatch || !SIZE_WORDS.test(sizeMatch[1])) {
    return { size: '', type: text, typeBase: text.split(/[\s(,]/)[0] || '', alignment: '' };
  }
  let size = sizeMatch[1];
  let rest = sizeMatch[2];
  // «Маленький или Средний Гуманоид», «Большой или меньшего размера Конструкт»
  const orMatch = rest.match(/^или\s+(\S+)\s+(.*)$/);
  if (orMatch && SIZE_WORDS.test(orMatch[1])) {
    size = `${size} или ${orMatch[1]}`;
    rest = orMatch[2];
  } else if (/^или меньшего размера\s+/i.test(rest)) {
    size = `${size} или меньше`;
    rest = rest.replace(/^или меньшего размера\s+/i, '');
  }
  const comma = rest.indexOf(',');
  const type = comma === -1 ? rest.trim() : rest.slice(0, comma).trim();
  const alignment = comma === -1 ? '' : rest.slice(comma + 1).trim();
  // «рой крошечных Зверей» → базовый тип «Рой»
  const typeBase = /^рой(\s|$)/i.test(type) ? 'Рой' : (type.split(/[\s(]/)[0] || type);
  return { size, sizeKey: normalizeSizeKey(size), type, typeBase, alignment };
}

/** «Средняя», «Большое» (род согласован с «аберрация», «растение») → «Средний», «Большой». */
function normalizeSizeKey(size) {
  return String(size || '')
    .split(/\s+или\s+/)
    .map((word) => {
      const m = word.match(/^(Крошечн|Маленьк|Средн|Больш|Огромн|Громадн)/i);
      if (!m) return word;
      const stem = m[1].toLowerCase();
      return { крошечн: 'Крошечный', маленьк: 'Маленький', средн: 'Средний', больш: 'Большой', огромн: 'Огромный', громадн: 'Громадный' }[stem];
    })
    .join(' или ');
}

function parseSpeed(raw) {
  const result = { raw: String(raw || '').trim(), walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false };
  for (const part of result.raw.split(',')) {
    const p = part.trim();
    const feet = p.match(/(\d+)\s*(?:футов|фута|фт\.?)/i);
    if (!feet) continue;
    const value = Number(feet[1]);
    if (/летая/i.test(p)) {
      result.fly = value;
      if (/парит/i.test(p)) result.hover = true;
    } else if (/плавая/i.test(p)) result.swim = value;
    else if (/лазая/i.test(p)) result.climb = value;
    else if (/копая/i.test(p)) result.burrow = value;
    else if (result.walk === null) result.walk = value;
  }
  return result;
}

const ABILITY_KEYS = { Сил: 'str', Лов: 'dex', Тел: 'con', Инт: 'int', Мдр: 'wis', Хар: 'cha' };

function parseAbilities(line) {
  const abilities = {};
  const re = /(Сил|Лов|Тел|Инт|Мдр|Хар)\s*(\d+)\s*\(\s*([+\-−–]?\s*\d+)\s*\)/g;
  let m;
  while ((m = re.exec(line))) {
    abilities[ABILITY_KEYS[m[1]]] = {
      score: Number(m[2]),
      modifier: Number(m[3].replace(/[−–]/, '-').replace(/\s/g, ''))
    };
  }
  return Object.keys(abilities).length === 6 ? abilities : (Object.keys(abilities).length ? abilities : null);
}

/** «Лов +8, Тел +14» → { Лов: 8, Тел: 14 } */
function parseBonusList(text) {
  const out = {};
  for (const part of String(text || '').split(',')) {
    const m = part.trim().match(/^(.+?)\s*([+\-−–]\s*\d+)$/);
    if (m) out[m[1].trim()] = Number(m[2].replace(/[−–]/, '-').replace(/\s/g, ''));
  }
  return out;
}

const MONSTER_LABELS = [
  ['Класс Доспеха', 'armorClass'],
  ['Хиты', 'hitPoints'],
  ['Скорость', 'speed'],
  ['Спасброски', 'savingThrows'],
  ['Навыки', 'skills'],
  ['Уязвимость к урону', 'damageVulnerabilities'],
  ['Сопротивление урону', 'damageResistances'],
  ['Сопротивление к урону', 'damageResistances'],
  ['Иммунитет к урону', 'damageImmunities'],
  ['Иммунитет к состоянию', 'conditionImmunities'],
  ['Иммунитет к состояниям', 'conditionImmunities'],
  ['Чувства', 'senses'],
  ['Языки', 'languages'],
  ['Опасность', 'challenge'],
  ['Бонус мастерства', 'proficiencyBonus'],
  ['Местность обитания', 'habitat']
];

/**
 * Статблок монстра из текста dnd.su → структура.
 * Возвращает { data, filters, summary, description }.
 */
function parseMonsterStatBlock(rawDescription) {
  const text = cleanSpaces(stripTooltipMarks(rawDescription));
  const paragraphs = splitParagraphs(text);
  const data = {
    size: '', sizeKey: '', type: '', typeBase: '', alignment: '',
    armorClass: null, armorClassNote: '', hitPoints: null, hitDice: '',
    speed: parseSpeed(''), abilities: null,
    savingThrows: {}, skills: {},
    damageVulnerabilities: '', damageResistances: '', damageImmunities: '', conditionImmunities: '',
    senses: [], passivePerception: null, languages: '',
    challenge: '', challengeValue: null, challengeNote: '', xp: null, proficiencyBonus: null, habitat: '',
    spellcasting: [],
    traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [], mythicActions: [],
    lair: '', lairActions: [], regionalEffects: '', variantActions: [],
    description: '',
    extraSections: []
  };

  if (!paragraphs.length) return { data, filters: {}, summary: '', description: '' };

  Object.assign(data, parseMonsterHeadline(paragraphs[0]));

  // 1. Строки с метками — пока не кончатся.
  let index = 1;
  for (; index < paragraphs.length; index += 1) {
    const p = paragraphs[index];
    const firstLine = p.split('\n')[0];
    if (/^Сил\s*\d/.test(firstLine)) {
      data.abilities = parseAbilities(p);
      continue;
    }
    const label = MONSTER_LABELS.find(([title]) => firstLine.startsWith(`${title} `) || firstLine === title);
    if (!label) break;
    const value = p.slice(label[0].length).trim();
    switch (label[1]) {
      case 'armorClass': {
        const m = value.match(/^(\d+)\s*(?:\((.+)\))?/);
        data.armorClass = m ? Number(m[1]) : null;
        data.armorClassNote = m && m[2] ? m[2].trim() : (m ? '' : value);
        break;
      }
      case 'hitPoints': {
        const m = value.match(/^(\d+)\s*(?:\((.+)\))?/);
        data.hitPoints = m ? Number(m[1]) : null;
        data.hitDice = m && m[2] ? m[2].trim() : '';
        break;
      }
      case 'speed': data.speed = parseSpeed(value); break;
      case 'savingThrows': data.savingThrows = parseBonusList(value); break;
      case 'skills': data.skills = parseBonusList(value); break;
      case 'senses': {
        data.senses = value.split(',').map((s) => s.trim()).filter(Boolean);
        const pp = value.match(/пассивное Восприятие\s+(\d+)/i);
        data.passivePerception = pp ? Number(pp[1]) : null;
        break;
      }
      case 'challenge': {
        // «22 (41 000 опыта)», «1/4 (50 опыта)», «—», а также с пояснениями:
        // «22 (41 000 опыта) или 23 (50 000 опыта) в логове» — берём первое значение,
        // остальное сохраняем как примечание.
        const m = value.match(/^(\d+(?:\s*\/\s*\d+)?|—|-)\s*(?:\(([\d\s]+)\s*опыта\))?\s*(.*)$/);
        data.challenge = m ? m[1].replace(/\s/g, '') : value;
        data.challengeValue = parseChallengeValue(data.challenge);
        data.xp = m && m[2] ? toInt(m[2]) : null;
        data.challengeNote = m && m[3] ? m[3].trim() : (m ? '' : value);
        break;
      }
      case 'proficiencyBonus': data.proficiencyBonus = toInt(value); break;
      default: data[label[1]] = value;
    }
  }

  // 2. Умения до первой секции, затем секции.
  let bucket = 'traits';
  let lastEntry = null;
  const textBuckets = { lair: [], regionalEffects: [], description: [] };
  let extra = null;

  for (; index < paragraphs.length; index += 1) {
    const p = paragraphs[index];
    const lines = p.split('\n');
    const head = lines[0].trim();
    const sectionKey = MONSTER_SECTION_TITLES.get(head);

    if (sectionKey) {
      bucket = sectionKey;
      lastEntry = null;
      extra = null;
      // Заголовок секции может стоять в одном абзаце с первым пунктом.
      const rest = lines.slice(1).join('\n').trim();
      if (!rest) continue;
      pushMonsterParagraph(rest);
      continue;
    }

    // Прочие заголовки («НОВЫЕ ОПЦИИ ДЛЯ ВЕЛИКАНОВ», «Фамильяры») — отдельные
    // текстовые разделы после описания.
    if (bucket === 'description' && lines.length > 1 && head.length < 60 && !/[.:;]/.test(head)) {
      extra = { title: head, text: lines.slice(1).join('\n').trim() };
      data.extraSections.push(extra);
      continue;
    }
    pushMonsterParagraph(p);
  }

  function pushMonsterParagraph(paragraph) {
    if (extra) {
      extra.text = `${extra.text}\n\n${paragraph}`.trim();
      return;
    }
    if (bucket in textBuckets) {
      textBuckets[bucket].push(paragraph);
      return;
    }
    const entry = splitNamedEntry(paragraph);
    if (entry) {
      lastEntry = entry;
      data[bucket].push(entry);
      // Списки заклинаний идут отдельными абзацами после «Использование заклинаний.»
      return;
    }
    if (lastEntry) {
      lastEntry.text = `${lastEntry.text}\n\n${paragraph}`;
      return;
    }
    // Вводный абзац секции (например, правило легендарных действий).
    const introKey = `${bucket}Intro`;
    data[introKey] = data[introKey] ? `${data[introKey]}\n\n${paragraph}` : paragraph;
  }

  data.lair = textBuckets.lair.join('\n\n');
  data.regionalEffects = textBuckets.regionalEffects.join('\n\n');
  data.description = textBuckets.description.join('\n\n');

  // Заклинания: умения «Использование заклинаний» / «Врождённое колдовство».
  data.spellcasting = [...data.traits, ...data.actions]
    .filter((e) => /заклинани|колдовств/i.test(e.name))
    .map((e) => ({ name: e.name, text: e.text }));

  const summaryParts = [];
  const headline = [data.size, data.type].filter(Boolean).join(' ');
  if (headline) summaryParts.push(data.alignment ? `${headline}, ${data.alignment}` : headline);
  if (data.challenge) summaryParts.push(`Опасность ${data.challenge}`);
  const summary = summaryParts.join(' · ');

  const filters = {
    size: data.sizeKey || data.size,
    type: data.typeBase,
    type_full: data.type,
    alignment: data.alignment,
    challenge: data.challenge,
    cr_value: data.challengeValue,
    // КД и хиты — для карточки в списке (детальная ручка отдаёт полный статблок в data)
    ac: data.armorClass,
    hp: data.hitPoints,
    habitat: data.habitat,
    legendary: data.legendaryActions.length > 0
  };

  return { data, filters, summary, description: data.description };
}

// ---------------------------------------------------------------------------
// Заклинания
// ---------------------------------------------------------------------------

const SPELL_CLASSES = ['бард', 'волшебник', 'друид', 'жрец', 'колдун', 'паладин', 'следопыт', 'чародей', 'изобретатель'];

/**
 * Для фильтра: длинные формулировки реакций («1 реакция, совершаемая вами, когда…»)
 * сводятся к «1 реакция»; остальные значения («1 действие», «10 минут») — как есть.
 */
function normalizeCastTimeKind(castTime) {
  const s = String(castTime || '').trim();
  if (/^1 реакция/i.test(s)) return '1 реакция';
  return s;
}

function parseSpellData(row, meta) {
  const levelRaw = String(row.level || '').trim();
  const level = /заговор/i.test(levelRaw) ? 0 : (toInt(levelRaw) ?? null);
  const duration = String(row.duration || '').trim();
  const components = String(row.components || '').trim();
  const materialMatch = components.match(/\(([^)]*)\)/);
  const letters = components.replace(/\(.*\)/, '');
  const classes = [];
  const classesTasha = [];
  const subclassesExtra = [];
  for (const partRaw of String(row.classes || '').split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    const tasha = /TCE$/i.test(part);
    const base = part.replace(/TCE$/i, '').trim().toLowerCase();
    if (SPELL_CLASSES.includes(base)) {
      if (tasha) classesTasha.push(base);
      else classes.push(base);
    } else {
      subclassesExtra.push(part);
    }
  }
  const subclasses = [
    ...String(row.subclasses || '').split(',').map((s) => s.trim()).filter(Boolean),
    ...subclassesExtra
  ];

  const description = String(row.description || '').trim();
  const higherIdx = description.search(/На больших уровнях\./);
  const atHigherLevels = higherIdx === -1 ? '' : description.slice(higherIdx).replace(/^На больших уровнях\.\s*/, '').trim();

  const data = {
    level,
    levelLabel: level === 0 ? 'Заговор' : `${level} уровень`,
    // Бросок заклинания для стола: кость урона/лечения, тип, атака или спасбросок, рост.
    roll: parseSpellRoll(description, level),
    school: String(row.school || '').trim(),
    castTime: String(row.cast_time || '').trim(),
    range: String(row.range || '').trim(),
    components: {
      raw: components,
      verbal: /В/.test(letters),
      somatic: /С/.test(letters),
      material: /М/.test(letters),
      materialText: materialMatch ? materialMatch[1].trim() : ''
    },
    duration,
    concentration: /^Концентрация/i.test(duration),
    ritual: meta ? Boolean(meta.ritual) : null,
    classes,
    classesTasha,
    subclasses,
    description: higherIdx === -1 ? description : description.slice(0, higherIdx).trim(),
    atHigherLevels
  };

  const allClasses = [...new Set([...classes, ...classesTasha])];
  const filters = {
    level: levelRaw,
    level_num: level,
    school: data.school,
    cast_time: data.castTime,
    cast_time_kind: normalizeCastTimeKind(data.castTime),
    range: data.range,
    components: components,
    duration,
    concentration: data.concentration,
    ritual: data.ritual,
    classes: allClasses.join(', '),
    subclasses: subclasses.join(', ')
  };

  return { data, filters };
}

// ---------------------------------------------------------------------------
// Бросок заклинания (для панели действий стола)
// ---------------------------------------------------------------------------

/** Типы урона, как их пишет dnd.su в тексте заклинаний (любой падеж) → именительный. */
const DAMAGE_TYPE_FORMS = [
  [/огн[её]м|огня\b/i, 'огонь'],
  [/холодом/i, 'холод'],
  [/электричеством/i, 'электричество'],
  [/кислотой/i, 'кислота'],
  [/ядом/i, 'яд'],
  [/некротическ[а-яё]+ энерги[а-яё]+/i, 'некротическая энергия'],
  [/излучением/i, 'излучение'],
  [/силов[а-яё]+ пол[а-яё]+/i, 'силовое поле'],
  [/психическ[а-яё]+ энерги[а-яё]+/i, 'психическая энергия'],
  [/звуком/i, 'звук'],
  [/дробящ[а-яё]+/i, 'дробящий'],
  [/колющ[а-яё]+/i, 'колющий'],
  [/рубящ[а-яё]+/i, 'рубящий']
];

const SAVE_ABILITIES = {
  Силы: 'str', Ловкости: 'dex', Телосложения: 'con', Интеллекта: 'int', Мудрости: 'wis', Харизмы: 'cha'
};

/** «8к6» / «1к4 + 1» → формула движка бросков «8d6» / «1d4+1». */
function diceToFormula(text) {
  const m = String(text || '').match(/(\d+)\s*к\s*(\d+)(?:\s*\+\s*(\d+))?/i);
  if (!m) return '';
  return `${m[1]}d${m[2]}${m[3] ? `+${m[3]}` : ''}`;
}

function detectDamageType(sentence) {
  for (const [re, canon] of DAMAGE_TYPE_FORMS) {
    if (re.test(sentence)) return canon;
  }
  return '';
}

/**
 * Что бросать при касте: из текста заклинания (dnd.su) достаём первую кость
 * урона или лечения, тип урона, нужен ли бросок атаки заклинанием или спасбросок,
 * и как растёт кость — по ячейке («…на 1к6 за каждый уровень ячейки выше третьего»)
 * или по уровню персонажа у заговоров («5-го уровня (2к10), 11-го (3к10), 17-го (4к10)»).
 * Ничего не выдумывается: если формулировки нет — поле пустое.
 */
function parseSpellRoll(descriptionRaw, level) {
  // dnd.su иногда отдаёт «ё» как «е» + диакритика (NFD) — приводим к обычной форме.
  const description = String(descriptionRaw || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!description) return null;
  const higherIdx = description.search(/На больших уровнях\./);
  const main = higherIdx === -1 ? description : description.slice(0, higherIdx);
  const higher = higherIdx === -1 ? '' : description.slice(higherIdx);
  const sentences = main.split(/(?<=[.!?])\s+/);
  const hasDice = (s) => /\d+\s*к\s*\d+/i.test(s);

  const damageSentence = sentences.find((s) => hasDice(s) && /урон/i.test(s));
  const healSentence = sentences.find((s) => hasDice(s) && /(восстанавлива|хит)/i.test(s));
  const anySentence = sentences.find(hasDice);

  let kind = null;
  let sentence = '';
  if (damageSentence) {
    kind = 'damage';
    sentence = damageSentence;
  } else if (healSentence) {
    kind = 'healing';
    sentence = healSentence;
  } else if (anySentence) {
    kind = 'other';
    sentence = anySentence;
  }

  const attackMatch = main.match(/(рукопашн[а-яё]+|дальнобойн[а-яё]+)?\s*атак[а-яё]* заклинанием/i);
  const saveMatch = main.match(/спасброс[а-яё]+ (Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)/);

  const roll = {
    kind,
    formula: sentence ? diceToFormula(sentence) : '',
    damageType: kind === 'damage' ? detectDamageType(sentence) : '',
    addsAbilityModifier: /модификатор (вашей )?базовой характеристики/i.test(sentence),
    attack: attackMatch ? (/рукопашн/i.test(attackMatch[1] || '') ? 'melee' : /дальнобойн/i.test(attackMatch[1] || '') ? 'ranged' : 'spell') : null,
    save: saveMatch ? SAVE_ABILITIES[saveMatch[1]] : null,
    perSlot: null,
    cantripScaling: null
  };

  // Рост по ячейке: «увеличивается на 1к6 за каждый уровень ячейки выше третьего»,
  // «бросайте дополнительно 1к8 за каждый уровень…», «за каждые две ячейки» → шаг 2.
  const perSlot = higher.match(/(?:на|дополнительно)\s+(\d+)\s*к\s*(\d+)\s+за\s+кажд[а-яё]+\s+(две|два)?\s*(?:уров|ячей)/i);
  if (perSlot) {
    roll.perSlot = { formula: `${perSlot[1]}d${perSlot[2]}`, step: perSlot[3] ? 2 : 1 };
  }

  // Заговоры: «когда вы достигаете 5-го уровня (2к8), 11-го уровня (3к8) и 17-го уровня (4к8)».
  if (level === 0) {
    const scaling = {};
    const re = /(\d+)(?:-го)?\s+уровня\s*\((\d+)\s*к\s*(\d+)(?:\s+или[^)]*)?\)/gi;
    let m;
    while ((m = re.exec(main)) !== null) {
      scaling[Number(m[1])] = `${m[2]}d${m[3]}`;
    }
    if (Object.keys(scaling).length) roll.cantripScaling = scaling;
  }

  if (!roll.kind && !roll.attack && !roll.save) return null;
  return roll;
}

// ---------------------------------------------------------------------------
// Инвентарь: таблицы оружия и доспехов из markdown статей dnd.su
// ---------------------------------------------------------------------------

const WEAPON_PROPERTY_KEYS = [
  [/^боеприпас/i, 'ammunition'],
  [/^боекомплект/i, 'magazine'],
  [/^двуручн/i, 'twoHanded'],
  [/^досягаемост/i, 'reach'],
  [/^л[её]гк/i, 'light'],
  [/^метательн/i, 'thrown'],
  [/^особ/i, 'special'],
  [/^перезарядк/i, 'loading'],
  [/^тяж[её]л/i, 'heavy'],
  [/^универсальн/i, 'versatile'],
  [/^фехтовальн/i, 'finesse'],
  [/^взрывн/i, 'burst'],
  [/^разрывн/i, 'burst']
];

/** Строки GFM-таблиц markdown → массив таблиц, каждая — массив строк-ячеек. */
function extractMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const tables = [];
  let current = null;
  const isRow = (l) => /^\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\|(\s*:?-+:?\s*\|)+\s*$/.test(l);
  for (const raw of lines) {
    const l = raw.trim();
    if (isRow(l)) {
      if (isSep(l)) continue;
      const cells = l.slice(1, -1).split('|').map((c) => c.trim());
      if (!current) current = [];
      current.push(cells);
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  return tables;
}

const stripMarks = (s) => String(s || '').replace(/\*\*|__|(^|\s)_|_(\s|$)/g, '$1$2').replace(/[*_]/g, '').trim();

/** Строка таблицы, где заполнена только первая ячейка — заголовок категории. */
function isCategoryRow(cells) {
  return cells.length > 1 && Boolean(cells[0]) && cells.slice(1).every((c) => !c);
}

function parseWeaponRow(cells, category) {
  const [nameRaw, cost, damageRaw, weight, propsRaw] = cells;
  const name = stripMarks(nameRaw);
  if (!name) return null;
  const damageText = stripMarks(damageRaw || '');
  const dm = damageText.match(/^(\d+\s*к\s*\d+|\d+)\s*([а-яё]+)?/i);
  const props = stripMarks(propsRaw || '');
  const properties = [];
  const propertyKeys = [];
  let versatile = '';
  let range = '';
  for (const part of props === '-' || props === '—' ? [] : props.split(/,\s*(?![^()]*\))/)) {
    const p = part.trim();
    if (!p) continue;
    properties.push(p);
    for (const [re, key] of WEAPON_PROPERTY_KEYS) {
      if (re.test(p)) propertyKeys.push(key);
    }
    const v = p.match(/универсальн[а-яё]*\s*\((\d+\s*к\s*\d+)\)/i);
    if (v) versatile = diceToFormula(v[1]);
    const r = p.match(/дис\.\s*(\d+)\s*\/\s*(\d+)/i);
    if (r) range = `${r[1]}/${r[2]}`;
  }
  const isRanged = /дальнобойн/i.test(category);
  return {
    name,
    cost: stripMarks(cost || ''),
    damage: damageText,
    damageFormula: dm ? (/к/i.test(dm[1]) ? diceToFormula(dm[1]) : dm[1]) : '',
    damageType: dm && dm[2] ? dm[2] : '',
    weight: stripMarks(weight || ''),
    properties,
    propertyKeys,
    versatileFormula: versatile,
    range,
    category,
    ranged: isRanged,
    martial: /воинск/i.test(category)
  };
}

/** Таблица «Оружие» (колонки Название / Стоимость / Урон / Вес / Свойства) → строки оружия. */
function parseWeaponTable(markdown) {
  const weapons = [];
  for (const table of extractMarkdownTables(markdown)) {
    const header = table[0].map(stripMarks);
    if (!/^(Название|Предмет)$/i.test(header[0] || '') || !/^Урон$/i.test(header[2] || '')) continue;
    let category = '';
    for (const cells of table.slice(1)) {
      if (isCategoryRow(cells)) {
        category = stripMarks(cells[0]);
        continue;
      }
      const row = parseWeaponRow(cells, category);
      if (row && (row.damageFormula || row.damage)) weapons.push(row);
    }
  }
  return weapons;
}

/** Таблица «Доспехи» (Доспех / Стоимость / Класс доспеха (КД) / Сила / Скрытность / Вес). */
function parseArmorTable(markdown) {
  const armor = [];
  for (const table of extractMarkdownTables(markdown)) {
    const header = table[0].map(stripMarks);
    if (!/^Доспех$/i.test(header[0] || '') || !/Класс доспеха/i.test(header[2] || '')) continue;
    let category = '';
    for (const cells of table.slice(1)) {
      if (isCategoryRow(cells)) {
        category = stripMarks(cells[0]);
        continue;
      }
      const name = stripMarks(cells[0]);
      if (!name) continue;
      const acText = stripMarks(cells[2] || '');
      const base = acText.match(/^\+?(\d+)/);
      const dexMax = acText.match(/макс\.\s*(\d+)/i);
      armor.push({
        name,
        cost: stripMarks(cells[1] || ''),
        ac: acText,
        acBase: base ? Number(base[1]) : null,
        acBonus: /^\+/.test(acText),
        addsDex: /ЛОВ/i.test(acText),
        dexMax: dexMax ? Number(dexMax[1]) : null,
        strength: stripMarks(cells[3] || '').replace(/^[-—]$/, ''),
        stealthDisadvantage: /помеха/i.test(cells[4] || ''),
        weight: stripMarks(cells[5] || ''),
        category
      });
    }
  }
  return armor;
}

/** Машиночитаемые данные статьи инвентаря по её слагу dnd.su. */
function parseInventoryData(slug, markdown) {
  const data = {};
  const weapons = parseWeaponTable(markdown);
  if (weapons.length) data.weapons = weapons;
  const armor = parseArmorTable(markdown);
  if (armor.length) data.armor = armor;
  data.kind = /arms|weapon|firearm/i.test(slug) ? 'weapons' : /armor/i.test(slug) ? 'armor' : 'article';
  return data;
}

// ---------------------------------------------------------------------------
// Магические предметы
// ---------------------------------------------------------------------------

const ITEM_TYPES = ['Чудесный предмет', 'Оружие', 'Доспех', 'Кольцо', 'Волшебная палочка', 'Зелье', 'Посох', 'Жезл', 'Свиток'];
// Порядок важен: «очень редкий» раньше «редкий», «необычный» раньше «обычный».
const RARITY_CANON = [
  [/варьируется|зависит/i, 'варьируется'],
  [/очень\s+редк/i, 'очень редкий'],
  [/необычн/i, 'необычный'],
  [/редк/i, 'редкий'],
  [/легендарн/i, 'легендарный'],
  [/артефакт/i, 'артефакт'],
  [/обычн/i, 'обычный']
];

/** Строка «Название [English]КОДЫ» в начале статьи. Коды книг — заглавные латиница/цифры. */
function parseItemHeader(line) {
  const m = String(line || '').trim().match(/^(.+?)\s*\[([^\]]+)\]\s*([A-Z0-9:\-\s]*)$/);
  if (!m) return null;
  return {
    nameRu: m[1].trim(),
    nameEn: m[2].trim(),
    codes: m[3].trim().split(/\s+/).filter(Boolean)
  };
}

function parseItemData(rawDescription, rowName, rowNameEn) {
  const lines = cleanSpaces(rawDescription).split('\n').map((l) => l.trim());
  let header = null;
  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 8); i += 1) {
    const h = parseItemHeader(lines[i]);
    if (h && /[А-Яа-яЁё]/.test(h.nameRu)) {
      header = h;
      headerIndex = i;
      break;
    }
  }

  const bodyLines = lines.slice(headerIndex + 1).filter((l, i, arr) => !(l === '' && arr[i - 1] === ''));
  // Служебная шапка dnd.su, если заголовок не найден
  while (bodyLines.length && /^Официальные материалы/i.test(bodyLines[0])) bodyLines.shift();

  let typeLine = '';
  let typeIndex = -1;
  for (let i = 0; i < Math.min(bodyLines.length, 6); i += 1) {
    const l = bodyLines[i];
    if (!l) continue;
    // Строка типа: «Кольцо, редкое (требуется настройка)»; у части предметов — просто «Чудесный предмет».
    if (ITEM_TYPES.some((t) => l.startsWith(t)) && l.length < 120
      && (/(обычн|редк|легендарн|артефакт|варьируется)/i.test(l) || l.includes(',') || ITEM_TYPES.includes(l) || /^[^.]*\([^)]*\)$/.test(l))) {
      typeLine = l;
      typeIndex = i;
      break;
    }
  }

  const typeBase = ITEM_TYPES.find((t) => typeLine.startsWith(t)) || '';
  const afterType = typeLine.slice(typeBase.length).trim();
  const subtypeMatch = afterType.match(/^\(([^)]*)\)/);
  const subtype = subtypeMatch ? subtypeMatch[1].trim() : '';
  const rarityPart = afterType.replace(/^\([^)]*\)/, '').replace(/^,\s*/, '');
  let rarity = '';
  for (const [re, canon] of RARITY_CANON) {
    if (re.test(rarityPart)) { rarity = canon; break; }
  }
  const attunementMatch = rarityPart.match(/\(([^)]*настройк[^)]*)\)/i);

  let cost = '';
  const body = [];
  for (let i = 0; i < bodyLines.length; i += 1) {
    if (i === typeIndex) continue;
    const l = bodyLines[i];
    const costMatch = l.match(/^Рекомендованная стоимость:\s*(.+)$/i);
    if (costMatch && !cost) { cost = costMatch[1].trim(); continue; }
    body.push(l);
  }
  const bodyText = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const data = {
    nameRu: header?.nameRu || String(rowName || ''),
    nameEn: header?.nameEn || String(rowNameEn || ''),
    sourceCodes: header?.codes || [],
    type: typeBase,
    subtype,
    typeLine,
    rarity,
    rarityRaw: rarityPart.trim(),
    attunement: Boolean(attunementMatch),
    attunementNote: attunementMatch ? attunementMatch[1].trim() : '',
    cost,
    description: bodyText
  };

  const filters = {
    item_type: typeBase,
    item_subtype: subtype,
    rarity,
    attunement: data.attunement
  };

  return { data, filters, description: bodyText };
}

// ---------------------------------------------------------------------------
// Черты, расы, предыстории (markdown dnd.su)
// ---------------------------------------------------------------------------

/** Убирает первые строки «## Название [English]» и «**Источник:** …» — они уже в шапке страницы. */
function stripMarkdownTitle(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && /^##\s/.test(lines[i].trim())) i += 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && /^\*{0,2}Источник:?\*{0,2}/i.test(lines[i].trim())) i += 1;
  return lines.slice(i).join('\n').trim();
}

function firstPlainParagraph(md) {
  for (const p of splitParagraphs(md)) {
    const t = p.replace(/\n/g, ' ').trim();
    if (/^#{1,6}\s/.test(t) || /^[>*|+-]/.test(t) || /^\d+[.)]\s/.test(t)) continue;
    if (/^Требование:/i.test(t) || /^\*{0,2}Источник/i.test(t) || /^Распечатать$/i.test(t)) continue;
    return t.replace(/\*\*|`|\\([[\]])/g, '$1');
  }
  return '';
}

function parseFeatData(md) {
  const withPrereq = stripMarkdownTitle(md);
  const lines = withPrereq.split('\n');
  const prereqIndex = lines.findIndex((l) => /^Требование:/i.test(l.trim()));
  const prerequisite = prereqIndex === -1 ? '' : lines[prereqIndex].trim().replace(/^Требование:\s*/i, '').trim();
  // Требование показывается отдельным полем — из текста убираем, чтобы не дублировать.
  const body = (prereqIndex === -1 ? lines : lines.filter((_, i) => i !== prereqIndex)).join('\n').trim();
  const data = { prerequisite, description: body };
  return { data, filters: { prerequisite, has_prerequisite: Boolean(prerequisite) }, summary: firstPlainParagraph(body) };
}

function parseRaceData(md) {
  const body = stripMarkdownTitle(md);
  const sizeMatch = body.match(/Размер\.\s*([^\n]+)/);
  const speedMatch = body.match(/Скорость\.\s*([^\n]+)/);
  const sizeText = sizeMatch ? sizeMatch[1].trim() : '';
  const speedText = speedMatch ? speedMatch[1].trim() : '';
  const sizes = [];
  for (const s of ['Крошечный', 'Маленький', 'Средний', 'Большой']) {
    if (new RegExp(s, 'i').test(sizeText)) sizes.push(s);
  }
  const speedFeet = speedText.match(/(\d+)\s*фут/);
  const data = {
    sizeText,
    sizes,
    speedText,
    speedFeet: speedFeet ? Number(speedFeet[1]) : null,
    description: body
  };
  return {
    data,
    filters: { size: sizes.join(' или '), speed: speedFeet ? `${speedFeet[1]} футов` : '' },
    summary: firstPlainParagraph(body)
  };
}

function parseBackgroundData(md) {
  const body = stripMarkdownTitle(md);
  const pick = (label) => {
    const m = body.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
    return m ? m[1].trim().replace(/[.;]\s*$/, '') : '';
  };
  const skills = pick('Владение навыками');
  const tools = pick('Владение инструментами');
  const languages = pick('Владение языками');
  const data = {
    skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
    tools,
    languages,
    description: body
  };
  return {
    data,
    filters: { skills, tools, languages },
    summary: firstPlainParagraph(body)
  };
}

module.exports = {
  stripTooltipMarks,
  parseChallengeValue,
  splitNamedEntry,
  parseMonsterHeadline,
  parseSpeed,
  parseAbilities,
  parseMonsterStatBlock,
  parseSpellData,
  parseSpellRoll,
  diceToFormula,
  extractMarkdownTables,
  parseWeaponTable,
  parseArmorTable,
  parseInventoryData,
  parseItemHeader,
  parseItemData,
  stripMarkdownTitle,
  firstPlainParagraph,
  parseFeatData,
  parseRaceData,
  parseBackgroundData
};
