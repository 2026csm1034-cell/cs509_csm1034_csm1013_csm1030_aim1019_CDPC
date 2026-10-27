const Module = require('module');
const path = require('path');
process.env.GOOGLE_CLIENT_ID = 'cid-123.apps.googleusercontent.com';
process.env.JWT_SECRET = 'x';
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
let db = { users: [], queries: [] };
const pool = { query: async (sql, args) => {
  if (/FROM users WHERE lower\(email\)/.test(sql)) return { rows: db.users.filter((u) => u.email === args[0].toLowerCase() || (u.google_sub && u.google_sub === args[1])).slice(0, 1) };
  if (/INSERT INTO users/.test(sql)) { const u = { id: db.users.length + 100, emp_code: args[0], name: args[1], email: args[2], google_sub: args[4], role: 'FACULTY', active: false }; db.users.push(u); return { rows: [u] }; }
  if (/UPDATE users SET google_sub/.test(sql)) { db.users.find((u) => u.id === args[1]).google_sub = args[0]; return { rows: [] }; }
  if (/LEFT JOIN departments d ON d.id=u.department_id WHERE u.id/.test(sql)) return { rows: [{ ...db.users.find((u) => u.id === args[0]), dept_code: 'CSE', dept_name: 'Computer Science' }] };
  return { rows: [] };
} };
const stubs = {
  express: () => ({ Router: () => { const r = { routes: {}, post(p, ...h) { r.routes['POST ' + p] = h; }, get(p, ...h) { r.routes['GET ' + p] = h; } }; return r; } }),
  bcryptjs: { hash: async () => 'h', compare: async () => true },
  jsonwebtoken: { sign: () => 'jwt', verify: () => ({}) },
  dotenv: { config() {} },
};
stubs.express = Object.assign(() => ({}), { Router: () => { const r = { routes: {}, post(p, ...h) { r.routes['POST ' + p] = h; }, get(p, ...h) { r.routes['GET ' + p] = h; } }; return r; } });
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (stubs[req]) return stubs[req];
  if (/\.\.\/db$/.test(req)) return { pool, HttpError };
  if (/services\/notify$/.test(req)) return { audit: async () => {}, notify: async () => {} };
  if (/middleware\/auth$/.test(req)) return { auth: (q, s, n) => n(), ah: (fn) => fn, sign: () => 'tok', publicUser: (u) => u };
  return orig.call(this, req, parent, ...rest);
};
const router = require('../src/routes/auth.js');
const handler = router.routes['POST /google'][0];

const goodClaims = (o = {}) => ({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: 'sub-1', email: 'Prof@iitrpr.ac.in', email_verified: 'true', name: 'Prof X', exp: String(Math.floor(Date.now() / 1000) + 3600), ...o });
let tokeninfo = goodClaims();
global.fetch = async () => ({ ok: tokeninfo !== null, json: async () => tokeninfo });
const run = async (body = { credential: 'x'.repeat(40) }) => {
  const res = { code: 200, body: null, cookies: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, cookie(k, v) { this.cookies[k] = v; } };
  try { await handler({ body }, res); } catch (e) { res.code = e.status; res.body = { error: e.message }; }
  return res;
};
const results = []; const t = (name, ok, extra = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  -> ' + extra : '')); };
(async () => {
  let r = await run({ credential: 'short' }); t('rejects missing/short credential (400)', r.code === 400);
  tokeninfo = null; r = await run(); t('rejects token Google refuses (401)', r.code === 401);
  tokeninfo = goodClaims({ aud: 'someone-elses-client' }); r = await run(); t('rejects wrong audience / invalid_client token (401)', r.code === 401);
  tokeninfo = goodClaims({ iss: 'https://evil.example' }); r = await run(); t('rejects wrong issuer (401)', r.code === 401);
  tokeninfo = goodClaims({ exp: String(Math.floor(Date.now() / 1000) - 10) }); r = await run(); t('rejects expired token (401)', r.code === 401);
  tokeninfo = goodClaims({ email_verified: 'false' }); r = await run(); t('rejects unverified email (401)', r.code === 401);
  tokeninfo = goodClaims(); r = await run(); t('NEW Google user -> created inactive, 403 awaiting approval, no cookie', r.code === 403 && /awaiting/.test(r.body.error) && !r.cookies.token && db.users.length === 1 && db.users[0].active === false && db.users[0].role === 'FACULTY' && /^GOOGLE_/.test(db.users[0].emp_code), JSON.stringify(r.body));
  r = await run(); t('same user again -> still 403 and NOT duplicated', r.code === 403 && db.users.length === 1);
  db.users[0].active = true; r = await run(); t('after admin approves (active) -> login OK, cookie set', r.code === 200 && r.cookies.token === 'tok' && r.body.user.email === 'prof@iitrpr.ac.in', r.body.user && r.body.user.dept_code);
  db.users.push({ id: 7, emp_code: 'E7', name: 'Pre-made', email: 'premade@iitrpr.ac.in', google_sub: null, role: 'HOD', active: true });
  tokeninfo = goodClaims({ sub: 'sub-77', email: 'premade@iitrpr.ac.in' }); r = await run(); t('admin pre-created user logs in by email and links Google id', r.code === 200 && db.users.find((u) => u.id === 7).google_sub === 'sub-77');
  tokeninfo = goodClaims({ sub: 'sub-OTHER', email: 'premade@iitrpr.ac.in' }); r = await run(); t('same email from a different Google account is refused (409)', r.code === 409);
  process.env.GOOGLE_ALLOWED_DOMAIN = 'iitrpr.ac.in'; tokeninfo = goodClaims({ sub: 's9', email: 'x@gmail.com' }); r = await run(); t('domain restriction blocks gmail.com (403)', r.code === 403);
  tokeninfo = goodClaims({ sub: 's10', email: 'ok@iitrpr.ac.in' }); r = await run(); t('domain restriction allows iitrpr.ac.in (reaches approval step)', r.code === 403 && /awaiting/.test(r.body.error));
  delete process.env.GOOGLE_CLIENT_ID; r = await run(); t('no GOOGLE_CLIENT_ID on server -> 503 clear message', r.code === 503);
  console.log(results.every(Boolean) ? '\nALL GOOGLE-LOGIN LOGIC TESTS PASSED' : '\nSOME TESTS FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
