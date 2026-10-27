const router = require('express').Router();
const multer = require('multer');
const { pool, HttpError } = require('../db');
const { auth, requireRole, ah } = require('../middleware/auth');
const { STEPS, CONFERENCE_CATEGORIES, CONTINGENT_CATEGORIES, stepsForRole } = require('../workflow');
const { getSettings } = require('../rules');
const claims = require('../services/claims');
const ledger = require('../services/ledger');
const { claimPdf } = require('../services/pdf');
const { audit } = require('../services/notify');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const FACULTY_ROLES = ['FACULTY', 'HOD'];
const SEE_ALL = ['ACCOUNTS_AR', 'REGISTRAR', 'DEAN_FAA', 'DIRECTOR', 'ADMIN', 'A_SECTION'];

router.use(auth);

router.get('/meta', ah(async (req, res) => {
  res.json({ conference_categories: CONFERENCE_CATEGORIES, contingent_categories: CONTINGENT_CATEGORIES, steps: STEPS, settings: await getSettings() });
}));

router.post('/check', requireRole(...FACULTY_ROLES), ah(async (req, res) => {
  res.json(await claims.check(req.user, req.body, req.body.id));
}));

router.post('/', requireRole(...FACULTY_ROLES), ah(async (req, res) => {
  res.status(201).json({ id: await claims.createOrUpdate(req.user, req.body) });
}));

router.put('/:id', requireRole(...FACULTY_ROLES), ah(async (req, res) => {
  res.json({ id: await claims.createOrUpdate(req.user, req.body, Number(req.params.id)) });
}));

// Everything the claim form can fill in for the person, so they never retype the same details.
router.get('/prefill', requireRole(...FACULTY_ROLES), ah(async (req, res) => {
  const u = req.user;
  const settings = await getSettings();
  const acc = await ledger.getActiveAccount(u.id);
  const { rows: parties } = await pool.query(
    `SELECT ci.category, ci.party, MAX(NULLIF(ci.remarks, '')) AS remarks, MAX(c.updated_at) AS last_used
       FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
      WHERE c.user_id = $1 GROUP BY ci.category, ci.party ORDER BY last_used DESC LIMIT 80`, [u.id]);
  const { rows: previous } = await pool.query(
    `SELECT id, claim_no, kind, title, total, status FROM claims WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 10`, [u.id]);
  const { rows: last } = await pool.query('SELECT pay_to FROM claims WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [u.id]);
  res.json({
    profile: { name: u.name, emp_code: u.emp_code, designation: u.designation || '', dept_name: u.dept_name || '', dept_code: u.dept_code || '', email: u.email },
    account: acc ? { block_label: acc.block_label, summary: await ledger.summary(acc.id, pool, settings) } : null,
    parties, previous, pay_to: last[0] ? last[0].pay_to : 'FACULTY',
  });
}));

const LIST_SQL = `SELECT c.id, c.claim_no, c.kind, c.title, c.status, c.total, c.current_step, c.is_advance, c.special_request,
    c.submitted_at, c.updated_at, c.fy, c.assignee_id, u.name AS faculty_name, u.emp_code, d.code AS dept_code
  FROM claims c JOIN users u ON u.id = c.user_id LEFT JOIN departments d ON d.id = u.department_id`;

router.get('/', ah(async (req, res) => {
  const u = req.user;
  const scope = req.query.scope || 'mine';
  let where = '';
  const params = [];
  if (scope === 'mine') {
    where = 'WHERE c.user_id=$1'; params.push(u.id);
  } else if (scope === 'inbox') {
    const idx = stepsForRole(u.role);
    if (!idx.length) return res.json([]);
    params.push(idx);
    where = "WHERE c.status='IN_REVIEW' AND c.current_step = ANY($1::int[])";
    if (u.role === 'HOD') { params.push(u.department_id); where += ` AND u.department_id=$${params.length} AND c.user_id <> ${u.id}`; }
    if (u.role === 'ACCOUNTS_JUNIOR') { params.push(u.id); where += ` AND c.assignee_id=$${params.length}`; }
  } else {
    if (SEE_ALL.includes(u.role)) where = "WHERE c.status <> 'DRAFT'";
    else if (u.role === 'HOD') { where = "WHERE c.status <> 'DRAFT' AND u.department_id=$1"; params.push(u.department_id); }
    else if (u.role === 'ACCOUNTS_JUNIOR') { where = 'WHERE c.assignee_id=$1'; params.push(u.id); }
    else throw new HttpError(403, 'Not allowed');
  }
  if (req.query.status) { params.push(req.query.status); where += ` AND c.status=$${params.length}`; }
  const { rows } = await pool.query(`${LIST_SQL} ${where} ORDER BY c.updated_at DESC LIMIT 300`, params);
  res.json(rows.map((r) => ({ ...r, step_label: r.current_step != null ? STEPS[r.current_step].label : null })));
}));

function canView(u, claim, faculty) {
  if (claim.user_id === u.id) return true;
  if (SEE_ALL.includes(u.role)) return claim.status !== 'DRAFT';
  if (u.role === 'HOD') return faculty.department_id === u.department_id && claim.status !== 'DRAFT';
  if (u.role === 'ACCOUNTS_JUNIOR') return claim.assignee_id === u.id;
  return false;
}

const hodCleared = (c) => ['APPROVED', 'PAID'].includes(c.status) || (c.status === 'IN_REVIEW' && c.current_step >= 1);

async function loadFull(id, user) {
  const { rows } = await pool.query('SELECT * FROM claims WHERE id=$1', [id]);
  const claim = rows[0];
  if (!claim) throw new HttpError(404, 'Claim not found');
  const { rows: f } = await pool.query(
    `SELECT u.id, u.name, u.emp_code, u.designation, u.email, u.department_id, d.code AS dept_code, d.name AS dept_name
     FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=$1`, [claim.user_id]);
  const faculty = f[0];
  if (!canView(user, claim, faculty)) throw new HttpError(403, 'You cannot view this claim');
  const [items, att, appr, blk] = await Promise.all([
    pool.query('SELECT * FROM claim_items WHERE claim_id=$1 ORDER BY id', [id]),
    pool.query('SELECT id, file_name, mime_type, size_bytes, sha256, uploaded_at FROM attachments WHERE claim_id=$1 ORDER BY id', [id]),
    pool.query('SELECT * FROM approvals WHERE claim_id=$1 ORDER BY id', [id]),
    pool.query('SELECT b.label FROM cpda_accounts a JOIN cpda_blocks b ON b.id=a.block_id WHERE a.id=$1', [claim.account_id]),
  ]);
  const summary = user.id === claim.user_id || user.role !== 'FACULTY' ? await ledger.summary(claim.account_id) : null;
  const step = claim.status === 'IN_REVIEW' ? STEPS[claim.current_step] : null;
  const mine = claim.user_id === user.id;
  const can = {
    edit: mine && ['DRAFT', 'RETURNED'].includes(claim.status),
    act: !!step && (step.role === user.role || user.role === 'A_SECTION') && !mine &&
      (user.role === 'A_SECTION' || (step.role !== 'HOD' || user.department_id === faculty.department_id)) &&
      (user.role === 'A_SECTION' || (step.key !== 'JUNIOR' || claim.assignee_id === user.id)),
    pay: claim.status === 'APPROVED' && ['ACCOUNTS_AR', 'ACCOUNTS_JUNIOR', 'A_SECTION'].includes(user.role),
    // Offline paper form: the applicant can always download it; everyone else once the HoD has recommended it
    download: user.id === claim.user_id || hodCleared(claim) || (user.role === 'HOD' && user.department_id === faculty.department_id && claim.status !== 'DRAFT'),
    // After the HoD stage Accounts (AR) can close the claim after offline signatures: AR is then the final authority
    offline_final: user.role === 'ACCOUNTS_AR' && !mine && claim.status === 'IN_REVIEW' && claim.current_step >= 1,
  };
  let juniors = [];
  if (can.act && step.assign) juniors = (await pool.query("SELECT id, name FROM users WHERE role='ACCOUNTS_JUNIOR' AND active ORDER BY name")).rows;
  return {
    claim, faculty, items: items.rows, attachments: att.rows, approvals: appr.rows, summary,
    block_label: blk.rows[0] && blk.rows[0].label, steps: STEPS, current_step_def: step, can, juniors,
  };
}

router.get('/:id', ah(async (req, res) => res.json(await loadFull(Number(req.params.id), req.user))));

router.get('/:id/pdf', ah(async (req, res) => {
  const d = await loadFull(Number(req.params.id), req.user);
  if (!d.can.download) throw new HttpError(403, 'The form can be downloaded by the applicant and the HoD at any time, and by others once the HoD has recommended it');
  await audit(pool, req.user, 'claim.download_form', 'claim', d.claim.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="CPDA-Reimbursement-Form-${(d.claim.claim_no || 'claim-' + d.claim.id).replace(/[^A-Za-z0-9_-]/g, '-')}.pdf"`);
  claimPdf(res, d);
}));

router.post('/:id/attachments', requireRole(...FACULTY_ROLES), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file received');
  res.status(201).json(await claims.addAttachment(req.user, Number(req.params.id), req.file));
}));

router.post('/:id/submit', requireRole(...FACULTY_ROLES), ah(async (req, res) => {
  res.json(await claims.submit(req.user, Number(req.params.id), req.body));
}));

router.post('/:id/action', ah(async (req, res) => {
  res.json(await claims.act(req.user, Number(req.params.id), req.body || {}));
}));

router.post('/:id/offline-final', requireRole('ACCOUNTS_AR'), ah(async (req, res) => {
  res.json(await claims.offlineFinal(req.user, Number(req.params.id), req.body));
}));

router.post('/:id/pay', requireRole('ACCOUNTS_AR', 'ACCOUNTS_JUNIOR', 'A_SECTION'), ah(async (req, res) => {
  res.json(await claims.markPaid(req.user, Number(req.params.id), (req.body || {}).payment_ref));
}));

// Files are served only through this role-checked route, never as public links
const attRouter = require('express').Router();
attRouter.get('/:id', auth, ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id=$1', [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, 'File not found');
  await loadFull(rows[0].claim_id, req.user); // throws 403 if the user may not view the claim
  res.setHeader('Content-Type', rows[0].mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${rows[0].file_name.replace(/"/g, '')}"`);
  res.send(rows[0].content);
}));

module.exports = { router, attRouter };
