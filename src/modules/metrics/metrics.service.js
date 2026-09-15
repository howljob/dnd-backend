/**
 * T5.7 — продуктовые метрики (таблица metrics_events).
 *
 * Первое событие: storage_limit_approach — суммарный размер файлов
 * пользователя (аватар + портреты персонажей + карты его игр) превысил 80%
 * лимита STORAGE_LIMIT_MB из .env (дефолт 100 МБ).
 *
 * Метрики никогда не должны ломать основной сценарий: все ошибки здесь
 * глотаются с console.error.
 */

const path = require('path');
const fs = require('fs/promises');
const pool = require('../../db/pool');
const env = require('../../config/env');
const { estimateDataUrlBytes } = require('../profile/character-sheet');
const { statPortraitBytes } = require('../profile/portrait-storage');

const UPLOADS_VTT_DIR = path.join(process.cwd(), 'uploads', 'vtt');
const UPLOADS_AVATARS_DIR = path.join(process.cwd(), 'uploads', 'avatars');
const DEDUP_HOURS = 24;

async function recordEvent(name, userId, payload = {}) {
  await pool.query(
    `INSERT INTO metrics_events (name, user_id, payload)
     VALUES ($1, $2, $3)`,
    [String(name).slice(0, 120), userId || null, payload]
  );
}

async function statFileBytes(dir, fileName) {
  const name = path.basename(String(fileName || '').trim());
  if (!name) return 0;
  try {
    const stat = await fs.stat(path.join(dir, name));
    return stat.size;
  } catch {
    return 0;
  }
}

/** Аватар: пока data-URL в users.avatar_url (файлы — трек T3), считаем оценку. */
async function computeAvatarBytes(userId) {
  const result = await pool.query(
    'SELECT avatar_url FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const avatar = String(result.rows[0]?.avatar_url || '');
  if (!avatar) return 0;
  if (avatar.startsWith('data:')) {
    return estimateDataUrlBytes(avatar);
  }
  const uploadsMatch = avatar.match(/\/uploads\/avatars\/([^/?#]+)/);
  if (uploadsMatch) {
    return statFileBytes(UPLOADS_AVATARS_DIR, uploadsMatch[1]);
  }
  return 0;
}

async function computePortraitsBytes(userId) {
  const result = await pool.query(
    `SELECT portrait_path FROM user_characters
     WHERE user_id = $1 AND portrait_path IS NOT NULL`,
    [userId]
  );
  let total = 0;
  for (const row of result.rows) {
    // eslint-disable-next-line no-await-in-loop
    total += await statPortraitBytes(row.portrait_path);
  }
  return total;
}

/** Карты: файлы /uploads/vtt, на которые ссылаются сцены игр этого мастера. */
async function computeMapsBytes(userId) {
  const result = await pool.query(
    `SELECT (ts.draft_state::text || ' ' || coalesce(ts.published_state::text, '')) AS blob
     FROM tabletop_scenes ts
     INNER JOIN games g ON g.id = ts.game_id
     WHERE g.creator_id = $1`,
    [userId]
  );

  const files = new Set();
  for (const row of result.rows) {
    const matches = String(row.blob || '').matchAll(/\/uploads\/vtt\/([a-z0-9]+\.[a-z0-9]+)/gi);
    for (const match of matches) {
      files.add(match[1]);
    }
  }

  let total = 0;
  for (const name of files) {
    // eslint-disable-next-line no-await-in-loop
    total += await statFileBytes(UPLOADS_VTT_DIR, name);
  }
  return total;
}

async function computeUserStorageBytes(userId) {
  const [avatarBytes, portraitsBytes, mapsBytes] = await Promise.all([
    computeAvatarBytes(userId),
    computePortraitsBytes(userId),
    computeMapsBytes(userId)
  ]);
  return {
    avatarBytes,
    portraitsBytes,
    mapsBytes,
    totalBytes: avatarBytes + portraitsBytes + mapsBytes
  };
}

/**
 * Проверка приближения к лимиту хранилища. Зовётся после загрузки
 * портрета/карты. Дедупликация: не чаще одного события на пользователя
 * за 24 часа.
 */
async function maybeRecordStorageLimitApproach(userId) {
  try {
    if (!userId) return null;
    const limitMb = Number(env.storageLimitMb) > 0 ? Number(env.storageLimitMb) : 100;
    const limitBytes = limitMb * 1024 * 1024;
    const usage = await computeUserStorageBytes(userId);
    if (usage.totalBytes <= limitBytes * 0.8) {
      return null;
    }

    const recent = await pool.query(
      `SELECT id FROM metrics_events
       WHERE user_id = $1
         AND name = 'storage_limit_approach'
         AND created_at > now() - ($2 || ' hours')::interval
       LIMIT 1`,
      [userId, DEDUP_HOURS]
    );
    if (recent.rows[0]) {
      return null;
    }

    const payload = {
      totalBytes: usage.totalBytes,
      avatarBytes: usage.avatarBytes,
      portraitsBytes: usage.portraitsBytes,
      mapsBytes: usage.mapsBytes,
      limitMb,
      usedPercent: Math.round((usage.totalBytes / limitBytes) * 100)
    };
    await recordEvent('storage_limit_approach', userId, payload);
    return payload;
  } catch (error) {
    console.error('metrics: storage limit check failed', error);
    return null;
  }
}

module.exports = {
  recordEvent,
  computeUserStorageBytes,
  maybeRecordStorageLimitApproach
};
