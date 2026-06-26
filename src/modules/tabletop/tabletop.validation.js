const { randomUUID } = require('crypto');

const LIMITS = {
  maxTokens: 100,
  maxTemplates: 50,
  maxFogRevealed: 300,
  maxInitiativeEntries: 100,
  maxMeasurePoints: 50,
  maxSceneNameLength: 80,
  maxTokenLabelLength: 80,
  maxShortTextLength: 80
};

const DEFAULT_STATE = {
  mapUrl: null,
  mapSize: { w: 2400, h: 1600 },
  grid: { enabled: false, cellPx: 70, offsetX: 0, offsetY: 0 },
  tokens: [],
  templates: [],
  measure: { active: false, points: [] },
  initiative: { active: false, round: 1, turnIndex: 0, entries: [] },
  gmNotes: [],
  fog: { revealed: [] }
};

const FORBIDDEN_STATE_KEYS = new Set([
  'gmNotes',
  'hidden',
  'visibility',
  'ownerUserId',
  'characterId',
  'version',
  'id',
  'createdAt',
  'updatedAt'
]);

const FORBIDDEN_PLAYER_KEYS = new Set([
  'draftState',
  'gmNotes',
  'hidden',
  'visibility',
  'ownerUserId',
  'characterId',
  'serverPrivate',
  'serverControlled',
  'createdAt',
  'updatedAt'
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultState() {
  return cloneJson(DEFAULT_STATE);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, fieldName) {
  if (!isPlainObject(value)) {
    throw createHttpError(400, `${fieldName} must be an object`);
  }
}

function assertKnownKeys(value, allowedKeys, fieldName) {
  assertPlainObject(value, fieldName);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw createHttpError(400, `Unknown field: ${fieldName}.${key}`);
    }
  }
}

function assertNoForbiddenKeys(value, fieldName = 'patch') {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForbiddenKeys(item, fieldName));
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_STATE_KEYS.has(key)) {
      throw createHttpError(400, `Forbidden field: ${fieldName}.${key}`);
    }
    assertNoForbiddenKeys(nestedValue, `${fieldName}.${key}`);
  }
}

function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizePlainText(value, options = {}) {
  const {
    fieldName = 'text',
    maxLength = LIMITS.maxShortTextLength,
    required = true,
    fallback = ''
  } = options;

  if (value === null || typeof value === 'undefined') {
    if (!required) return fallback || null;
    throw createHttpError(400, `${fieldName} is required`);
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, `${fieldName} must be a string`);
  }

  const text = value.trim();
  if (!text && required) {
    throw createHttpError(400, `${fieldName} is required`);
  }
  if (hasControlChars(text)) {
    throw createHttpError(400, `${fieldName} contains control characters`);
  }
  if (text.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long`);
  }

  return text || fallback || null;
}

function normalizeSceneName(value) {
  return normalizePlainText(value, {
    fieldName: 'Scene name',
    maxLength: LIMITS.maxSceneNameLength
  });
}

function normalizeTokenLabel(value, fallback = 'Token') {
  return normalizePlainText(value ?? fallback, {
    fieldName: 'Token label',
    maxLength: LIMITS.maxTokenLabelLength
  });
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw createHttpError(400, `${fieldName} must be a boolean`);
  }
  return value;
}

function clampNumber(value, options = {}) {
  const {
    fieldName = 'number',
    min = -100000,
    max = 100000,
    integer = true,
    fallback
  } = options;
  const raw = value === null || typeof value === 'undefined' ? fallback : value;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    throw createHttpError(400, `${fieldName} must be a finite number`);
  }

  const clamped = Math.min(Math.max(number, min), max);
  return integer ? Math.round(clamped) : clamped;
}

function optionalClampedNumber(value, options = {}) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  return clampNumber(value, options);
}

function clampStoredNumber(value, fallback, min = -100000, max = 100000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(Math.max(number, min), max));
}

function normalizeOptionalStoredText(value, fallback = null, maxLength = LIMITS.maxShortTextLength) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text || hasControlChars(text)) return fallback;
  return text.slice(0, maxLength);
}

function normalizePoint(value, fieldName = 'point') {
  assertKnownKeys(value, ['x', 'y'], fieldName);
  return {
    x: clampNumber(value.x, { fieldName: `${fieldName}.x` }),
    y: clampNumber(value.y, { fieldName: `${fieldName}.y` })
  };
}

function normalizePointArray(value, fieldName, maxLength) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, `${fieldName} must be an array`);
  }
  if (value.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long`);
  }
  return value.map((item, index) => normalizePoint(item, `${fieldName}[${index}]`));
}

function normalizeStoredPointArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxLength).map((item) => {
    const source = isPlainObject(item) ? item : {};
    return {
      x: clampStoredNumber(source.x, 0),
      y: clampStoredNumber(source.y, 0)
    };
  });
}

function normalizeTemplate(value, fieldName = 'template') {
  assertKnownKeys(value, ['type', 'label', 'x', 'y', 'w', 'h', 'r', 'color'], fieldName);
  const template = {
    type: normalizePlainText(value.type ?? 'area', {
      fieldName: `${fieldName}.type`,
      maxLength: 40
    }),
    x: clampNumber(value.x, { fieldName: `${fieldName}.x` }),
    y: clampNumber(value.y, { fieldName: `${fieldName}.y` })
  };

  if (Object.prototype.hasOwnProperty.call(value, 'label')) {
    template.label = normalizePlainText(value.label, {
      fieldName: `${fieldName}.label`,
      maxLength: LIMITS.maxShortTextLength,
      required: false,
      fallback: null
    });
  }

  for (const key of ['w', 'h', 'r']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      template[key] = clampNumber(value[key], {
        fieldName: `${fieldName}.${key}`,
        min: 0,
        max: 100000
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'color')) {
    template.color = normalizePlainText(value.color, {
      fieldName: `${fieldName}.color`,
      maxLength: 40,
      required: false,
      fallback: null
    });
  }

  return template;
}

function normalizeTemplateArray(value) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, 'templates must be an array');
  }
  if (value.length > LIMITS.maxTemplates) {
    throw createHttpError(400, 'templates is too long');
  }
  return value.map((item, index) => normalizeTemplate(item, `templates[${index}]`));
}

function normalizeFogCircle(value, fieldName = 'fog.revealed[]') {
  assertKnownKeys(value, ['x', 'y', 'r'], fieldName);
  return {
    x: clampNumber(value.x, { fieldName: `${fieldName}.x` }),
    y: clampNumber(value.y, { fieldName: `${fieldName}.y` }),
    r: clampNumber(value.r, { fieldName: `${fieldName}.r`, min: 0, max: 100000 })
  };
}

function normalizeFogRevealed(value) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, 'fog.revealed must be an array');
  }
  if (value.length > LIMITS.maxFogRevealed) {
    throw createHttpError(400, 'fog.revealed is too long');
  }
  return value.map((item, index) => normalizeFogCircle(item, `fog.revealed[${index}]`));
}

function normalizeInitiativeEntry(value, fieldName = 'initiative.entries[]') {
  assertKnownKeys(value, ['tokenId', 'label', 'initiative', 'hpCurrent', 'hpMax'], fieldName);
  const entry = {
    label: normalizePlainText(value.label ?? 'Entry', {
      fieldName: `${fieldName}.label`,
      maxLength: LIMITS.maxShortTextLength
    }),
    initiative: clampNumber(value.initiative ?? 0, {
      fieldName: `${fieldName}.initiative`,
      min: -100,
      max: 100
    })
  };

  if (Object.prototype.hasOwnProperty.call(value, 'tokenId')) {
    entry.tokenId = normalizePlainText(value.tokenId, {
      fieldName: `${fieldName}.tokenId`,
      maxLength: LIMITS.maxShortTextLength,
      required: false,
      fallback: null
    });
  }

  for (const key of ['hpCurrent', 'hpMax']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      entry[key] = optionalClampedNumber(value[key], {
        fieldName: `${fieldName}.${key}`,
        min: 0,
        max: 100000
      });
    }
  }

  return entry;
}

function normalizeInitiativeEntries(value) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, 'initiative.entries must be an array');
  }
  if (value.length > LIMITS.maxInitiativeEntries) {
    throw createHttpError(400, 'initiative.entries is too long');
  }
  return value.map((item, index) => normalizeInitiativeEntry(item, `initiative.entries[${index}]`));
}

function normalizeNewToken(value, generateId = randomUUID) {
  assertKnownKeys(
    value,
    ['id', 'label', 'x', 'y', 'size', 'kind', 'hpCurrent', 'hpMax'],
    'token'
  );

  const token = {
    id: typeof value.id === 'string' && value.id.trim()
      ? normalizePlainText(value.id, { fieldName: 'token.id', maxLength: 120 })
      : generateId(),
    label: normalizeTokenLabel(value.label),
    x: clampNumber(value.x, { fieldName: 'token.x' }),
    y: clampNumber(value.y, { fieldName: 'token.y' }),
    size: clampNumber(value.size ?? 44, { fieldName: 'token.size', min: 1, max: 1000 }),
    kind: normalizePlainText(value.kind ?? 'creature', {
      fieldName: 'token.kind',
      maxLength: 40
    })
  };

  if (Object.prototype.hasOwnProperty.call(value, 'hpCurrent')) {
    token.hpCurrent = optionalClampedNumber(value.hpCurrent, {
      fieldName: 'token.hpCurrent',
      min: 0,
      max: 100000
    });
  }

  if (Object.prototype.hasOwnProperty.call(value, 'hpMax')) {
    token.hpMax = optionalClampedNumber(value.hpMax, {
      fieldName: 'token.hpMax',
      min: 0,
      max: 100000
    });
  }

  return token;
}

function normalizeStoredToken(value, generateId = randomUUID) {
  const source = isPlainObject(value) ? value : {};
  const token = {
    id: normalizeOptionalStoredText(source.id, generateId(), 120),
    label: normalizeOptionalStoredText(source.label, 'Token', LIMITS.maxTokenLabelLength),
    x: clampStoredNumber(source.x, 0),
    y: clampStoredNumber(source.y, 0),
    size: clampStoredNumber(source.size, 44, 1, 1000),
    kind: normalizeOptionalStoredText(source.kind, 'creature', 40)
  };

  if (source.hpCurrent !== null && typeof source.hpCurrent !== 'undefined') {
    token.hpCurrent = clampStoredNumber(source.hpCurrent, 0, 0, 100000);
  }
  if (source.hpMax !== null && typeof source.hpMax !== 'undefined') {
    token.hpMax = clampStoredNumber(source.hpMax, 0, 0, 100000);
  }
  if (source.hidden === true) {
    token.hidden = true;
  }
  if (typeof source.visibility === 'string') {
    token.visibility = source.visibility.trim();
  }
  if (Array.isArray(source.gmNotes)) {
    token.gmNotes = source.gmNotes
      .map((item) => normalizeOptionalStoredText(item, null, 500))
      .filter(Boolean);
  }

  return token;
}

function normalizeStoredTemplate(value) {
  const source = isPlainObject(value) ? value : {};
  const template = {
    type: normalizeOptionalStoredText(source.type, 'area', 40),
    x: clampStoredNumber(source.x, 0),
    y: clampStoredNumber(source.y, 0)
  };

  for (const key of ['w', 'h', 'r']) {
    if (source[key] !== null && typeof source[key] !== 'undefined') {
      template[key] = clampStoredNumber(source[key], 0, 0, 100000);
    }
  }
  if (typeof source.label === 'string') {
    template.label = normalizeOptionalStoredText(source.label, null, LIMITS.maxShortTextLength);
  }
  if (typeof source.color === 'string') {
    template.color = normalizeOptionalStoredText(source.color, null, 40);
  }

  return template;
}

function normalizeStoredFogRevealed(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.maxFogRevealed).map((item) => {
    const source = isPlainObject(item) ? item : {};
    return {
      x: clampStoredNumber(source.x, 0),
      y: clampStoredNumber(source.y, 0),
      r: clampStoredNumber(source.r, 0, 0, 100000)
    };
  });
}

function normalizeStoredInitiativeEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.maxInitiativeEntries).map((item) => {
    const source = isPlainObject(item) ? item : {};
    const entry = {
      label: normalizeOptionalStoredText(source.label, 'Entry', LIMITS.maxShortTextLength),
      initiative: clampStoredNumber(source.initiative, 0, -100, 100)
    };

    if (typeof source.tokenId === 'string') {
      entry.tokenId = normalizeOptionalStoredText(source.tokenId, null, LIMITS.maxShortTextLength);
    }
    for (const key of ['hpCurrent', 'hpMax']) {
      if (source[key] !== null && typeof source[key] !== 'undefined') {
        entry[key] = clampStoredNumber(source[key], 0, 0, 100000);
      }
    }

    return entry;
  });
}

function normalizeSceneState(value) {
  const source = isPlainObject(value) ? value : {};
  const state = createDefaultState();

  state.mapUrl = typeof source.mapUrl === 'string' && source.mapUrl.trim()
    ? source.mapUrl.trim().slice(0, 2048)
    : null;

  if (isPlainObject(source.mapSize)) {
    state.mapSize = {
      w: clampStoredNumber(source.mapSize.w, DEFAULT_STATE.mapSize.w, 1, 100000),
      h: clampStoredNumber(source.mapSize.h, DEFAULT_STATE.mapSize.h, 1, 100000)
    };
  }
  if (isPlainObject(source.grid)) {
    state.grid = {
      enabled: source.grid.enabled === true,
      cellPx: clampStoredNumber(source.grid.cellPx, DEFAULT_STATE.grid.cellPx, 1, 1000),
      offsetX: clampStoredNumber(source.grid.offsetX, 0),
      offsetY: clampStoredNumber(source.grid.offsetY, 0)
    };
  }
  if (Array.isArray(source.tokens)) {
    state.tokens = source.tokens.slice(0, LIMITS.maxTokens).map((token) => normalizeStoredToken(token));
  }
  if (Array.isArray(source.templates)) {
    state.templates = source.templates
      .slice(0, LIMITS.maxTemplates)
      .map((template) => normalizeStoredTemplate(template));
  }
  if (isPlainObject(source.measure)) {
    state.measure = {
      active: source.measure.active === true,
      points: normalizeStoredPointArray(source.measure.points, LIMITS.maxMeasurePoints)
    };
  }
  if (isPlainObject(source.initiative)) {
    state.initiative = {
      active: source.initiative.active === true,
      round: clampStoredNumber(source.initiative.round, 1, 1, 10000),
      turnIndex: clampStoredNumber(source.initiative.turnIndex, 0, 0, LIMITS.maxInitiativeEntries),
      entries: normalizeStoredInitiativeEntries(source.initiative.entries)
    };
  }
  if (Array.isArray(source.gmNotes)) {
    state.gmNotes = source.gmNotes
      .map((item) => normalizeOptionalStoredText(item, null, 500))
      .filter(Boolean)
      .slice(0, 100);
  }
  if (isPlainObject(source.fog)) {
    state.fog = {
      revealed: normalizeStoredFogRevealed(source.fog.revealed)
    };
  }

  return state;
}

function applyTokensAdd(state, patch, options) {
  assertKnownKeys(patch, ['type', 'token'], 'patch');
  assertPlainObject(patch.token, 'patch.token');

  if (state.tokens.length >= LIMITS.maxTokens) {
    throw createHttpError(400, 'Token limit exceeded');
  }

  const token = normalizeNewToken(patch.token, options.generateId);
  if (state.tokens.some((item) => item.id === token.id)) {
    throw createHttpError(409, 'Token already exists');
  }

  return { ...state, tokens: [...state.tokens, token] };
}

function applyTokensUpdate(state, patch) {
  assertKnownKeys(patch, ['type', 'tokenId', 'changes'], 'patch');
  const tokenId = normalizePlainText(patch.tokenId, {
    fieldName: 'patch.tokenId',
    maxLength: 120
  });
  assertKnownKeys(patch.changes, ['x', 'y', 'size', 'label', 'hpCurrent', 'hpMax'], 'patch.changes');

  const tokenIndex = state.tokens.findIndex((token) => token.id === tokenId);
  if (tokenIndex === -1) {
    throw createHttpError(404, 'Token not found');
  }

  const changes = {};
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'x')) {
    changes.x = clampNumber(patch.changes.x, { fieldName: 'patch.changes.x' });
  }
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'y')) {
    changes.y = clampNumber(patch.changes.y, { fieldName: 'patch.changes.y' });
  }
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'size')) {
    changes.size = clampNumber(patch.changes.size, {
      fieldName: 'patch.changes.size',
      min: 1,
      max: 1000
    });
  }
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'label')) {
    changes.label = normalizeTokenLabel(patch.changes.label);
  }
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'hpCurrent')) {
    changes.hpCurrent = optionalClampedNumber(patch.changes.hpCurrent, {
      fieldName: 'patch.changes.hpCurrent',
      min: 0,
      max: 100000
    });
  }
  if (Object.prototype.hasOwnProperty.call(patch.changes, 'hpMax')) {
    changes.hpMax = optionalClampedNumber(patch.changes.hpMax, {
      fieldName: 'patch.changes.hpMax',
      min: 0,
      max: 100000
    });
  }

  const tokens = state.tokens.slice();
  tokens[tokenIndex] = { ...tokens[tokenIndex], ...changes };
  return { ...state, tokens };
}

function applyTokensDelete(state, patch) {
  assertKnownKeys(patch, ['type', 'tokenId'], 'patch');
  const tokenId = normalizePlainText(patch.tokenId, {
    fieldName: 'patch.tokenId',
    maxLength: 120
  });
  const tokens = state.tokens.filter((token) => token.id !== tokenId);
  if (tokens.length === state.tokens.length) {
    throw createHttpError(404, 'Token not found');
  }

  return { ...state, tokens };
}

function applyStateMerge(state, patch) {
  assertKnownKeys(patch, ['type', 'changes'], 'patch');
  assertNoForbiddenKeys(patch.changes, 'patch.changes');
  assertKnownKeys(patch.changes, ['grid', 'measure', 'templates', 'fog', 'initiative'], 'patch.changes');

  const nextState = cloneJson(state);

  if (Object.prototype.hasOwnProperty.call(patch.changes, 'grid')) {
    assertKnownKeys(patch.changes.grid, ['enabled', 'cellPx', 'offsetX', 'offsetY'], 'patch.changes.grid');
    nextState.grid = { ...nextState.grid };
    if (Object.prototype.hasOwnProperty.call(patch.changes.grid, 'enabled')) {
      nextState.grid.enabled = normalizeBoolean(patch.changes.grid.enabled, 'grid.enabled');
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.grid, 'cellPx')) {
      nextState.grid.cellPx = clampNumber(patch.changes.grid.cellPx, {
        fieldName: 'grid.cellPx',
        min: 1,
        max: 1000
      });
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.grid, 'offsetX')) {
      nextState.grid.offsetX = clampNumber(patch.changes.grid.offsetX, { fieldName: 'grid.offsetX' });
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.grid, 'offsetY')) {
      nextState.grid.offsetY = clampNumber(patch.changes.grid.offsetY, { fieldName: 'grid.offsetY' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch.changes, 'measure')) {
    assertKnownKeys(patch.changes.measure, ['active', 'points'], 'patch.changes.measure');
    nextState.measure = { ...nextState.measure };
    if (Object.prototype.hasOwnProperty.call(patch.changes.measure, 'active')) {
      nextState.measure.active = normalizeBoolean(patch.changes.measure.active, 'measure.active');
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.measure, 'points')) {
      nextState.measure.points = normalizePointArray(
        patch.changes.measure.points,
        'measure.points',
        LIMITS.maxMeasurePoints
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch.changes, 'templates')) {
    nextState.templates = normalizeTemplateArray(patch.changes.templates);
  }

  if (Object.prototype.hasOwnProperty.call(patch.changes, 'fog')) {
    assertKnownKeys(patch.changes.fog, ['revealed'], 'patch.changes.fog');
    nextState.fog = { ...nextState.fog };
    if (Object.prototype.hasOwnProperty.call(patch.changes.fog, 'revealed')) {
      nextState.fog.revealed = normalizeFogRevealed(patch.changes.fog.revealed);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch.changes, 'initiative')) {
    assertKnownKeys(
      patch.changes.initiative,
      ['active', 'round', 'turnIndex', 'entries'],
      'patch.changes.initiative'
    );
    nextState.initiative = { ...nextState.initiative };
    if (Object.prototype.hasOwnProperty.call(patch.changes.initiative, 'active')) {
      nextState.initiative.active = normalizeBoolean(patch.changes.initiative.active, 'initiative.active');
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.initiative, 'round')) {
      nextState.initiative.round = clampNumber(patch.changes.initiative.round, {
        fieldName: 'initiative.round',
        min: 1,
        max: 10000
      });
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.initiative, 'turnIndex')) {
      nextState.initiative.turnIndex = clampNumber(patch.changes.initiative.turnIndex, {
        fieldName: 'initiative.turnIndex',
        min: 0,
        max: LIMITS.maxInitiativeEntries
      });
    }
    if (Object.prototype.hasOwnProperty.call(patch.changes.initiative, 'entries')) {
      nextState.initiative.entries = normalizeInitiativeEntries(patch.changes.initiative.entries);
    }
  }

  return nextState;
}

function applyScenePatch(state, patch, options = {}) {
  const normalizedState = normalizeSceneState(state);
  assertPlainObject(patch, 'patch');

  if (patch.type === 'tokens.add') {
    return applyTokensAdd(normalizedState, patch, options);
  }
  if (patch.type === 'tokens.update') {
    return applyTokensUpdate(normalizedState, patch);
  }
  if (patch.type === 'tokens.delete') {
    return applyTokensDelete(normalizedState, patch);
  }
  if (patch.type === 'state.merge') {
    return applyStateMerge(normalizedState, patch);
  }

  throw createHttpError(400, 'Invalid patch type');
}

function redactObjectForPlayer(value) {
  if (Array.isArray(value)) {
    return value.map(redactObjectForPlayer);
  }
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((result, [key, nestedValue]) => {
    if (FORBIDDEN_PLAYER_KEYS.has(key)) {
      return result;
    }
    result[key] = redactObjectForPlayer(nestedValue);
    return result;
  }, {});
}

function redactStateForPlayer(state) {
  const normalizedState = normalizeSceneState(state);
  const redacted = redactObjectForPlayer(normalizedState);

  redacted.tokens = normalizedState.tokens
    .filter((token) => token.hidden !== true && token.visibility !== 'gm')
    .map((token) => redactObjectForPlayer(token));
  delete redacted.gmNotes;

  return redacted;
}

function normalizePatchTarget(value) {
  if (value !== 'draft') {
    throw createHttpError(400, 'Invalid patch target');
  }
  return value;
}

function normalizeBaseVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw createHttpError(400, 'baseVersion is required');
  }
  return version;
}

module.exports = {
  LIMITS,
  createDefaultState,
  createHttpError,
  normalizeSceneName,
  normalizeSceneState,
  normalizePatchTarget,
  normalizeBaseVersion,
  applyScenePatch,
  redactStateForPlayer
};
