/**
 * T6.1: серверный движок бросков.
 * Клиентскому результату доверять нельзя — формула пересчитывается здесь,
 * криптографически стойким генератором (crypto.randomInt).
 *
 * Поддерживаемые формулы — как в клиентском js/dice-engine.js: "2d6+3", "1d8+2+1d4".
 */
const crypto = require('crypto');

const MAX_FORMULA_LENGTH = 60;
const MAX_DICE_PER_TERM = 20;
const MAX_SIDES = 1000;
const MAX_TERMS = 10;

function rollDie(sides) {
  const n = Math.max(2, Math.min(MAX_SIDES, Math.floor(Number(sides) || 0)));
  return crypto.randomInt(1, n + 1);
}

/**
 * Разбор и бросок формулы. Возвращает { formula, terms, rolls, total, detail }
 * или бросает Error с statusCode=400 на мусорной формуле.
 */
function rollFormula(formula) {
  const raw = String(formula || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!raw || raw.length > MAX_FORMULA_LENGTH) {
    throw invalidFormula();
  }
  if (!/^[0-9d+-]+$/.test(raw)) {
    throw invalidFormula();
  }

  const terms = [];
  let i = 0;
  let sign = 1;
  let expectTerm = true;

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '+' || ch === '-') {
      if (expectTerm && terms.length > 0) {
        throw invalidFormula();
      }
      sign = ch === '-' ? -1 : 1;
      expectTerm = true;
      i += 1;
      continue;
    }

    const diceMatch = raw.slice(i).match(/^(\d*)d(\d+)/);
    if (diceMatch) {
      const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1;
      const sides = parseInt(diceMatch[2], 10);
      if (count < 1 || count > MAX_DICE_PER_TERM || sides < 2 || sides > MAX_SIDES) {
        throw invalidFormula();
      }
      const rolls = [];
      let sum = 0;
      for (let k = 0; k < count; k += 1) {
        const r = rollDie(sides);
        rolls.push(r);
        sum += r;
      }
      terms.push({ kind: 'dice', sign, count, sides, rolls, sum: sign * sum });
      expectTerm = false;
      i += diceMatch[0].length;
      continue;
    }

    const numMatch = raw.slice(i).match(/^(\d+)/);
    if (numMatch) {
      const value = parseInt(numMatch[1], 10);
      if (!Number.isFinite(value) || value > 10000) {
        throw invalidFormula();
      }
      terms.push({ kind: 'mod', value: sign * value });
      expectTerm = false;
      i += numMatch[0].length;
      continue;
    }

    throw invalidFormula();
  }

  if (terms.length === 0 || terms.length > MAX_TERMS || expectTerm) {
    throw invalidFormula();
  }
  if (!terms.some((t) => t.kind === 'dice')) {
    throw invalidFormula();
  }

  let total = 0;
  const detailParts = [];
  for (const t of terms) {
    if (t.kind === 'mod') {
      total += t.value;
      if (t.value !== 0) {
        detailParts.push(t.value > 0 ? `+${t.value}` : `${t.value}`);
      }
    } else {
      total += t.sum;
      const prefix = t.sign < 0 ? '-' : '+';
      detailParts.push(`${prefix}${t.count}d${t.sides}[${t.rolls.join(',')}]`);
    }
  }

  return {
    formula: raw,
    terms,
    total,
    detail: detailParts.join(' ').replace(/^\+\s*/, '') || '0'
  };
}

function invalidFormula() {
  const error = new Error('Invalid dice formula');
  error.statusCode = 400;
  return error;
}

module.exports = {
  rollDie,
  rollFormula,
  MAX_FORMULA_LENGTH
};
