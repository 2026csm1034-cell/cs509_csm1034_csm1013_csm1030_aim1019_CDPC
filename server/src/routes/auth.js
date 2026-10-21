const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, HttpError } = require('../db');
const { auth, ah, sign, publicUser } = require('../middleware/auth');
const { ROLE_LABELS } = require('../workflow');
const { audit } = require('../services/notify');

const withLabel = (u) => ({ ...publicUser(u), role_label: ROLE_LABELS[u.role] });

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query(
    `SELECT u.*, d.code AS dept_code, d.name AS dept_name FROM users u LEFT JOIN departments d ON d.id=u.department_id
     WHERE lower(u.email)=lower($1) AND u.active`, [email || '']);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) throw new HttpError(401, 'Wrong email or password');
  res.cookie('token', sign(u), { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  await audit(pool, u, 'auth.login', 'user', u.id);
  res.json({ user: withLabel(u) });
}));

router.get('/me', auth, (req, res) => res.json({ user: withLabel(req.user) }));

router.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

router.post('/change-password', auth, ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  if (!(await bcrypt.compare(current || '', req.user.password_hash))) throw new HttpError(400, 'Current password is wrong');
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(next, 10), req.user.id]);
  await audit(pool, req.user, 'auth.password_change', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
