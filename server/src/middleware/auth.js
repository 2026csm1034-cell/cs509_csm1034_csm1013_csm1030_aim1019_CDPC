const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function auth(req, res, next) {
  try {
    const t = req.cookies && req.cookies.token;
    if (!t) throw new Error('no token');
    const p = jwt.verify(t, SECRET);
    const { rows } = await pool.query(
      `SELECT u.*, d.code AS dept_code, d.name AS dept_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id WHERE u.id=$1 AND u.active`, [p.id]);
    if (!rows[0]) throw new Error('no user');
    req.user = rows[0];
    next();
  } catch (e) {
    res.status(401).json({ error: 'Please log in' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to this' });

const sign = (u) => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '8h' });
const publicUser = (u) => { const { password_hash, ...rest } = u; return rest; };

module.exports = { auth, requireRole, ah, sign, publicUser };
