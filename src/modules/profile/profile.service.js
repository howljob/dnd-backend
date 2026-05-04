const bcrypt = require('bcrypt');
const pool = require('../../db/pool');

const SALT_ROUNDS = 10;
const GAME_ACTIVITY_EVENTS = [
  'game.created',
  'game.join_requested',
  'game.join_approved'
];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireAuthUser(auth) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }
}

function parseLimit(value, fallback = 12, max = 100) {
  const raw = Number(value);
  if (!Number.isInteger(raw)) return fallback;
  return Math.min(Math.max(raw, 1), max);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeProfilePayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
  const bio = typeof payload.bio === 'string' ? payload.bio.trim() : '';
  const avatarRaw = payload.avatar;
  const avatar = typeof avatarRaw === 'string' ? avatarRaw.trim() : (avatarRaw === null ? null : '');

  if (!displayName) {
    throw createHttpError(400, 'Display name is required');
  }
  if (displayName.length > 120) {
    throw createHttpError(400, 'Display name is too long');
  }
  if (bio.length > 4000) {
    throw createHttpError(400, 'Bio is too long');
  }
  if (avatar !== null && avatar && avatar.length > 3 * 1024 * 1024) {
    throw createHttpError(400, 'Avatar payload is too large');
  }
  if (avatar !== null && avatar) {
    const isDataImage = /^data:image\/[a-z0-9.+-]+;base64,/i.test(avatar);
    const isHttpUrl = /^https?:\/\/.+/i.test(avatar);
    if (!isDataImage && !isHttpUrl) {
      throw createHttpError(400, 'Avatar format is not supported');
    }
  }

  return {
    displayName,
    bio,
    avatar: avatar === '' ? null : avatar
  };
}

function normalizeOptionalText(value, maxLength = 300) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw createHttpError(400, `Field is too long (max ${maxLength})`);
  }
  return text;
}

function normalizeCharacterPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const name = String(payload.name || '').trim();
  const gameSystem = String(payload.gameSystem || '').trim();
  const className = String(payload.className || '').trim();
  const race = normalizeOptionalText(payload.race, 120);
  const level = Number(payload.level);
  const campaignName = normalizeOptionalText(payload.campaignName, 180);
  const background = normalizeOptionalText(payload.background, 300);
  const notes = normalizeOptionalText(payload.notes, 3 * 1024 * 1024);
  const statusRaw = String(payload.status || 'active').trim().toLowerCase();
  const status = statusRaw === 'archived' ? 'archived' : 'active';

  if (!name) {
    throw createHttpError(400, 'Character name is required');
  }
  if (name.length > 120) {
    throw createHttpError(400, 'Character name is too long');
  }
  if (!gameSystem) {
    throw createHttpError(400, 'Game system is required');
  }
  if (gameSystem.length > 120) {
    throw createHttpError(400, 'Game system is too long');
  }
  if (!className) {
    throw createHttpError(400, 'Class is required');
  }
  if (className.length > 120) {
    throw createHttpError(400, 'Class is too long');
  }
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw createHttpError(400, 'Level must be an integer between 1 and 20');
  }

  return {
    name,
    gameSystem,
    className,
    race,
    level,
    campaignName,
    background,
    notes,
    status
  };
}

function mapCharacterRow(row) {
  return {
    id: row.id,
    name: row.name,
    gameSystem: row.game_system,
    className: row.class_name,
    race: row.race || '',
    level: Number(row.level || 1),
    campaignName: row.campaign_name || '',
    background: row.background || '',
    notes: row.notes || '',
    status: row.status || 'active',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function updateMyProfile(auth, data) {
  requireAuthUser(auth);
  const payload = normalizeProfilePayload(data);

  const result = await pool.query(
    `UPDATE users
     SET
       display_name = $2,
       bio = $3,
       avatar_url = $4,
       updated_at = now()
     WHERE id = $1
     RETURNING
       id,
       email,
       display_name,
       role,
       language,
       account_status,
       bio,
       avatar_url,
       created_at,
       updated_at`,
    [
      auth.userId,
      payload.displayName,
      payload.bio,
      payload.avatar
    ]
  );

  const user = result.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    language: user.language,
    accountStatus: user.account_status,
    bio: user.bio || '',
    avatar: user.avatar_url || null,
    createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
    updatedAt: user.updated_at instanceof Date ? user.updated_at.toISOString() : user.updated_at
  };
}

async function getPersonalGames(auth) {
  requireAuthUser(auth);

  const result = await pool.query(
    `SELECT
      g.id,
      g.title,
      g.starts_at,
      g.created_at,
      gt.name AS game_type_name,
      gt.slug AS game_type_slug,
      gs.slug AS status_slug,
      gs.name AS status_name,
      gm.member_role,
      gm.status AS membership_status,
      (
        SELECT COUNT(*)::int
        FROM game_memberships gm_players
        WHERE gm_players.game_id = g.id
          AND gm_players.member_role = 'player'
          AND gm_players.status = 'approved'
      ) AS approved_players,
      g.max_players
    FROM game_memberships gm
    INNER JOIN games g ON g.id = gm.game_id
    INNER JOIN game_types gt ON gt.id = g.game_type_id
    INNER JOIN game_statuses gs ON gs.id = g.status_id
    WHERE gm.user_id = $1
      AND gm.status = 'approved'
    ORDER BY g.starts_at DESC NULLS LAST, g.created_at DESC`,
    [auth.userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    system: row.game_type_name || 'TTRPG',
    systemSlug: row.game_type_slug || 'other',
    memberRole: row.member_role,
    membershipStatus: row.membership_status,
    details: `${row.game_type_name || 'TTRPG'} • ${row.member_role === 'gm' ? 'GM' : 'Player'} • ${toNumber(row.approved_players)}/${toNumber(row.max_players)}`,
    period: row.starts_at ? toIso(row.starts_at) : null,
    status: row.status_slug || 'active',
    createdAt: toIso(row.created_at),
    startsAt: row.starts_at ? toIso(row.starts_at) : null
  }));
}

async function getGameActivity(auth, query = {}) {
  requireAuthUser(auth);
  const limit = parseLimit(query.limit, 16, 100);

  const result = await pool.query(
    `SELECT
      e.id,
      e.event_type,
      e.entity_type,
      e.entity_id,
      e.payload,
      e.created_at
    FROM community_activity_events e
    WHERE e.actor_user_id = $1
      AND e.event_type = ANY($2::varchar[])
    ORDER BY e.created_at DESC
    LIMIT $3`,
    [auth.userId, GAME_ACTIVITY_EVENTS, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    createdAt: toIso(row.created_at)
  }));
}

async function listCharacters(auth) {
  requireAuthUser(auth);

  const result = await pool.query(
    `SELECT
      id,
      name,
      game_system,
      class_name,
      race,
      level,
      campaign_name,
      background,
      notes,
      status,
      created_at,
      updated_at
    FROM user_characters
    WHERE user_id = $1
    ORDER BY updated_at DESC, created_at DESC`,
    [auth.userId]
  );

  return result.rows.map((row) => mapCharacterRow(row));
}

async function createCharacter(auth, data) {
  requireAuthUser(auth);
  const payload = normalizeCharacterPayload(data);

  const result = await pool.query(
    `INSERT INTO user_characters (
      user_id,
      name,
      game_system,
      class_name,
      race,
      level,
      campaign_name,
      background,
      notes,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
    RETURNING
      id,
      name,
      game_system,
      class_name,
      race,
      level,
      campaign_name,
      background,
      notes,
      status,
      created_at,
      updated_at`,
    [
      auth.userId,
      payload.name,
      payload.gameSystem,
      payload.className,
      payload.race,
      payload.level,
      payload.campaignName,
      payload.background,
      payload.notes,
      payload.status
    ]
  );

  return mapCharacterRow(result.rows[0]);
}

async function updateCharacter(auth, characterId, data) {
  requireAuthUser(auth);
  if (!isUuid(characterId)) {
    throw createHttpError(400, 'Invalid character id');
  }

  const payload = normalizeCharacterPayload(data);
  const result = await pool.query(
    `UPDATE user_characters
     SET
       name = $3,
       game_system = $4,
       class_name = $5,
       race = $6,
       level = $7,
       campaign_name = $8,
       background = $9,
       notes = $10,
       status = $11,
       updated_at = now()
     WHERE id = $1
       AND user_id = $2
     RETURNING
       id,
       name,
       game_system,
       class_name,
       race,
       level,
       campaign_name,
       background,
       notes,
       status,
       created_at,
       updated_at`,
    [
      characterId,
      auth.userId,
      payload.name,
      payload.gameSystem,
      payload.className,
      payload.race,
      payload.level,
      payload.campaignName,
      payload.background,
      payload.notes,
      payload.status
    ]
  );

  const character = result.rows[0];
  if (!character) {
    throw createHttpError(404, 'Character not found');
  }

  return mapCharacterRow(character);
}

async function getRating(auth) {
  requireAuthUser(auth);
  const ratingRows = await pool.query(
    `SELECT
      context_role,
      AVG(score)::numeric(10,2) AS avg_score,
      COUNT(*)::int AS votes_count
    FROM user_reputation_ratings
    WHERE target_user_id = $1
    GROUP BY context_role`,
    [auth.userId]
  );

  const scoreByRole = {
    player: { avg: 0, votes: 0 },
    gm: { avg: 0, votes: 0 },
    social: { avg: 0, votes: 0 }
  };
  for (const row of ratingRows.rows) {
    const role = String(row.context_role || '');
    if (!scoreByRole[role]) continue;
    scoreByRole[role] = {
      avg: Math.max(0, Math.min(5, Number(Number(row.avg_score || 0).toFixed(1)))),
      votes: toNumber(row.votes_count)
    };
  }

  const totalVotes = scoreByRole.player.votes + scoreByRole.gm.votes + scoreByRole.social.votes;
  const weightedTotal = (
    scoreByRole.player.avg * scoreByRole.player.votes
    + scoreByRole.gm.avg * scoreByRole.gm.votes
    + scoreByRole.social.avg * scoreByRole.social.votes
  );
  const totalRating = totalVotes > 0 ? Number((weightedTotal / totalVotes).toFixed(1)) : 0;

  const ratingHistoryResult = await pool.query(
    `SELECT
      id,
      context_role,
      score,
      game_id,
      created_at,
      comment
    FROM user_reputation_ratings
    WHERE target_user_id = $1
    ORDER BY created_at DESC
    LIMIT 12`,
    [auth.userId]
  );
  const ratingHistory = ratingHistoryResult.rows.map((row) => ({
    id: row.id,
    eventType: 'rating.given',
    payload: {
      contextRole: row.context_role,
      score: Number(row.score || 0),
      gameId: row.game_id,
      comment: row.comment || ''
    },
    createdAt: toIso(row.created_at)
  }));

  return {
    total: totalRating,
    player: scoreByRole.player.avg,
    gm: scoreByRole.gm.avg,
    social: scoreByRole.social.avg,
    source: {
      totalVotes,
      playerVotes: scoreByRole.player.votes,
      gmVotes: scoreByRole.gm.votes,
      socialVotes: scoreByRole.social.votes
    },
    history: ratingHistory
  };
}

async function submitRating(auth, data) {
  requireAuthUser(auth);
  const payload = data && typeof data === 'object' ? data : {};
  const targetUserId = typeof payload.targetUserId === 'string' ? payload.targetUserId.trim() : '';
  const contextRole = typeof payload.contextRole === 'string' ? payload.contextRole.trim().toLowerCase() : '';
  const score = Number(payload.score);
  const gameId = typeof payload.gameId === 'string' ? payload.gameId.trim() : '';
  const comment = typeof payload.comment === 'string' ? payload.comment.trim() : '';

  if (!isUuid(targetUserId)) {
    throw createHttpError(400, 'Invalid target user id');
  }
  if (targetUserId === auth.userId) {
    throw createHttpError(400, 'Cannot rate yourself');
  }
  if (!['player', 'gm', 'social'].includes(contextRole)) {
    throw createHttpError(400, 'Invalid context role');
  }
  if (!Number.isFinite(score) || score < 0 || score > 5) {
    throw createHttpError(400, 'Score must be between 0 and 5');
  }
  if (comment.length > 500) {
    throw createHttpError(400, 'Comment is too long');
  }

  const targetUserResult = await pool.query(
    'SELECT id FROM users WHERE id = $1 LIMIT 1',
    [targetUserId]
  );
  if (!targetUserResult.rows[0]) {
    throw createHttpError(404, 'Target user not found');
  }

  const normalizedGameId = gameId && isUuid(gameId) ? gameId : null;
  if (gameId && !normalizedGameId) {
    throw createHttpError(400, 'Invalid game id');
  }

  if (normalizedGameId) {
    const membershipResult = await pool.query(
      `SELECT user_id
       FROM game_memberships
       WHERE game_id = $1
         AND status = 'approved'
         AND user_id = ANY($2::uuid[])`,
      [normalizedGameId, [auth.userId, targetUserId]]
    );
    const members = new Set(membershipResult.rows.map((row) => row.user_id));
    if (!members.has(auth.userId) || !members.has(targetUserId)) {
      throw createHttpError(400, 'Both users must be approved members of the selected game');
    }
  }

  const existingResult = await pool.query(
    `SELECT id
     FROM user_reputation_ratings
     WHERE author_user_id = $1
       AND target_user_id = $2
       AND context_role = $3
       AND (
         ($4::uuid IS NULL AND game_id IS NULL)
         OR game_id = $4::uuid
       )
     LIMIT 1`,
    [auth.userId, targetUserId, contextRole, normalizedGameId]
  );

  if (existingResult.rows[0]) {
    await pool.query(
      `UPDATE user_reputation_ratings
       SET score = $2, comment = $3, created_at = now()
       WHERE id = $1`,
      [existingResult.rows[0].id, score, comment || null]
    );
  } else {
    await pool.query(
      `INSERT INTO user_reputation_ratings (
        target_user_id,
        author_user_id,
        game_id,
        context_role,
        score,
        comment
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [targetUserId, auth.userId, normalizedGameId, contextRole, score, comment || null]
    );
  }

  return { ok: true };
}

async function listSecuritySessions(auth) {
  requireAuthUser(auth);

  const result = await pool.query(
    `SELECT
      id,
      token_id,
      user_agent,
      ip_address,
      created_at,
      last_seen_at
    FROM user_sessions
    WHERE user_id = $1
      AND revoked_at IS NULL
    ORDER BY last_seen_at DESC`,
    [auth.userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    userAgent: row.user_agent || '',
    ipAddress: row.ip_address || '',
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    isCurrent: auth.sessionId ? row.id === auth.sessionId : false
  }));
}

async function changePassword(auth, data) {
  requireAuthUser(auth);

  const payload = data && typeof data === 'object' ? data : {};
  const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';

  if (!currentPassword || !newPassword) {
    throw createHttpError(400, 'Current password and new password are required');
  }

  if (newPassword.length < 8) {
    throw createHttpError(400, 'New password must be at least 8 characters');
  }

  if (newPassword === currentPassword) {
    throw createHttpError(400, 'New password must be different from current password');
  }

  const userResult = await pool.query(
    'SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1',
    [auth.userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!passwordMatches) {
    throw createHttpError(400, 'Current password is incorrect');
  }

  const nextPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1`,
      [auth.userId, nextPasswordHash]
    );

    let revokedCount = 0;
    if (auth.sessionId) {
      const revokeResult = await client.query(
        `UPDATE user_sessions
         SET revoked_at = now(), revoked_reason = 'password_changed'
         WHERE user_id = $1
           AND revoked_at IS NULL
           AND id <> $2`,
        [auth.userId, auth.sessionId]
      );
      revokedCount = revokeResult.rowCount;
    } else {
      const revokeResult = await client.query(
        `UPDATE user_sessions
         SET revoked_at = now(), revoked_reason = 'password_changed'
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [auth.userId]
      );
      revokedCount = revokeResult.rowCount;
    }

    await client.query('COMMIT');
    return { revokedCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function signOutAllSessions(auth) {
  requireAuthUser(auth);

  const result = await pool.query(
    `UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'user_sign_out_all'
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [auth.userId]
  );

  return { revokedCount: result.rowCount };
}

async function revokeSingleSession(auth, sessionId) {
  requireAuthUser(auth);

  if (!isUuid(sessionId)) {
    throw createHttpError(400, 'Invalid session id');
  }

  if (auth.sessionId && sessionId === auth.sessionId) {
    throw createHttpError(400, 'Use sign out all to close current session');
  }

  const result = await pool.query(
    `UPDATE user_sessions
     SET revoked_at = now(), revoked_reason = 'user_revoked_single'
     WHERE user_id = $1
       AND id = $2
       AND revoked_at IS NULL`,
    [auth.userId, sessionId]
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Session not found');
  }

  return { revokedCount: 1 };
}

async function getAchievementMetrics(auth) {
  requireAuthUser(auth);

  const profileResult = await pool.query(
    `SELECT id, email, display_name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [auth.userId]
  );
  if (!profileResult.rows[0]) {
    throw createHttpError(404, 'User not found');
  }

  const gamesResult = await pool.query(
    `WITH personal_games AS (
      SELECT
        g.id,
        gs.slug AS status_slug,
        gm.member_role,
        gt.slug AS game_type_slug
      FROM game_memberships gm
      INNER JOIN games g ON g.id = gm.game_id
      INNER JOIN game_statuses gs ON gs.id = g.status_id
      INNER JOIN game_types gt ON gt.id = g.game_type_id
      WHERE gm.user_id = $1
        AND gm.status = 'approved'
    )
    SELECT
      COUNT(*)::int AS sessions_played,
      COUNT(DISTINCT id)::int AS games_total,
      COUNT(*) FILTER (WHERE status_slug = 'active')::int AS campaigns_active,
      COUNT(*) FILTER (WHERE status_slug = 'completed')::int AS campaigns_completed,
      COUNT(*) FILTER (WHERE member_role = 'gm')::int AS gm_sessions,
      COUNT(*) FILTER (WHERE member_role = 'player')::int AS player_sessions,
      COUNT(*) FILTER (WHERE member_role = 'gm')::int AS gm_campaigns,
      COUNT(DISTINCT game_type_slug)::int AS unique_systems,
      COUNT(*) FILTER (WHERE game_type_slug = 'dnd')::int AS dnd_sessions
    FROM personal_games`,
    [auth.userId]
  );

  const notificationsResult = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE is_read = true)::int AS notifications_read
    FROM community_notifications
    WHERE user_id = $1`,
    [auth.userId]
  );

  const games = gamesResult.rows[0] || {};
  const notifications = notificationsResult.rows[0] || {};
  const profile = profileResult.rows[0];
  const gmSessions = toNumber(games.gm_sessions);
  const playerSessions = toNumber(games.player_sessions);

  return {
    profileCompleted: profile.display_name && profile.email ? 1 : 0,
    sessionsPlayed: toNumber(games.sessions_played),
    gamesTotal: toNumber(games.games_total),
    campaignsActive: toNumber(games.campaigns_active),
    campaignsCompleted: toNumber(games.campaigns_completed),
    gmSessions,
    playerSessions,
    gmCampaigns: toNumber(games.gm_campaigns),
    uniqueSystems: toNumber(games.unique_systems),
    dndSessions: toNumber(games.dnd_sessions),
    dualRole: gmSessions > 0 && playerSessions > 0 ? 1 : 0,
    achievementCompletionPercent: 0,
    notificationsRead: toNumber(notifications.notifications_read),
    streakDays: 0
  };
}

function normalizeAchievementCatalog(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const metric = typeof item.metric === 'string' ? item.metric.trim() : '';
      const target = Number(item.target);
      const points = Number(item.points);
      const rarity = typeof item.rarity === 'string' ? item.rarity.trim().toLowerCase() : 'common';
      const tier = typeof item.tier === 'string' ? item.tier.trim().toLowerCase() : 'bronze';
      const status = item.status === 'future' ? 'future' : 'mvp';

      if (!id || !metric || !Number.isFinite(target) || target <= 0) {
        return null;
      }

      return {
        id,
        metric,
        target: Math.max(1, Math.floor(target)),
        points: Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0,
        rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(rarity) ? rarity : 'common',
        tier: ['bronze', 'silver', 'gold', 'platinum'].includes(tier) ? tier : 'bronze',
        status
      };
    })
    .filter(Boolean);

  if (items.length === 0) {
    throw createHttpError(400, 'Achievement catalog payload is empty');
  }

  if (items.length > 300) {
    throw createHttpError(400, 'Achievement catalog payload is too large');
  }

  return items;
}

async function syncAchievementProgress(auth, payload) {
  requireAuthUser(auth);
  const catalogItems = normalizeAchievementCatalog(payload);
  const metrics = await getAchievementMetrics(auth);

  const progressItems = catalogItems.map((item) => {
    const metricValue = toNumber(metrics[item.metric]);
    return {
      ...item,
      progress: metricValue,
      unlocked: metricValue >= item.target
    };
  });

  const unlockedCount = progressItems.filter((item) => item.unlocked).length;
  const completionPercent = progressItems.length > 0
    ? Math.floor((unlockedCount / progressItems.length) * 100)
    : 0;

  const finalizedItems = progressItems.map((item) => {
    if (item.metric !== 'achievementCompletionPercent') {
      return item;
    }

    const progress = completionPercent;
    return {
      ...item,
      progress,
      unlocked: progress >= item.target
    };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of finalizedItems) {
      await client.query(
        `INSERT INTO user_achievement_progress (
          user_id,
          achievement_id,
          metric_key,
          progress_value,
          target_value,
          points,
          rarity,
          tier,
          status,
          unlocked_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid, $2::varchar, $3::varchar, $4::int, $5::int, $6::int, $7::varchar, $8::varchar, $9::varchar,
          CASE WHEN $4::int >= $5::int THEN now() ELSE NULL END,
          now(), now()
        )
        ON CONFLICT (user_id, achievement_id)
        DO UPDATE SET
          metric_key = EXCLUDED.metric_key,
          progress_value = EXCLUDED.progress_value,
          target_value = EXCLUDED.target_value,
          points = EXCLUDED.points,
          rarity = EXCLUDED.rarity,
          tier = EXCLUDED.tier,
          status = EXCLUDED.status,
          unlocked_at = CASE
            WHEN user_achievement_progress.unlocked_at IS NOT NULL THEN user_achievement_progress.unlocked_at
            WHEN EXCLUDED.progress_value >= EXCLUDED.target_value THEN now()
            ELSE NULL
          END,
          updated_at = now()`,
        [
          auth.userId,
          item.id,
          item.metric,
          item.progress,
          item.target,
          item.points,
          item.rarity,
          item.tier,
          item.status
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    metrics: {
      ...metrics,
      achievementCompletionPercent: completionPercent
    },
    items: finalizedItems.map((item) => ({
      id: item.id,
      metric: item.metric,
      target: item.target,
      progress: item.progress,
      unlocked: item.unlocked,
      points: item.points,
      rarity: item.rarity,
      tier: item.tier,
      status: item.status
    }))
  };
}

module.exports = {
  updateMyProfile,
  getPersonalGames,
  getGameActivity,
  listCharacters,
  createCharacter,
  updateCharacter,
  getRating,
  listSecuritySessions,
  changePassword,
  signOutAllSessions,
  revokeSingleSession,
  submitRating,
  syncAchievementProgress
};
