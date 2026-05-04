require('dotenv').config();
const pool = require('../db/pool');

async function main() {
  const rawEmail = process.argv[2];
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

  if (!email) {
    console.error('Usage: npm run admin:promote -- user@example.com');
    process.exitCode = 1;
    return;
  }

  try {
    let result;
    try {
      result = await pool.query(
        `UPDATE users
        SET role = 'admin', account_status = 'active', updated_at = now()
        WHERE email = $1
        RETURNING id, email, role, account_status`,
        [email]
      );
    } catch (error) {
      // Fallback for DBs not migrated with account_status yet.
      if (error.code !== '42703') throw error;

      result = await pool.query(
        `UPDATE users
        SET role = 'admin', updated_at = now()
        WHERE email = $1
        RETURNING id, email, role`,
        [email]
      );
    }

    if (!result.rows[0]) {
      console.error(`User not found for email: ${email}`);
      process.exitCode = 1;
      return;
    }

    console.log('Admin updated:', result.rows[0]);
  } catch (error) {
    console.error('Failed to promote admin:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
