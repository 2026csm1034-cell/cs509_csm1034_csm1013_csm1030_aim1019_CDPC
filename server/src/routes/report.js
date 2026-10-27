const router = require('express').Router();
const { pool, HttpError } = require('../db');
const { auth, requireRole, ah } = require('../middleware/auth');
const { aggregate, workbook } = require('../services/report');

router.use(auth, requireRole('HOD', 'ACCOUNTS_AR', 'ACCOUNTS_JUNIOR', 'REGISTRAR', 'DEAN_FAA', 'DIRECTOR', 'ADMIN', 'A_SECTION'));

const STATUS_SETS = {
  ALL: null, MONEY: ['APPROVED', 'PAID'], IN_REVIEW: ['IN_REVIEW'], APPROVED: ['APPROVED'], PAID: ['PAID'], REJECTED: ['REJECTED'], RETURNED: ['RETURNED'],
};
const STATUS_LABEL = { ALL: 'All submitted', MONEY: 'Approved + paid', IN_REVIEW: 'In review', APPROVED: 'Approved (unpaid)', PAID: 'Paid', REJECTED: 'Rejected', RETURNED: 'Returned' };
const int = (v, lo, hi) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, 'Invalid filter value'); return n; };

async function load(user, q) {
  const f = {
    dept: user.role === 'HOD' ? user.department_id : int(q.dept, 1, 1e6),   // a HoD only ever sees the own department
    fy: int(q.fy, 2000, 2200), year: int(q.year, 2000, 2200), month: int(q.month, 1, 12), week: int(q.week, 1, 53),
    status: Object.keys(STATUS_SETS).includes(q.status) ? q.status : 'ALL', basis: q.basis === 'paid' ? 'paid' : 'submitted',
  };
  const tsExpr = f.basis === 'paid' ? 'c.paid_at' : 'COALESCE(c.submitted_at, c.updated_at)';
  const T = `(${tsExpr} AT TIME ZONE 'Asia/Kolkata')`;
  const where = [`c.status <> 'DRAFT'`, `${tsExpr} IS NOT NULL`]; const params = [];
  const push = (cond, v) => { params.push(v); where.push(cond.replace('$?', () => '$' + params.length)); };
  if (f.dept) push('us.department_id = $?', f.dept);
  if (f.fy) push(`EXTRACT(YEAR FROM (${T} - INTERVAL '3 months'))::int = $?`, f.fy);
  if (f.year) push(`EXTRACT(YEAR FROM ${T})::int = $?`, f.year);
  if (f.month) push(`EXTRACT(MONTH FROM ${T})::int = $?`, f.month);
  if (f.week) push(`EXTRACT(WEEK FROM ${T})::int = $?`, f.week);
  if (STATUS_SETS[f.status]) push('c.status = ANY($?::text[])', STATUS_SETS[f.status]);
  const { rows } = await pool.query(
    `SELECT c.id, c.claim_no, c.kind, c.title, c.status, c.total, c.amount_passed, c.submitted_at, c.paid_at,
        us.id AS user_id, us.name, us.emp_code, d.code AS dept_code, d.name AS dept_name, b.label AS block_label,
        EXTRACT(YEAR FROM (${T} - INTERVAL '3 months'))::int AS fy,
        EXTRACT(YEAR FROM ${T})::int AS year, EXTRACT(MONTH FROM ${T})::int AS month,
        to_char(${T}, 'IYYY-"W"IW') AS week_label
       FROM claims c JOIN users us ON us.id = c.user_id LEFT JOIN departments d ON d.id = us.department_id
       JOIN cpda_accounts a ON a.id = c.account_id JOIN cpda_blocks b ON b.id = a.block_id
      WHERE ${where.join(' AND ')} ORDER BY d.code, us.name, c.id`, params);
  const ids = rows.map((r) => r.id);
  const items = ids.length ? (await pool.query('SELECT * FROM claim_items WHERE claim_id = ANY($1::int[]) ORDER BY claim_id, id', [ids])).rows : [];
  // per-department grant / spend of the active block, for context next to the filtered amounts
  const allocation = (await pool.query(
    `SELECT d.code,
       COALESCE(SUM(CASE WHEN le.entry_type IN ('ALLOCATION','PRORATA','ADJUSTMENT_CR') THEN le.amount END),0) AS allocated,
       COALESCE(SUM(CASE WHEN le.entry_type='EXPENDITURE' THEN le.amount END),0) AS spent,
       COALESCE(SUM(CASE WHEN le.entry_type='COMMITMENT' THEN le.amount WHEN le.entry_type='COMMITMENT_RELEASE' THEN -le.amount END),0) AS committed
     FROM departments d JOIN users us ON us.department_id=d.id AND us.role IN ('FACULTY','HOD')
     JOIN cpda_accounts a ON a.user_id=us.id AND a.block_id=(SELECT id FROM cpda_blocks WHERE active LIMIT 1)
     LEFT JOIN ledger_entries le ON le.account_id=a.id WHERE ($1::int IS NULL OR d.id=$1) GROUP BY d.id`, [f.dept])).rows;
  let deptLabel = 'All departments';
  if (f.dept) deptLabel = ((await pool.query('SELECT code, name FROM departments WHERE id=$1', [f.dept])).rows[0] || {}).name || String(f.dept);
  return { filters: { ...f, dept_label: deptLabel, status_label: STATUS_LABEL[f.status] }, rows, items, agg: aggregate(rows, items, allocation) };
}

router.get('/options', ah(async (req, res) => {
  const { rows: depts } = await pool.query('SELECT id, code, name FROM departments ORDER BY code');
  const { rows: yrs } = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM (COALESCE(submitted_at, updated_at) AT TIME ZONE 'Asia/Kolkata'))::int AS y FROM claims WHERE status <> 'DRAFT' ORDER BY y DESC`);
  res.json({ departments: req.user.role === 'HOD' ? depts.filter((d) => d.id === req.user.department_id) : depts, years: yrs.map((r) => r.y), hod: req.user.role === 'HOD' });
}));

router.get('/', ah(async (req, res) => {
  const { filters, agg } = await load(req.user, req.query);
  res.json({ filters, ...agg });
}));

router.get('/export.xlsx', ah(async (req, res) => {
  const data = await load(req.user, req.query);
  const wb = workbook(data);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="CPDA-analysis-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

module.exports = router;
