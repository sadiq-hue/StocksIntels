const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Only force SSL for non-localhost connections
const isLocal = !connectionString || connectionString.includes('@localhost') || connectionString.includes('@127.0.0.1');

const pool = new Pool(
  connectionString
    ? { connectionString, max: Number(process.env.DB_POOL_MAX || 25), connectionTimeoutMillis: Number(process.env.DB_POOL_TIMEOUT || 10000), idleTimeoutMillis: Number(process.env.DB_POOL_IDLE || 30000), ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }) }
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

// Keep the connection pool warm. The first DB query after a cold start (or after
// the pool's idleTimeoutMillis elapses) pays a ~2s Postgres connection-
// establishment cost, which makes the financials page feel slow on first load.
// Pre-warm a couple of connections at boot and ping the pool on an interval
// shorter than idleTimeoutMillis so an interactive user never hits a cold
// connection for a single-stock lookup.
function keepAlivePing() { pool.query('SELECT 1').catch(() => {}); }
keepAlivePing();
keepAlivePing();
const keepAliveMs = Math.max(5000, (Number(process.env.DB_POOL_IDLE || 30000)) - 5000);
const keepAliveTimer = setInterval(keepAlivePing, keepAliveMs);
if (typeof keepAliveTimer.unref === 'function') keepAliveTimer.unref();

module.exports = {
  pool,
  testConnection
};
