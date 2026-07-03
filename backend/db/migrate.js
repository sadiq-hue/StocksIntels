require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('@localhost')
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

async function migrate() {
  const filePath = path.join(__dirname, 'migration_stock_statements.sql');
  const sql = fs.readFileSync(filePath, 'utf-8');
  console.log('Running migration: NSE Stock Financial Statements...');
  try {
    await pool.query(sql);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
