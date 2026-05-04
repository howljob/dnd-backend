const { Pool } = require('pg');
const env = require('../config/env');

const pool = new Pool({
  host: env.pgHost,
  port: env.pgPort,
  database: env.pgDatabase,
  user: env.pgUser,
  password: env.pgPassword
});

module.exports = pool;
