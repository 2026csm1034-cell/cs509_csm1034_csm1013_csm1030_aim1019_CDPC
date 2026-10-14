const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, tx, HttpError } = require('../db');
const { auth, requireRole, ah, publicUser } = require('../middleware/auth');
const { getSettings, DEFAULT_SETTINGS, fyOf, blockLabel, todayStr, proRataTable } = require('../rules');
const ledger = require('../services/ledger');
const { audit } = require('../services/notify');
const { ROLE_LABELS } = require('../workflow');

router.use(auth, requireRole('ADMIN'));

// ---- users
router.get('/users', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.*, d.code AS dept_code FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.role, u.name`);
  res.json(rows.map((r) => ({ ...publicUser(r), role_label: ROLE_LABELS[r.role] })));
}));

function userFields(b) {
  if (!b.name || !b.email || !b.emp_code) throw new HttpError(400, 'Name, email and employee code are required');
  if (!ROLE_LABELS[b.role]) throw new HttpError(400, 'Invalid role');
  return [b.name.trim(), b.email.trim().toLowerCase(), b.emp_code.trim(), b.role, b.department_id || null, b.designation || null,
    b.doj || null, b.dor || null, b.dor ? b.exit_type || 'RETIRE' : null, !!b.opted_out_joining_year,
    b.probation_cleared !== false, !!b.on_leave_over_30, b.active !== false];
}

router.post('/users', ah(async (req, res) => {
  const f = userFields(req.body);
  const hash = await bcrypt.hash(req.body.password || 'Welcome@123', 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(name,email,emp_code,role,department_id,designation,doj,dor,exit_type,opted_out_joining_year,probation_cleared,on_leave_over_30,active,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [...f, hash]);
    await audit(pool, req.user, 'user.create', 'user', rows[0].id, { email: f[1], role: f[3] });
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Email or employee code already exists');
    throw e;
  }
}));

router.put('/users/:id', ah(async (req, res) => {
  const f = userFields(req.body);
  await pool.query(
    `UPDATE users SET name=$1,email=$2,emp_code=$3,role=$4,department_id=$5,designation=$6,doj=$7,dor=$8,exit_type=$9,
      opted_out_joining_year=$10,probation_cleared=$11,on_leave_over_30=$12,active=$13 WHERE id=$14`, [...f, Number(req.params.id)]);
  if (req.body.password) await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(req.body.password, 10), Number(req.params.id)]);
  await audit(pool, req.user, 'user.update', 'user', Number(req.params.id), { role: f[3], active: f[12] });
  res.json({ ok: true });
}));

router.post('/departments', ah(async (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) throw new HttpError(400, 'Code and name are required');
  try { await pool.query('INSERT INTO departments(code,name) VALUES ($1,$2)', [code.trim().toUpperCase(), name.trim()]); }
  catch (e) { if (e.code === '23505') throw new HttpError(409, 'Department code already exists'); throw e; }
  res.status(201).json({ ok: true });
}));

// ---- rules as data
router.get('/settings', ah(async (req, res) => {
  const s = await getSettings();
  res.json(Object.keys(DEFAULT_SETTINGS).map((k) => ({ key: k, value: s[k], description: DEFAULT_SETTINGS[k][1] })));
}));
router.put('/settings', ah(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!DEFAULT_SETTINGS[k]) continue;
    if (!(Number(v) >= 0)) throw new HttpError(400, `Invalid value for ${k}`);
    await pool.query(
      'INSERT INTO settings(key,value,description) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, Number(v), DEFAULT_SETTINGS[k][1]]);
  }
  await audit(pool, req.user, 'settings.update', 'settings', null, req.body);
  res.json({ ok: true });
}));

// ---- blocks, allocation, carry-forward
router.get('/blocks', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*, (SELECT COUNT(*) FROM cpda_accounts a WHERE a.block_id=b.id) AS accounts FROM cpda_blocks b ORDER BY b.start_fy DESC`);
  res.json(rows);
}));

router.post('/blocks', ah(async (req, res) => {
  const start = Number(req.body.start_fy);
  if (!(start >= 2000 && start <= 2100)) throw new HttpError(400, 'Enter a valid start year');
  try {
    await pool.query('INSERT INTO cpda_blocks(start_fy,end_fy,label) VALUES ($1,$2,$3)', [start, start + 2, blockLabel(start, start + 2)]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'That block already exists'); throw e; }
  await audit(pool, req.user, 'block.create', 'block', null, { start });
  res.status(201).json({ ok: true });
}));

router.post('/blocks/:id/activate', ah(async (req, res) => {
  await tx(async (c) => {
    await c.query('UPDATE cpda_blocks SET active=false');
    const r = await c.query('UPDATE cpda_blocks SET active=true WHERE id=$1', [Number(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Block not found');
  });
  await audit(pool, req.user, 'block.activate', 'block', Number(req.params.id));
  res.json({ ok: true });
}));

// Create accounts for every active faculty / HoD and credit allocations up to the current FY
router.post('/blocks/:id/init-accounts', ah(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows: bl } = await c.query('SELECT * FROM cpda_blocks WHERE id=$1', [Number(req.params.id)]);
    if (!bl[0]) throw new HttpError(404, 'Block not found');
    const r = await ledger.initBlockAccounts(c, bl[0], await getSettings(c), req.user.id);
    await audit(c, req.user, 'block.init_accounts', 'block', bl[0].id, r);
    return r;
  });
  res.json(out);
}));

router.post('/blocks/:id/allocate-fy', ah(async (req, res) => {
  const fy = Number(req.body.fy);
  const out = await tx(async (c) => {
    const { rows: bl } = await c.query('SELECT * FROM cpda_blocks WHERE id=$1', [Number(req.params.id)]);
    const block = bl[0];
    if (!block) throw new HttpError(404, 'Block not found');
    if (!(fy >= block.start_fy && fy <= block.end_fy)) throw new HttpError(400, 'FY is outside this block');
    const settings = await getSettings(c);
    const { rows } = await c.query('SELECT a.*, row_to_json(u) AS u FROM cpda_accounts a JOIN users u ON u.id=a.user_id WHERE a.block_id=$1 AND u.active', [block.id]);
    let credited = 0;
    for (const a of rows) if (await ledger.allocateFy(c, a, a.u, fy, settings, req.user.id)) credited++;
    await audit(c, req.user, 'block.allocate_fy', 'block', block.id, { fy, credited });
    return { credited };
  });
  res.json(out);
}));

// Carry unspent balance of the previous block, capped (Guideline 4)
router.post('/blocks/:id/carry-forward', ah(async (req, res) => {
  const out = await tx(async (c) => {
    const toId = Number(req.params.id);
    const fromId = Number(req.body.from_block_id);
    const { rows: tb } = await c.query('SELECT * FROM cpda_blocks WHERE id=$1', [toId]);
    const { rows: fb } = await c.query('SELECT * FROM cpda_blocks WHERE id=$1', [fromId]);
    if (!tb[0] || !fb[0]) throw new HttpError(404, 'Block not found');
    if (fromId === toId) throw new HttpError(400, 'Choose a different block to carry forward from');
    const r = await ledger.carryForward(c, fb[0], tb[0], await getSettings(c), req.user.id);
    await audit(c, req.user, 'block.carry_forward', 'block', toId, { from: fromId, ...r });
    return r;
  });
  res.json(out);
}));

// ---- pro-rata for a real user
router.get('/prorata/user/:id', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  const { rows: bl } = await pool.query('SELECT * FROM cpda_blocks WHERE active');
  const s = await getSettings();
  res.json({ block: bl[0], rows: proRataTable(rows[0], bl[0].start_fy, bl[0].end_fy, s.yearly_entitlement) });
}));

router.get('/audit', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
  res.json(rows);
}));

module.exports = router;
