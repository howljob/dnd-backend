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
  // T8.4: сколько дней ждём ответа мастера на запрос передачи игры.
  // Допущение (подтвердить у пользователя): 7 дней по умолчанию.
  transferTimeoutDays: Number(process.env.TRANSFER_TIMEOUT_DAYS) || 7
};
