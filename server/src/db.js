require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
types.setTypeParser(20, (v) => parseInt(v, 10));  // BIGINT (counts) -> number
types.setTypeParser(1082, (v) => v);              // DATE stays 'YYYY-MM-DD'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://cpda:cpda123@localhost:5432/cpda_portal',
});

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

module.exports = { pool, tx, HttpError };
