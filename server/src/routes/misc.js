const router = require('express').Router();
const { pool } = require('../db');
const { auth, requireRole, ah } = require('../middleware/auth');
const { getSettings, proRataTable } = require('../rules');

router.use(auth);

// ---- notifications
router.get('/notifications', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 40', [req.user.id]);
  res.json({ items: rows, unread: rows.filter((r) => !r.is_read).length });
}));
router.post('/notifications/read-all', ah(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

router.get('/departments', ah(async (req, res) => {
  res.json((await pool.query('SELECT * FROM departments ORDER BY code')).rows);
}));

// ---- pro-rata calculator (Admin + Accounts AR)
router.post('/prorata', requireRole('ADMIN', 'ACCOUNTS_AR'), ah(async (req, res) => {
  const b = req.body || {};
  const settings = await getSettings();
  const startFy = Number(b.start_fy);
  const entitlement = Number(b.entitlement) || settings.yearly_entitlement;
  const rows = proRataTable(b, startFy, startFy + 2, entitlement);
  res.json({ entitlement, rows, total: rows.reduce((s, r) => s + r.credit, 0) });
}));

// ---- analytics (HoD sees own department only)
router.get('/analytics', requireRole('HOD', 'ACCOUNTS_AR', 'REGISTRAR', 'DEAN_FAA', 'DIRECTOR', 'ADMIN'), ah(async (req, res) => {
  const u = req.user;
  const dept = u.role === 'HOD' ? u.department_id : null;
  const blockQ = req.query.block_id ? Number(req.query.block_id) : null;
  const { rows: bl } = await pool.query('SELECT * FROM cpda_blocks WHERE ($1::int IS NULL AND active) OR id=$1', [blockQ]);
  const block = bl[0];
  if (!block) return res.json({ block: null });

  const byDept = (await pool.query(
    `SELECT d.code, d.name, COUNT(DISTINCT a.id) AS faculty,
       COALESCE(SUM(CASE WHEN le.entry_type IN ('ALLOCATION','PRORATA','ADJUSTMENT_CR') THEN le.amount END),0) AS allocated,
       COALESCE(SUM(CASE WHEN le.entry_type='EXPENDITURE' THEN le.amount END),0) AS spent,
       COALESCE(SUM(CASE WHEN le.entry_type='COMMITMENT' THEN le.amount WHEN le.entry_type='COMMITMENT_RELEASE' THEN -le.amount END),0) AS committed
     FROM departments d
     JOIN users us ON us.department_id=d.id AND us.role IN ('FACULTY','HOD')
     JOIN cpda_accounts a ON a.user_id=us.id AND a.block_id=$1
     LEFT JOIN ledger_entries le ON le.account_id=a.id
     WHERE ($2::int IS NULL OR d.id=$2) GROUP BY d.id ORDER BY d.code`, [block.id, dept])).rows;

  const byCat = (await pool.query(
    `SELECT ci.category, COUNT(*) AS lines, SUM(ci.amount) AS total
     FROM claim_items ci JOIN claims c ON c.id=ci.claim_id JOIN cpda_accounts a ON a.id=c.account_id JOIN users us ON us.id=c.user_id
     WHERE a.block_id=$1 AND c.status IN ('APPROVED','PAID') AND ($2::int IS NULL OR us.department_id=$2)
     GROUP BY ci.category ORDER BY total DESC`, [block.id, dept])).rows;

  const byStatus = (await pool.query(
    `SELECT c.status, COUNT(*) AS n, COALESCE(SUM(c.total),0) AS total
     FROM claims c JOIN cpda_accounts a ON a.id=c.account_id JOIN users us ON us.id=c.user_id
     WHERE a.block_id=$1 AND c.status <> 'DRAFT' AND ($2::int IS NULL OR us.department_id=$2) GROUP BY c.status`, [block.id, dept])).rows;

  const intl = (await pool.query(
    `SELECT us.id, us.name, us.emp_code, d.code AS dept_code FROM cpda_accounts a JOIN users us ON us.id=a.user_id
     LEFT JOIN departments d ON d.id=us.department_id
     WHERE a.block_id=$1 AND us.role IN ('FACULTY','HOD') AND ($2::int IS NULL OR us.department_id=$2)
       AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.account_id=a.id AND c.kind='CONFERENCE' AND c.event_type='International' AND c.status IN ('IN_REVIEW','APPROVED','PAID'))
     ORDER BY d.code, us.name`, [block.id, dept])).rows;

  res.json({ block, by_department: byDept, by_category: byCat, by_status: byStatus, no_international: intl });
}));

module.exports = router;
