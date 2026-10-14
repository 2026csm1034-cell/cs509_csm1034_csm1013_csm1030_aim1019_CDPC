const router = require('express').Router();
const ExcelJS = require('exceljs');
const { pool, HttpError } = require('../db');
const { auth, ah } = require('../middleware/auth');
const ledger = require('../services/ledger');
const { getSettings, fyLabel } = require('../rules');

const PRIV = ['ACCOUNTS_AR', 'ACCOUNTS_JUNIOR', 'REGISTRAR', 'DEAN_FAA', 'DIRECTOR', 'ADMIN'];
router.use(auth);

async function byFy(accountId) {
  const { rows } = await pool.query(
    `SELECT fy,
       COALESCE(SUM(CASE WHEN entry_type IN ('ALLOCATION','PRORATA','ADJUSTMENT_CR') THEN amount END),0) AS allocated,
       COALESCE(SUM(CASE WHEN entry_type='CARRY_IN' THEN amount END),0) AS carry_in,
       COALESCE(SUM(CASE WHEN entry_type='EXPENDITURE' THEN amount END),0) AS spent,
       COALESCE(SUM(CASE WHEN entry_type='COMMITMENT' THEN amount WHEN entry_type='COMMITMENT_RELEASE' THEN -amount END),0) AS committed
     FROM ledger_entries WHERE account_id=$1 GROUP BY fy ORDER BY fy`, [accountId]);
  return rows.map((r) => ({ ...r, label: fyLabel(r.fy) }));
}

router.get('/me', ah(async (req, res) => {
  const acc = await ledger.getActiveAccount(req.user.id);
  if (!acc) return res.json({ account: null });
  const settings = await getSettings();
  res.json({ account: acc, summary: await ledger.summary(acc.id, pool, settings), by_fy: await byFy(acc.id), settings });
}));

router.get('/', ah(async (req, res) => {
  const u = req.user;
  if (!PRIV.includes(u.role) && u.role !== 'HOD') throw new HttpError(403, 'Not allowed');
  const params = [req.query.block_id ? Number(req.query.block_id) : null];
  let dept = '';
  if (u.role === 'HOD') { params.push(u.department_id); dept = 'AND us.department_id=$2'; }
  const { rows } = await pool.query(
    `SELECT a.id, a.block_id, b.label AS block_label, us.id AS user_id, us.name, us.emp_code, us.designation, d.code AS dept_code
     FROM cpda_accounts a JOIN cpda_blocks b ON b.id=a.block_id JOIN users us ON us.id=a.user_id
     LEFT JOIN departments d ON d.id=us.department_id
     WHERE (COALESCE($1::int, (SELECT id FROM cpda_blocks WHERE active LIMIT 1)) = a.block_id) ${dept}
     ORDER BY d.code, us.name`, params);
  const settings = await getSettings();
  const out = [];
  for (const r of rows) out.push({ ...r, summary: await ledger.summary(r.id, pool, settings) });
  res.json(out);
}));

async function loadAccount(user, id) {
  const { rows } = await pool.query(
    `SELECT a.*, b.label AS block_label, us.name, us.emp_code, us.designation, us.department_id, d.name AS dept_name, d.code AS dept_code
     FROM cpda_accounts a JOIN cpda_blocks b ON b.id=a.block_id JOIN users us ON us.id=a.user_id
     LEFT JOIN departments d ON d.id=us.department_id WHERE a.id=$1`, [id]);
  const a = rows[0];
  if (!a) throw new HttpError(404, 'Account not found');
  const ok = a.user_id === user.id || PRIV.includes(user.role) || (user.role === 'HOD' && user.department_id === a.department_id);
  if (!ok) throw new HttpError(403, 'You cannot view this account');
  return a;
}

router.get('/:id/ledger', ah(async (req, res) => {
  const a = await loadAccount(req.user, Number(req.params.id));
  const settings = await getSettings();
  res.json({ account: a, entries: await ledger.entries(a.id), summary: await ledger.summary(a.id, pool, settings), by_fy: await byFy(a.id), settings });
}));

router.get('/:id/ledger.xlsx', ah(async (req, res) => {
  const a = await loadAccount(req.user, Number(req.params.id));
  const settings = await getSettings();
  const entries = await ledger.entries(a.id);
  const sum = await ledger.summary(a.id, pool, settings);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CPDA ledger');
  ws.addRow(['Name:', a.name, '', 'Dept:', a.dept_code]);
  ws.addRow(['EMP ID:', a.emp_code]);
  ws.addRow([]);
  const t = ws.addRow([`CPDA budget and expenditure for the block year ${a.block_label}`]);
  t.font = { bold: true, size: 13 };
  ws.addRow(['I. Expenditure for National & International Conferences, Registration Fee etc.   II. Expenditure for Contingency & Membership fees etc.']);
  ws.addRow([]);
  const head = ws.addRow(['S.No', 'Date', 'FY', 'Claim No.', 'Particulars', 'Head', 'Allocated / Carry-in', 'Expenditure', 'Commitment (net)', 'Running balance']);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE6EE' } }; c.border = { bottom: { style: 'thin' } }; });
  entries.forEach((e, i) => {
    const credit = ['ALLOCATION', 'PRORATA', 'CARRY_IN', 'ADJUSTMENT_CR'].includes(e.entry_type) ? e.amount : '';
    const exp = e.entry_type === 'EXPENDITURE' ? e.amount : '';
    const com = e.entry_type === 'COMMITMENT' ? e.amount : e.entry_type === 'COMMITMENT_RELEASE' ? -e.amount : '';
    ws.addRow([i + 1, e.entry_date, fyLabel(e.fy), e.claim_no || '', e.particulars, e.bucket === 'CONFERENCE' ? 'I. Conference' : e.bucket === 'CONTINGENCY' ? 'II. Contingency' : '', credit, exp, com, e.running_balance]);
  });
  const tot = ws.addRow(['Total', '', '', '', '', '', sum.allocated + sum.carry_in, sum.expenditure, sum.commitment, sum.balance]);
  tot.font = { bold: true };
  ws.addRow([]);
  ws.addRow(['Notes']).font = { bold: true };
  ws.addRow([`* Unspent balance maximum will be carried forward of Rs ${settings.carry_forward_max.toLocaleString('en-IN')} in next block.`]);
  [8, 12, 10, 18, 52, 16, 20, 14, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ['G', 'H', 'I', 'J'].forEach((col) => { ws.getColumn(col).numFmt = '#,##0'; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="CPDA-ledger-${a.emp_code}-${a.block_label}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
