require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  pgHost: process.env.PGHOST || 'localhost',
  pgPort: Number(process.env.PGPORT) || 55432,
  pgDatabase: process.env.PGDATABASE,
  pgUser: process.env.PGUSER,
  pgPassword: process.env.PGPASSWORD,
  frontendUrl: process.env.FRONTEND_URL || 'http://127.0.0.1:8000',
  // Дополнительные origin для CORS через запятую (например, второй домен на проде)
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d',

  // Почта (T3.1). Если SMTP_* не заданы — dev-режим: письма пишутся в var/outbox/.
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || '',

  // OAuth (T3.4). Провайдер включается, когда заданы его CLIENT_ID и SECRET.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  vkidClientId: process.env.VKID_CLIENT_ID || '',
  vkidClientSecret: process.env.VKID_CLIENT_SECRET || '',
  // База для redirect URI коллбэков (адрес бэкенда, как его видит браузер)
  oauthCallbackBase: process.env.OAUTH_CALLBACK_BASE || `http://localhost:${process.env.PORT || 4000}`
};
