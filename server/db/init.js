require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const { DEFAULT_SETTINGS } = require('../src/rules');

async function applySchema({ reset } = {}) {
  if (reset) await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  for (const [k, [v, d]] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query('INSERT INTO settings(key,value,description) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING', [k, v, d]);
  }
}

module.exports = { applySchema };

if (require.main === module) {
  applySchema({ reset: process.argv.includes('--reset') })
    .then(() => { console.log('Database schema ready'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
