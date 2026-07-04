const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — auth/sync endpoints will fail until it is.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed Postgres requires SSL; disable the (unnecessary, for
  // our purposes) certificate verification so this works without extra setup.
  ssl: process.env.DATABASE_URL && process.env.PGSSL !== 'false'
    ? { rejectUnauthorized: false }
    : false
});

module.exports = { pool };
