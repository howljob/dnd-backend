const pool = require('../../db/pool');
const { recordActivityEvent } = require('./community-activity.service');
const { createNotification } = require('./community-notifications.service');

const ALLOWED_POST_KINDS = ['text', 'lfg'];
const ALLOWED_LFG_TYPES = ['player', 'dm'];
const ALLOWED_LFG_FORMATS = ['online', 'offline', 'either'];
const ALLOWED_FEED_FILTERS = ['all', 'mine', 'following'];
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireAuthUser(auth) {
  if (!auth || !isUuid(auth.userId)) {
    throw createHttpError(401, 'Unauthorized');
  }
}

function parseLimit(value, fallback = 30, max = 100) {
  const raw = Number(value);
  if (!Number.isInteger(raw)) return fallback;
  return Math.min(Math.max(raw, 1), max);
}

function parseCursor(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, 'Invalid cursor');
  }

  return date.toISOString();
}

function parseFeedFilter(value) {
  const filter = typeof value === 'string' ? value.trim().toLowerCase() : 'all';
  if (!ALLOWED_FEED_FILTERS.includes(filter)) {
    throw createHttpError(400, 'Invalid feed filter');
  }

  return filter;
}

function parseAuthorId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim();
  if (!isUuid(candidate)) {
    throw createHttpError(400, 'Invalid authorId');
  }

  return candidate;
}

function normalizeAttachments(rawAttachments) {
  if (rawAttachments === undefined) {
    return [];
  }

  if (!Array.isArray(rawAttachments)) {
    throw createHttpError(400, 'Attachments must be an array');
  }

  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw createHttpError(400, `Too many attachments (max ${MAX_ATTACHMENTS})`);
  }

  return rawAttachments.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw createHttpError(400, `Invalid attachment at index ${index}`);
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl.trim() : '';
    const size = Number(item.size);

    if (!name || !type || !dataUrl || !Number.isFinite(size) || size <= 0) {
      throw createHttpError(400, `Invalid attachment payload at index ${index}`);
    }

    if (size > MAX_ATTACHMENT_BYTES) {
      throw createHttpError(400, `Attachment too large at index ${index}`);
    }

    if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
      throw createHttpError(400, `Invalid attachment encoding at index ${index}`);
    }

    return {
      name: name.slice(0, 180),
      type: type.slice(0, 120),
      size: Math.floor(size),
      dataUrl
    };
  });
}

function mapPostRow(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];

  return {
    id: row.id,
    kind: row.post_kind,
    title: row.title || '',
    content: row.content_text,
    visibility: row.visibility,
    metadata,
    attachments,
    author: {
      id: row.author_user_id,
      displayName: row.author_display_name,
      avatar: row.author_avatar_url || null
    },
    stats: {
      reactionsCount: Number(row.reactions_count || 0),
      commentsCount: Number(row.comments_count || 0)
    },
    viewer: {
      hasLiked: row.viewer_has_liked === true
    },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapActivityRow(row) {
  return {
    id: row.id,
    actor: {
      id: row.actor_user_id,
      displayName: row.actor_display_name,
      avatar: row.actor_avatar_url || null
    },
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload || {},
    createdAt: toIso(row.created_at)
  };
}

function validatePostCreatePayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const kind = typeof payload.kind === 'string' && payload.kind.trim()
    ? payload.kind.trim().toLowerCase()
    : 'text';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  const visibility = 'public';
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {};
  const attachments = normalizeAttachments(payload.attachments);

  if (!ALLOWED_POST_KINDS.includes(kind)) {
    throw createHttpError(400, 'Invalid post kind');
  }

  if (title.length > 200) {
    throw createHttpError(400, 'Title is too long');
  }

  if (!content) {
    throw createHttpError(400, 'Post content is required');
  }

  if (content.length > 5000) {
    throw createHttpError(400, 'Post content is too long');
  }

  return {
    kind,
    title: title || null,
    content,
    visibility,
    metadata: {
      ...metadata,
      attachments
    }
  };
}

function validatePostUpdatePayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const result = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (title.length > 200) {
      throw createHttpError(400, 'Title is too long');
    }

    result.title = title || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
    const content = typeof payload.content === 'string' ? payload.content.trim() : '';
    if (!content) {
      throw createHttpError(400, 'Post content is required');
    }

    if (content.length > 5000) {
      throw createHttpError(400, 'Post content is too long');
    }

    result.content = content;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
    if (!payload.metadata || typeof payload.metadata !== 'object' || Array.isArray(payload.metadata)) {
      throw createHttpError(400, 'Invalid metadata');
    }

    result.metadata = payload.metadata;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'attachments')) {
    result.attachments = normalizeAttachments(payload.attachments);
  }

  if (Object.keys(result).length === 0) {
    throw createHttpError(400, 'No changes provided');
  }

  return result;
}

function validateCommentPayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';

  if (!content) {
    throw createHttpError(400, 'Comment content is required');
  }

  if (content.length > 2000) {
    throw createHttpError(400, 'Comment is too long');
  }

  return { content };
}

function validateLfgCreatePayload(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const type = typeof payload.type === 'string' ? payload.type.trim().toLowerCase() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const system = typeof payload.system === 'string' ? payload.system.trim() : '';
  const format = typeof payload.format === 'string' ? payload.format.trim().toLowerCase() : '';
  const schedule = typeof payload.schedule === 'string' ? payload.schedule.trim() : '';

  if (!ALLOWED_LFG_TYPES.includes(type)) {
    throw createHttpError(400, 'Invalid post type');
  }

  if (!title || title.length > 200) {
    throw createHttpError(400, 'Invalid title');
  }

  if (!description || description.length > 4000) {
    throw createHttpError(400, 'Invalid description');
  }

  if (!system || system.length > 120) {
    throw createHttpError(400, 'Invalid system');
  }

  if (!ALLOWED_LFG_FORMATS.includes(format)) {
    throw createHttpError(400, 'Invalid format');
  }

  if (!schedule || schedule.length > 160) {
    throw createHttpError(400, 'Invalid schedule');
  }

  return {
    type,
    title,
    description,
    system,
    format,
    schedule
  };
}

function mapCommentRow(row) {
  return {
    id: row.id,
    content: row.content_text,
    author: {
      id: row.author_user_id,
      displayName: row.author_display_name,
      avatar: row.author_avatar_url || null
    },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapFollowRow(row) {
  return {
    user: {
      id: row.user_id,
      displayName: row.display_name,
      avatar: row.avatar_url || null
    },
    createdAt: toIso(row.created_at)
  };
}

async function getPostRecordById(id) {
  const result = await pool.query(
    `SELECT id, author_user_id, deleted_at, metadata
    FROM community_posts
    WHERE id = $1
    LIMIT 1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getPostById(id, viewerUserId = null) {
  const values = [id];
  const viewerLikeSql = viewerUserId
    ? `EXISTS(
      SELECT 1
      FROM community_post_reactions vr
      WHERE vr.post_id = p.id
        AND vr.user_id = $2
        AND vr.reaction_type = 'like'
    )`
    : 'false';

  if (viewerUserId) {
    values.push(viewerUserId);
  }

  const result = await pool.query(
    `SELECT
      p.id,
      p.author_user_id,
      p.post_kind,
      p.title,
      p.content_text,
      p.visibility,
      p.metadata,
      p.created_at,
      p.updated_at,
      u.display_name AS author_display_name,
      u.avatar_url AS author_avatar_url,
      COALESCE(r.reactions_count, 0) AS reactions_count,
      COALESCE(c.comments_count, 0) AS comments_count,
      ${viewerLikeSql} AS viewer_has_liked
    FROM community_posts p
    INNER JOIN users u ON u.id = p.author_user_id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS reactions_count
      FROM community_post_reactions
      WHERE reaction_type = 'like'
      GROUP BY post_id
    ) r ON r.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS comments_count
      FROM community_post_comments
      WHERE deleted_at IS NULL
      GROUP BY post_id
    ) c ON c.post_id = p.id
    WHERE p.id = $1
      AND p.deleted_at IS NULL
    LIMIT 1`,
    values
  );

  return result.rows[0] ? mapPostRow(result.rows[0]) : null;
}

async function listFeed(auth, query) {
  const filter = parseFeedFilter(query?.filter);
  const cursor = parseCursor(query?.cursor);
  const authorId = parseAuthorId(query?.authorId);
  const limit = parseLimit(query?.limit, 30, 100);
  const viewerUserId = isUuid(auth?.userId) ? auth.userId : null;

  if ((filter === 'mine' || filter === 'following') && !viewerUserId) {
    throw createHttpError(401, 'Unauthorized');
  }

  const postsValues = [];
  let postsWhere = 'p.deleted_at IS NULL';
  let postsCursor = '';
  let postsFilter = '';
  let viewerLikeExpr = 'false';

  if (cursor) {
    postsValues.push(cursor);
    postsCursor = ` AND p.created_at < $${postsValues.length}`;
  }

  if (filter === 'mine') {
    postsValues.push(viewerUserId);
    postsFilter = ` AND p.author_user_id = $${postsValues.length}`;
  } else if (filter === 'following') {
    postsValues.push(viewerUserId);
    postsFilter = `
      AND (
        p.author_user_id = $${postsValues.length}
        OR p.author_user_id IN (
          SELECT followee_user_id
          FROM community_follows
          WHERE follower_user_id = $${postsValues.length}
        )
      )
    `;
  }

  if (authorId) {
    postsValues.push(authorId);
    postsFilter += ` AND p.author_user_id = $${postsValues.length}`;
  }

  if (viewerUserId) {
    postsValues.push(viewerUserId);
    viewerLikeExpr = `EXISTS(
      SELECT 1
      FROM community_post_reactions vr
      WHERE vr.post_id = p.id
        AND vr.user_id = $${postsValues.length}
        AND vr.reaction_type = 'like'
    )`;
  }

  postsValues.push(limit * 2);
  postsWhere += postsCursor + postsFilter;

  const postsOrderBy = filter === 'all'
    ? 'score DESC, p.created_at DESC'
    : 'p.created_at DESC';

  const postsResult = await pool.query(
    `SELECT
      p.id,
      p.author_user_id,
      p.post_kind,
      p.title,
      p.content_text,
      p.visibility,
      p.metadata,
      p.created_at,
      p.updated_at,
      u.display_name AS author_display_name,
      u.avatar_url AS author_avatar_url,
      COALESCE(r.reactions_count, 0) AS reactions_count,
      COALESCE(c.comments_count, 0) AS comments_count,
      (COALESCE(r.reactions_count, 0) * 2 + COALESCE(c.comments_count, 0))::int AS score,
      ${viewerLikeExpr} AS viewer_has_liked
    FROM community_posts p
    INNER JOIN users u ON u.id = p.author_user_id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS reactions_count
      FROM community_post_reactions
      WHERE reaction_type = 'like'
      GROUP BY post_id
    ) r ON r.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*)::int AS comments_count
      FROM community_post_comments
      WHERE deleted_at IS NULL
      GROUP BY post_id
    ) c ON c.post_id = p.id
    WHERE ${postsWhere}
    ORDER BY ${postsOrderBy}
    LIMIT $${postsValues.length}`,
    postsValues
  );

  const items = postsResult.rows
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      type: 'post',
      createdAt: toIso(row.created_at),
      post: mapPostRow(row)
    }));

  const nextCursor = items.length > 0 ? items[items.length - 1].createdAt : null;

  return {
    items,
    pageInfo: {
      nextCursor,
      hasMore: postsResult.rows.length > items.length
    }
  };
}

async function getMySummary(auth) {
  requireAuthUser(auth);

  const userResult = await pool.query(
    'SELECT id, display_name, avatar_url FROM users WHERE id = $1 LIMIT 1',
    [auth.userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  const [followersResult, followingResult, postsResult] = await Promise.all([
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_follows WHERE followee_user_id = $1',
      [auth.userId]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_follows WHERE follower_user_id = $1',
      [auth.userId]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_posts WHERE author_user_id = $1 AND deleted_at IS NULL',
      [auth.userId]
    )
  ]);

  return {
    user: {
      id: user.id,
      displayName: user.display_name,
      avatar: user.avatar_url || null
    },
    followersCount: Number(followersResult.rows[0]?.count || 0),
    followingCount: Number(followingResult.rows[0]?.count || 0),
    postsCount: Number(postsResult.rows[0]?.count || 0)
  };
}

async function getUserSummary(auth, userId) {
  if (!isUuid(userId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  const viewerUserId = isUuid(auth?.userId) ? auth.userId : null;
  const userResult = await pool.query(
    'SELECT id, display_name, avatar_url FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  const [followersResult, followingResult, postsResult, relationResult] = await Promise.all([
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_follows WHERE followee_user_id = $1',
      [userId]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_follows WHERE follower_user_id = $1',
      [userId]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM community_posts WHERE author_user_id = $1 AND deleted_at IS NULL',
      [userId]
    ),
    viewerUserId
      ? pool.query(
        `SELECT 1
         FROM community_follows
         WHERE follower_user_id = $1
           AND followee_user_id = $2
         LIMIT 1`,
        [viewerUserId, userId]
      )
      : Promise.resolve({ rows: [] })
  ]);

  return {
    user: {
      id: user.id,
      displayName: user.display_name,
      avatar: user.avatar_url || null
    },
    followersCount: Number(followersResult.rows[0]?.count || 0),
    followingCount: Number(followingResult.rows[0]?.count || 0),
    postsCount: Number(postsResult.rows[0]?.count || 0),
    viewerIsFollowing: relationResult.rows.length > 0
  };
}

function mapNotificationRow(row) {
  return {
    id: row.id,
    type: row.notification_type,
    isRead: row.is_read,
    actor: row.actor_user_id ? {
      id: row.actor_user_id,
      displayName: row.actor_display_name || 'User',
      avatar: row.actor_avatar_url || null
    } : null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload || {},
    createdAt: toIso(row.created_at)
  };
}

async function listMyNotifications(auth, query) {
  requireAuthUser(auth);
  const limit = parseLimit(query?.limit, 40, 200);

  const result = await pool.query(
    `SELECT
      n.id,
      n.notification_type,
      n.entity_type,
      n.entity_id,
      n.payload,
      n.is_read,
      n.created_at,
      n.actor_user_id,
      u.display_name AS actor_display_name,
      u.avatar_url AS actor_avatar_url
    FROM community_notifications n
    LEFT JOIN users u ON u.id = n.actor_user_id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    LIMIT $2`,
    [auth.userId, limit]
  );

  return result.rows.map(mapNotificationRow);
}

async function markNotificationsRead(auth) {
  requireAuthUser(auth);
  await pool.query(
    `UPDATE community_notifications
     SET is_read = true
     WHERE user_id = $1
       AND is_read = false`,
    [auth.userId]
  );

  return { ok: true };
}

async function createPost(auth, data) {
  requireAuthUser(auth);
  const validated = validatePostCreatePayload(data);

  const result = await pool.query(
    `INSERT INTO community_posts (
      author_user_id,
      post_kind,
      title,
      content_text,
      visibility,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      auth.userId,
      validated.kind,
      validated.title,
      validated.content,
      validated.visibility,
      validated.metadata
    ]
  );

  await recordActivityEvent({
    actorUserId: auth.userId,
    eventType: 'community.post.created',
    entityType: 'community_post',
    entityId: result.rows[0].id,
    payload: {
      kind: validated.kind,
      title: validated.title || null
    }
  });

  return getPostById(result.rows[0].id, auth.userId);
}

async function updatePost(auth, postId, data) {
  requireAuthUser(auth);

  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  const postRecord = await getPostRecordById(postId);
  if (!postRecord || postRecord.deleted_at) {
    throw createHttpError(404, 'Post not found');
  }

  if (auth.role !== 'admin' && auth.userId !== postRecord.author_user_id) {
    throw createHttpError(403, 'Forbidden');
  }

  const validated = validatePostUpdatePayload(data);
  const setParts = [];
  const values = [postId];

  if (Object.prototype.hasOwnProperty.call(validated, 'title')) {
    values.push(validated.title);
    setParts.push(`title = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(validated, 'content')) {
    values.push(validated.content);
    setParts.push(`content_text = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(validated, 'metadata')) {
    values.push(validated.metadata);
    setParts.push(`metadata = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(validated, 'attachments')) {
    const currentMetadata = postRecord.metadata && typeof postRecord.metadata === 'object' ? postRecord.metadata : {};
    values.push({
      ...currentMetadata,
      attachments: validated.attachments
    });
    setParts.push(`metadata = $${values.length}`);
  }

  await pool.query(
    `UPDATE community_posts
    SET ${setParts.join(', ')}, updated_at = now()
    WHERE id = $1`,
    values
  );

  return getPostById(postId, auth.userId);
}

async function deletePost(auth, postId) {
  requireAuthUser(auth);

  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  const postRecord = await getPostRecordById(postId);
  if (!postRecord || postRecord.deleted_at) {
    throw createHttpError(404, 'Post not found');
  }

  if (auth.role !== 'admin' && auth.userId !== postRecord.author_user_id) {
    throw createHttpError(403, 'Forbidden');
  }

  await pool.query(
    `UPDATE community_posts
    SET deleted_at = now(), updated_at = now()
    WHERE id = $1`,
    [postId]
  );

  return { ok: true };
}

async function addPostReaction(auth, postId) {
  requireAuthUser(auth);

  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  const postRecord = await getPostRecordById(postId);
  if (!postRecord || postRecord.deleted_at) {
    throw createHttpError(404, 'Post not found');
  }

  try {
    await pool.query(
      `INSERT INTO community_post_reactions (post_id, user_id, reaction_type)
      VALUES ($1, $2, 'like')`,
      [postId, auth.userId]
    );
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }
  }

  if (postRecord.author_user_id !== auth.userId) {
    await createNotification({
      userId: postRecord.author_user_id,
      actorUserId: auth.userId,
      type: 'post_liked',
      entityType: 'community_post',
      entityId: postId,
      payload: {}
    });
  }

  return getPostById(postId, auth.userId);
}

async function removePostReaction(auth, postId) {
  requireAuthUser(auth);

  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  await pool.query(
    `DELETE FROM community_post_reactions
    WHERE post_id = $1
      AND user_id = $2
      AND reaction_type = 'like'`,
    [postId, auth.userId]
  );

  return getPostById(postId, auth.userId);
}

async function listPostComments(postId) {
  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  const postRecord = await getPostRecordById(postId);
  if (!postRecord || postRecord.deleted_at) {
    throw createHttpError(404, 'Post not found');
  }

  const result = await pool.query(
    `SELECT
      c.id,
      c.post_id,
      c.author_user_id,
      c.content_text,
      c.created_at,
      c.updated_at,
      u.display_name AS author_display_name,
      u.avatar_url AS author_avatar_url
    FROM community_post_comments c
    INNER JOIN users u ON u.id = c.author_user_id
    WHERE c.post_id = $1
      AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC`,
    [postId]
  );

  return result.rows.map(mapCommentRow);
}

async function createPostComment(auth, postId, data) {
  requireAuthUser(auth);

  if (!isUuid(postId)) {
    throw createHttpError(400, 'Invalid post id');
  }

  const postRecord = await getPostRecordById(postId);
  if (!postRecord || postRecord.deleted_at) {
    throw createHttpError(404, 'Post not found');
  }

  const validated = validateCommentPayload(data);
  await pool.query(
    `INSERT INTO community_post_comments (
      post_id,
      author_user_id,
      content_text
    )
    VALUES ($1, $2, $3)`,
    [postId, auth.userId, validated.content]
  );

  if (postRecord.author_user_id !== auth.userId) {
    await createNotification({
      userId: postRecord.author_user_id,
      actorUserId: auth.userId,
      type: 'post_commented',
      entityType: 'community_post',
      entityId: postId,
      payload: {}
    });
  }

  return listPostComments(postId);
}

async function followUser(auth, followeeUserId) {
  requireAuthUser(auth);

  if (!isUuid(followeeUserId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  if (followeeUserId === auth.userId) {
    throw createHttpError(400, 'You cannot follow yourself');
  }

  const targetUserResult = await pool.query(
    'SELECT id FROM users WHERE id = $1 LIMIT 1',
    [followeeUserId]
  );

  if (!targetUserResult.rows[0]) {
    throw createHttpError(404, 'User not found');
  }

  try {
    await pool.query(
      `INSERT INTO community_follows (follower_user_id, followee_user_id)
      VALUES ($1, $2)`,
      [auth.userId, followeeUserId]
    );
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }
  }

  await createNotification({
    userId: followeeUserId,
    actorUserId: auth.userId,
    type: 'followed',
    entityType: 'user',
    entityId: followeeUserId,
    payload: {}
  });

  return { ok: true };
}

async function unfollowUser(auth, followeeUserId) {
  requireAuthUser(auth);

  if (!isUuid(followeeUserId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  await pool.query(
    `DELETE FROM community_follows
    WHERE follower_user_id = $1
      AND followee_user_id = $2`,
    [auth.userId, followeeUserId]
  );

  await createNotification({
    userId: followeeUserId,
    actorUserId: auth.userId,
    type: 'unfollowed',
    entityType: 'user',
    entityId: followeeUserId,
    payload: {}
  });

  return { ok: true };
}

async function listFollowers(userId) {
  if (!isUuid(userId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  const result = await pool.query(
    `SELECT
      f.created_at,
      u.id AS user_id,
      u.display_name,
      u.avatar_url
    FROM community_follows f
    INNER JOIN users u ON u.id = f.follower_user_id
    WHERE f.followee_user_id = $1
    ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows.map(mapFollowRow);
}

async function listFollowing(userId) {
  if (!isUuid(userId)) {
    throw createHttpError(400, 'Invalid user id');
  }

  const result = await pool.query(
    `SELECT
      f.created_at,
      u.id AS user_id,
      u.display_name,
      u.avatar_url
    FROM community_follows f
    INNER JOIN users u ON u.id = f.followee_user_id
    WHERE f.follower_user_id = $1
    ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows.map(mapFollowRow);
}

function mapPostToLegacyLfg(post) {
  return {
    id: post.id,
    type: post.metadata?.type || 'player',
    title: post.title || '',
    description: post.content || '',
    system: post.metadata?.system || 'Any',
    format: post.metadata?.format || 'online',
    schedule: post.metadata?.schedule || '',
    author: post.author,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

async function listLfgPosts(query) {
  const limit = parseLimit(query?.limit, 30, 100);

  const result = await pool.query(
    `SELECT
      p.id,
      p.author_user_id,
      p.post_kind,
      p.title,
      p.content_text,
      p.visibility,
      p.metadata,
      p.created_at,
      p.updated_at,
      u.display_name AS author_display_name,
      u.avatar_url AS author_avatar_url,
      0::int AS reactions_count,
      0::int AS comments_count,
      false AS viewer_has_liked
    FROM community_posts p
    INNER JOIN users u ON u.id = p.author_user_id
    WHERE p.post_kind = 'lfg'
      AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => mapPostToLegacyLfg(mapPostRow(row)));
}

async function createLfgPost(auth, data) {
  requireAuthUser(auth);
  const validated = validateLfgCreatePayload(data);
  const post = await createPost(auth, {
    kind: 'lfg',
    title: validated.title,
    content: validated.description,
    metadata: {
      type: validated.type,
      system: validated.system,
      format: validated.format,
      schedule: validated.schedule
    }
  });

  return mapPostToLegacyLfg(post);
}

module.exports = {
  listFeed,
  getMySummary,
  getUserSummary,
  listMyNotifications,
  markNotificationsRead,
  createPost,
  updatePost,
  deletePost,
  addPostReaction,
  removePostReaction,
  listPostComments,
  createPostComment,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  listLfgPosts,
  createLfgPost
};
