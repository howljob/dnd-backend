/**
 * T5.2 — файловое хранилище портретов персонажей (uploads/portraits).
 * База хранит только относительный путь (portrait_path), файлы раздаются
 * статикой /uploads/portraits.
 */

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const UPLOADS_PORTRAITS_DIR = path.join(process.cwd(), 'uploads', 'portraits');
const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function portraitUrl(portraitPath) {
  const name = path.basename(String(portraitPath || '').trim());
  if (!name) return null;
  return `/uploads/portraits/${name}`;
}

async function savePortraitBuffer(buffer, mime) {
  const normalizedMime = String(mime || '').toLowerCase();
  const ext = ALLOWED_IMAGE_MIME.get(normalizedMime);
  if (!ext) {
    throw createHttpError(400, 'Portrait must be an image (png, jpeg, webp, gif)');
  }
  if (!buffer || !buffer.length) {
    throw createHttpError(400, 'Portrait file is empty');
  }
  if (buffer.length > MAX_PORTRAIT_BYTES) {
    throw createHttpError(400, 'Portrait file is too large (max 2 MB)');
  }

  await fs.mkdir(UPLOADS_PORTRAITS_DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  await fs.writeFile(path.join(UPLOADS_PORTRAITS_DIR, name), buffer);
  return name;
}

/** Конвертация легаси data-URL портрета (из старого JSON-листа) в файл. */
async function saveDataUrlPortrait(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(String(dataUrl || '').trim());
  if (!match) {
    throw createHttpError(400, 'Portrait data URL is invalid');
  }
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  return savePortraitBuffer(buffer, mime);
}

/** Безопасное удаление: только имя файла, только внутри uploads/portraits. */
async function deletePortraitFile(portraitPath) {
  const name = path.basename(String(portraitPath || '').trim());
  if (!name) return;
  try {
    await fs.unlink(path.join(UPLOADS_PORTRAITS_DIR, name));
  } catch {
    // Файл уже отсутствует — не считаем ошибкой.
  }
}

async function statPortraitBytes(portraitPath) {
  const name = path.basename(String(portraitPath || '').trim());
  if (!name) return 0;
  try {
    const stat = await fs.stat(path.join(UPLOADS_PORTRAITS_DIR, name));
    return stat.size;
  } catch {
    return 0;
  }
}

module.exports = {
  UPLOADS_PORTRAITS_DIR,
  MAX_PORTRAIT_BYTES,
  ALLOWED_IMAGE_MIME,
  portraitUrl,
  savePortraitBuffer,
  saveDataUrlPortrait,
  deletePortraitFile,
  statPortraitBytes
};
