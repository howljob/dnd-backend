const pool = require('../../db/pool');
const { recordActivityEvent } = require('../community/community-activity.service');

const ALLOWED_LANGUAGES = ['ru', 'en'];
const ALLOWED_PLAYER_LEVELS = ['beginner', 'intermediate', 'advanced'];
const ALLOWED_FORMATS = ['online', 'offline'];
const ALLOWED_CREATOR_ROLES = ['player', 'gm'];
const LEGACY_DEFAULT_CREATOR_ROLE = 'gm';
const UPDATABLE_FIELDS = [
  'title',
  'gameTypeId',
  'description',
  'startsAt',
  'maxPlayers',
  'language',
  'playerLevel',
  'isPaid',
  'priceAmount',
  'format',
  'location',
  'statusId'
];

const GAME_SELECT_BASE = `
  SELECT
    g.id,
    g.title,
    g.description,
    g.starts_at,
    g.max_players,
    g.language,
    g.player_level,
    g.is_paid,
    g.price_amount,
    g.format,
    g.location,
    g.created_at,
    g.updated_at,
    creator.id AS creator_id,
    creator.display_name AS creator_display_name,
    creator.role AS creator_role,
    gt.id AS game_type_id,
    gt.slug AS game_type_slug,
    gt.name AS game_type_name,
    gs.id AS status_id,
    gs.slug AS status_slug,
    gs.name AS status_name,
    COUNT(gm.id) FILTER (
      WHERE gm.member_role = 'player' AND gm.status = 'approved'
    )::int AS approved_players,
    COUNT(gm.id) FILTER (
      WHERE gm.member_role = 'player' AND gm.status = 'pending'
    )::int AS pending_players_count,
    COUNT(gm.id) FILTER (
      WHERE gm.member_role = 'gm' AND gm.status = 'approved'
    )::int AS approved_gms
  FROM games g
  INNER JOIN users creator ON creator.id = g.creator_id
  INNER JOIN game_types gt ON gt.id = g.game_type_id
  INNER JOIN game_statuses gs ON gs.id = g.status_id
  LEFT JOIN game_memberships gm ON gm.game_id = g.id
`;

const GAME_GROUP_BY = `
  GROUP BY
    g.id,
    g.title,
    g.description,
    g.starts_at,
    g.max_players,
    g.language,
    g.player_level,
    g.is_paid,
    g.price_amount,
    g.format,
    g.location,
    g.created_at,
    g.updated_at,
    creator.id,
    creator.display_name,
    creator.role,
    gt.id,
    gt.slug,
    gt.name,
    gs.id,
    gs.slug,
    gs.name
`;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizePrice(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value);
}

function mapGameRow(row) {
  const approvedPlayers = Number(row.approved_players || 0);
  const pendingPlayersCount = Number(row.pending_players_count || 0);
  const approvedGms = Number(row.approved_gms || 0);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: toIsoString(row.starts_at),
    maxPlayers: row.max_players,
    language: row.language,
    playerLevel: row.player_level,
    isPaid: row.is_paid,
    priceAmount: normalizePrice(row.price_amount),
    format: row.format,
    location: row.location,
    creator: {
      id: row.creator_id,
      displayName: row.creator_display_name,
      role: row.creator_role
    },
    gameType: {
      id: row.game_type_id,
      slug: row.game_type_slug,
      name: row.game_type_name
    },
    status: {
      id: row.status_id,
      slug: row.status_slug,
      name: row.status_name
    },
    summary: {
      approvedPlayers,
      pendingPlayersCount,
      approvedGms,
      hasApprovedGm: approvedGms > 0,
      maxPlayers: row.max_players,
      isFull: approvedPlayers >= row.max_players
    },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapGameRowToEditableData(row) {
  return {
    title: row.title,
    gameTypeId: row.game_type_id,
    description: row.description,
    startsAt: row.starts_at,
    maxPlayers: row.max_players,
    language: row.language,
    playerLevel: row.player_level,
    isPaid: row.is_paid,
    priceAmount: row.price_amount,
    format: row.format,
    location: row.location,
    statusId: row.status_id
  };
}

function pickUpdatableFields(data) {
  const payload = data && typeof data === 'object' ? data : {};

  return UPDATABLE_FIELDS.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      result[field] = payload[field];
    }

    return result;
  }, {});
}

function parseStartsAt(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, 'Invalid startsAt');
  }

  return date;
}

function validateGameData(data, options = {}) {
  const payload = data && typeof data === 'object' ? data : {};
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const language = typeof payload.language === 'string' ? payload.language.trim().toLowerCase() : '';
  const playerLevel = typeof payload.playerLevel === 'string' ? payload.playerLevel.trim().toLowerCase() : '';
  const format = typeof payload.format === 'string' ? payload.format.trim().toLowerCase() : '';
  const location = payload.location === null || payload.location === undefined
    ? null
    : typeof payload.location === 'string'
      ? payload.location.trim()
      : null;
  const gameTypeId = typeof payload.gameTypeId === 'string' ? payload.gameTypeId.trim() : '';
  const statusId = typeof payload.statusId === 'string' ? payload.statusId.trim() : '';
  const rawCreatorRole = typeof payload.creatorRole === 'string' ? payload.creatorRole.trim().toLowerCase() : '';
  const maxPlayers = Number(payload.maxPlayers);
  const isPaid = payload.isPaid;
  const priceAmount = payload.priceAmount === null || payload.priceAmount === undefined || payload.priceAmount === ''
    ? null
    : Number(payload.priceAmount);
  const creatorRole = rawCreatorRole || LEGACY_DEFAULT_CREATOR_ROLE;

  if (!title) {
    throw createHttpError(400, 'Title is required');
  }

  if (title.length > 200) {
    throw createHttpError(400, 'Title is too long');
  }

  if (!isUuid(gameTypeId)) {
    throw createHttpError(400, 'Invalid gameTypeId');
  }

  if (!description) {
    throw createHttpError(400, 'Description is required');
  }

  if (!Number.isInteger(maxPlayers) || maxPlayers <= 0) {
    throw createHttpError(400, 'Invalid maxPlayers');
  }

  if (!ALLOWED_LANGUAGES.includes(language)) {
    throw createHttpError(400, 'Invalid language');
  }

  if (!ALLOWED_PLAYER_LEVELS.includes(playerLevel)) {
    throw createHttpError(400, 'Invalid playerLevel');
  }

  if (typeof isPaid !== 'boolean') {
    throw createHttpError(400, 'Invalid isPaid');
  }

  if (!ALLOWED_FORMATS.includes(format)) {
    throw createHttpError(400, 'Invalid format');
  }

  if (rawCreatorRole && !ALLOWED_CREATOR_ROLES.includes(rawCreatorRole)) {
    throw createHttpError(400, 'Invalid creatorRole');
  }

  if (!isPaid && priceAmount !== null) {
    throw createHttpError(400, 'priceAmount must be null when isPaid is false');
  }

  if (isPaid && (!Number.isFinite(priceAmount) || priceAmount <= 0)) {
    throw createHttpError(400, 'priceAmount must be greater than 0 when isPaid is true');
  }

  if (format === 'offline' && !location) {
    throw createHttpError(400, 'Location is required for offline games');
  }

  if (format === 'online' && location !== null) {
    throw createHttpError(400, 'Location must be null for online games');
  }

  if (options.requireStatusId && !isUuid(statusId)) {
    throw createHttpError(400, 'Invalid statusId');
  }

  return {
    title,
    gameTypeId,
    description,
    startsAt: parseStartsAt(payload.startsAt),
    maxPlayers,
    language,
    playerLevel,
    isPaid,
    priceAmount,
    format,
    location,
    creatorRole,
    statusId: options.requireStatusId ? statusId : null
  };
}

async function getGameTypeById(id, db = pool) {
  const result = await db.query(
    'SELECT id, slug, name FROM game_types WHERE id = $1 LIMIT 1',
    [id]
  );

  return result.rows[0] || null;
}

async function getGameStatusById(id, db = pool) {
  const result = await db.query(
    'SELECT id, slug, name FROM game_statuses WHERE id = $1 LIMIT 1',
    [id]
  );

  return result.rows[0] || null;
}

async function getGameStatusBySlug(slug, db = pool) {
  const result = await db.query(
    'SELECT id, slug, name FROM game_statuses WHERE slug = $1 LIMIT 1',
    [slug]
  );

  return result.rows[0] || null;
}

async function getGameTypes() {
  const result = await pool.query(
    'SELECT id, slug, name FROM game_types ORDER BY name ASC'
  );

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name
  }));
}

async function listGames() {
  const result = await pool.query(
    `${GAME_SELECT_BASE}
     ${GAME_GROUP_BY}
     ORDER BY g.starts_at ASC`
  );

  return result.rows.map(mapGameRow);
}

async function getGameById(id) {
  if (!isUuid(id)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const result = await pool.query(
    `${GAME_SELECT_BASE}
     WHERE g.id = $1
     ${GAME_GROUP_BY}
     LIMIT 1`,
    [id]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Game not found');
  }

  return mapGameRow(result.rows[0]);
}

async function createGame(auth, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  const validatedData = validateGameData(data);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gameType = await getGameTypeById(validatedData.gameTypeId, client);

    if (!gameType) {
      throw createHttpError(400, 'Game type not found');
    }

    const activeStatus = await getGameStatusBySlug('active', client);

    if (!activeStatus) {
      throw createHttpError(500, 'Default game status is not configured');
    }

    const insertResult = await client.query(
      `INSERT INTO games (
        creator_id,
        title,
        game_type_id,
        description,
        starts_at,
        max_players,
        language,
        player_level,
        is_paid,
        price_amount,
        format,
        location,
        status_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        auth.userId,
        validatedData.title,
        validatedData.gameTypeId,
        validatedData.description,
        validatedData.startsAt,
        validatedData.maxPlayers,
        validatedData.language,
        validatedData.playerLevel,
        validatedData.isPaid,
        validatedData.priceAmount,
        validatedData.format,
        validatedData.location,
        activeStatus.id
      ]
    );

    await client.query(
      `INSERT INTO game_memberships (game_id, user_id, member_role, status)
      VALUES ($1, $2, $3, 'approved')`,
      [
        insertResult.rows[0].id,
        auth.userId,
        validatedData.creatorRole
      ]
    );

    await recordActivityEvent({
      actorUserId: auth.userId,
      eventType: 'game.created',
      entityType: 'game',
      entityId: insertResult.rows[0].id,
      payload: {
        title: validatedData.title,
        creatorRole: validatedData.creatorRole,
        startsAt: validatedData.startsAt.toISOString()
      }
    }, client);

    await client.query('COMMIT');

    return getGameById(insertResult.rows[0].id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateGame(auth, id, data) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }

  if (!isUuid(id)) {
    throw createHttpError(400, 'Invalid game id');
  }

  const existingResult = await pool.query(
    `SELECT
      id,
      creator_id,
      title,
      game_type_id,
      description,
      starts_at,
      max_players,
      language,
      player_level,
      is_paid,
      price_amount,
      format,
      location,
      status_id
    FROM games
    WHERE id = $1
    LIMIT 1`,
    [id]
  );

  const existingGame = existingResult.rows[0];

  if (!existingGame) {
    throw createHttpError(404, 'Game not found');
  }

  if (auth.role !== 'admin' && auth.userId !== existingGame.creator_id) {
    throw createHttpError(403, 'Forbidden');
  }

  const mergedData = {
    ...mapGameRowToEditableData(existingGame),
    ...pickUpdatableFields(data)
  };

  const validatedData = validateGameData(mergedData, { requireStatusId: true });
  const gameType = await getGameTypeById(validatedData.gameTypeId);

  if (!gameType) {
    throw createHttpError(400, 'Game type not found');
  }

  const status = await getGameStatusById(validatedData.statusId);

  if (!status) {
    throw createHttpError(400, 'Game status not found');
  }

  await pool.query(
    `UPDATE games
    SET
      title = $2,
      game_type_id = $3,
      description = $4,
      starts_at = $5,
      max_players = $6,
      language = $7,
      player_level = $8,
      is_paid = $9,
      price_amount = $10,
      format = $11,
      location = $12,
      status_id = $13,
      updated_at = now()
    WHERE id = $1`,
    [
      id,
      validatedData.title,
      validatedData.gameTypeId,
      validatedData.description,
      validatedData.startsAt,
      validatedData.maxPlayers,
      validatedData.language,
      validatedData.playerLevel,
      validatedData.isPaid,
      validatedData.priceAmount,
      validatedData.format,
      validatedData.location,
      validatedData.statusId
    ]
  );

  return getGameById(id);
}

module.exports = {
  getGameTypes,
  listGames,
  getGameById,
  createGame,
  updateGame
};
