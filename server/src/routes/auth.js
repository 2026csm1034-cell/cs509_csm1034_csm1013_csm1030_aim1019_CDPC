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
  res.cookie('token', sign(u), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 });
  await audit(pool, u, 'auth.login', 'user', u.id);
  res.json({ user: withLabel(u) });
}));

router.post('/google', ah(async (req, res) => {
  const credential = req.body && req.body.credential;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(503, 'Google sign-in is not configured on this server');
  if (typeof credential !== 'string' || credential.length < 20 || credential.length > 10000) {
    throw new HttpError(400, 'Missing or invalid Google credential');
  }

  // Verify the ID token with Google's tokeninfo endpoint; never trust profile data sent by the browser.
  let claims;
  try {
    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('id_token', credential);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Google rejected the token');
    claims = await response.json();
  } catch (_) {
    throw new HttpError(401, 'Google sign-in could not be verified. Please try again.');
  }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  const allowed = (process.env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
  if (!issOk || (claims.exp && Number(claims.exp) * 1000 < Date.now())) throw new HttpError(401, 'Google sign-in could not be verified. Please try again.');
  if (allowed && !String(claims.email || '').toLowerCase().endsWith('@' + allowed)) {
    throw new HttpError(403, `Please sign in with your @${allowed} account.`);
  }
  if (claims.aud !== clientId || !claims.sub || !claims.email ||
      !(claims.email_verified === true || claims.email_verified === 'true')) {
    throw new HttpError(401, 'Google account verification failed');
  }

  const email = String(claims.email).trim().toLowerCase();
  let { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) OR google_sub=$2 LIMIT 1', [email, claims.sub]);
  let u = rows[0];
  if (u && u.google_sub && u.google_sub !== claims.sub) {
    throw new HttpError(409, 'This email is linked to a different Google account. Contact an administrator.');
  }

  if (!u) {
    // Self-sign-up creates a disabled, least-privileged account. Admin must approve and assign its role.
    const empCode = `GOOGLE_${String(claims.sub).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`;
    const randomPassword = require('crypto').randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(randomPassword, 10);
    try {
      const created = await pool.query(
        `INSERT INTO users (emp_code,name,email,password_hash,google_sub,role,active)
         VALUES ($1,$2,$3,$4,$5,'FACULTY',false) RETURNING *`,
        [empCode, String(claims.name || email.split('@')[0]).slice(0, 200), email, hash, claims.sub]);
      u = created.rows[0];
      await audit(pool, u, 'auth.google_signup_pending', 'user', u.id, { email });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'An account with this email or Google identity already exists. Contact an administrator.');
      throw e;
    }
  } else if (!u.google_sub) {
    await pool.query('UPDATE users SET google_sub=$1 WHERE id=$2', [claims.sub, u.id]);
    u.google_sub = claims.sub;
  }

  if (!u.active) {
    return res.status(403).json({ error: 'Your account is awaiting administrator approval. Please contact the CPDA portal administrator.' });
  }
  const full = (await pool.query(
    `SELECT u.*, d.code AS dept_code, d.name AS dept_name FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=$1`, [u.id])).rows[0];
  res.cookie('token', sign(full), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 });
  await audit(pool, full, 'auth.google_login', 'user', full.id);
  res.json({ user: withLabel(full) });
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
