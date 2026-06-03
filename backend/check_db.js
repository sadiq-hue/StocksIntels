const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://stockintel:stockintel@localhost:5432/stockintel' });

async function main() {
  const users = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
  console.log('users columns:', JSON.stringify(users.rows, null, 2));
  
  const data = await pool.query('SELECT id, email FROM users LIMIT 5');
  console.log('users data:', JSON.stringify(data.rows, null, 2));
  
  const fk = await pool.query("SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'paper_accounts'::regclass AND contype = 'f'");
  console.log('paper_accounts FK:', JSON.stringify(fk.rows, null, 2));
  
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
