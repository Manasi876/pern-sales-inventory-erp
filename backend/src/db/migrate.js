const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate({ reset = false } = {}) {
  const sql = fs.readFileSync(path.join(__dirname, '../../sql/schema.sql'), 'utf8');
  if (reset) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await pool.query(sql);
}

module.exports = migrate;

if (require.main === module) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => { console.log('Migration complete'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
