/**
 * Почтовый слой (T3.1).
 *
 * Если SMTP настроен в .env (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, MAIL_FROM) —
 * письма уходят через nodemailer. Если нет — dev-режим: письмо сохраняется файлом
 * в var/outbox/<timestamp>-<тип>.html и пишется строка в лог. Значения-заглушки из
 * .env.example (smtp.example.com и т.п.) считаются «SMTP не настроен».
 *
 * Как включить настоящую отправку — docs/email-setup.md.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const env = require('../config/env');

const OUTBOX_DIR = path.join(__dirname, '..', '..', 'var', 'outbox');

// Заглушки из .env.example — с ними SMTP считается не настроенным.
const PLACEHOLDER_VALUES = new Set([
  'smtp.example.com',
  'example_user',
  'example_pass',
  'no-reply@example.com'
]);

function isSmtpConfigured() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    return false;
  }

  if (PLACEHOLDER_VALUES.has(env.smtpHost) || PLACEHOLDER_VALUES.has(env.smtpUser)) {
    return false;
  }

  return true;
}

let cachedTransport = null;

function getTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });
  }

  return cachedTransport;
}

function getFromAddress() {
  return env.mailFrom || env.smtpUser || 'no-reply@localhost';
}

function sanitizeTypeForFilename(type) {
  return String(type || 'mail').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'mail';
}

async function writeToOutbox({ to, subject, html, text, type }) {
  await fs.promises.mkdir(OUTBOX_DIR, { recursive: true });

  const fileName = `${Date.now()}-${sanitizeTypeForFilename(type)}.html`;
  const filePath = path.join(OUTBOX_DIR, fileName);

  const meta = [
    '<!--',
    `  To: ${to}`,
    `  Subject: ${subject}`,
    `  Type: ${type}`,
    `  Date: ${new Date().toISOString()}`,
    '-->'
  ].join('\n');

  const textBlock = text
    ? `\n<!-- TEXT VERSION\n${String(text).replace(/-->/g, '-- >')}\n-->`
    : '';

  await fs.promises.writeFile(filePath, `${meta}\n${html}${textBlock}\n`, 'utf8');

  return filePath;
}

/**
 * Отправить письмо.
 * @param {{ to: string, subject: string, html: string, text?: string, type?: string }} message
 * @returns {Promise<{ delivery: 'smtp'|'outbox', file?: string }>}
 */
async function sendMail(message) {
  const { to, subject, html, text, type = 'generic' } = message || {};

  if (!to || !subject || !html) {
    throw new Error('sendMail: to, subject and html are required');
  }

  if (isSmtpConfigured()) {
    await getTransport().sendMail({
      from: getFromAddress(),
      to,
      subject,
      html,
      text: text || undefined
    });

    console.log(`[mail] sent via SMTP: type=${type} to=${to}`);
    return { delivery: 'smtp' };
  }

  const file = await writeToOutbox({ to, subject, html, text, type });
  console.log(`[mail] SMTP not configured, письмо сохранено в ${file}`);
  return { delivery: 'outbox', file };
}

module.exports = {
  sendMail,
  isSmtpConfigured,
  OUTBOX_DIR
};
