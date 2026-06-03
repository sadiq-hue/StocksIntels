const { Pool } = require('pg');
const p = new Pool({connectionString: 'postgresql://stockintel:stockintel@localhost:5432/stockintel'});
p.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'paper_trades'").then(r => {
  r.rows.forEach(c => console.log(c.column_name, c.data_type, c.udt_name));
  p.end();
}).catch(e => { console.error(e.message); p.end(); });
