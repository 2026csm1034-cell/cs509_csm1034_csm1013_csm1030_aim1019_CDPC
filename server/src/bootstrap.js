// Runs before the server starts: creates tables if missing and loads demo data on an empty database.
require('dotenv').config();
const { pool } = require('./db');
const { applySchema } = require('../db/init');

(async () => {
  let tries = 0;
  for (;;) {
    try { await pool.query('SELECT 1'); break; }
    catch (e) {
      if (++tries > 30) { console.error('Cannot reach PostgreSQL:', e.message); process.exit(1); }
      console.log('Waiting for PostgreSQL...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await applySchema();
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (rows[0].n === 0) {
    console.log('Empty database - loading demo data');
    await require('../db/seed').seed();
  }
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
