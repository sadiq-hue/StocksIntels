const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? { connectionString, max: Number(process.env.DB_POOL_MAX || 25), connectionTimeoutMillis: Number(process.env.DB_POOL_TIMEOUT || 10000), idleTimeoutMillis: Number(process.env.DB_POOL_IDLE || 30000), ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'stockintel',
        password: process.env.DB_PASSWORD || 'stockintel',
        database: process.env.DB_NAME || 'stockintel',
        max: Number(process.env.DB_POOL_MAX || 25),
        connectionTimeoutMillis: Number(process.env.DB_POOL_TIMEOUT || 10000),
        idleTimeoutMillis: Number(process.env.DB_POOL_IDLE || 30000)
      }
);

async function testConnection() {
  const result = await pool.query('SELECT NOW() AS server_time');
  return result.rows[0];
}

module.exports = {
  pool,
  testConnection
};
