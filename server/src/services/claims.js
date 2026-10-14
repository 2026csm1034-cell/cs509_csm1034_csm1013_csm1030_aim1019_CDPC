const crypto = require('crypto');
const { pool, tx, HttpError } = require('../db');
const { getSettings, fyOf, fyLabel, todayStr, parseD } = require('../rules');
const ledger = require('./ledger');
const { notify, audit } = require('./notify');
const { STEPS, CONFERENCE_CATEGORIES, CONTINGENT_CATEGORIES, MEMBERSHIP } = require('../workflow');

const inr = (n) => 'Rs ' + Number(n).toLocaleString('en-IN');
const bucketOf = (kind) => (kind === 'CONFERENCE' ? 'CONFERENCE' : 'CONTINGENCY');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseD(s));

function validatePayload(p) {
  const errs = [];
  if (!['CONFERENCE', 'CONTINGENT'].includes(p.kind)) errs.push('Choose a claim type');
  if (!p.title || !String(p.title).trim()) errs.push('Title is required');
  const cats = p.kind === 'CONFERENCE' ? CONFERENCE_CATEGORIES : CONTINGENT_CATEGORIES;
  if (!Array.isArray(p.items) || !p.items.length) errs.push('Add at least one expense line');
  (p.items || []).forEach((it, i) => {
    const n = `Line ${i + 1}: `;
    if (!cats.includes(it.category)) errs.push(n + 'choose a valid category');
    if (!it.party || !String(it.party).trim()) errs.push(n + 'particulars / party name is required');
    if (!it.invoice_no || !String(it.invoice_no).trim()) errs.push(n + 'invoice number is required');
    if (!isDate(it.invoice_date)) errs.push(n + 'invoice date is required');
    else if (it.invoice_date > todayStr()) errs.push(n + 'invoice date cannot be in the future');
    if (!(Number(it.amount) > 0)) errs.push(n + 'amount must be greater than zero');
  });
  if (p.kind === 'CONFERENCE') {
    if (!p.event_name || !String(p.event_name).trim()) errs.push('Conference / workshop name is required');
    if (!['National', 'International'].includes(p.event_type)) errs.push('Choose National or International');
    if (!isDate(p.event_start) || !isDate(p.event_end)) errs.push('Event start and end dates are required');
    else if (p.event_end < p.event_start) errs.push('Event end date is before start date');
  }
  return errs;
}

const totalOf = (items) => Math.round(items.reduce((s, i) => s + Number(i.amount || 0), 0) * 100) / 100;

/** Rule checks. severity: hard = cannot submit, soft = needs special approval, info = FYI */
async function computeViolations(c, { user, account, payload, attachmentCount, settings }) {
  const v = [];
  const add = (code, severity, message) => v.push({ code, severity, message });
  const total = totalOf(payload.items || []);
  const sum = await ledger.summary(account.id, c, settings);

  if (!user.probation_cleared) add('PROBATION', 'hard', 'Only faculty who have cleared probation are eligible for CPDA (Guideline 10).');
  if (user.on_leave_over_30) add('LONG_LEAVE', 'hard', 'Faculty on deputation / leave beyond 30 days are not entitled to claim (Guideline 8).');
  if (total > sum.balance) add('INSUFFICIENT_BALANCE', 'hard', `Claim total ${inr(total)} exceeds your available balance ${inr(sum.balance)}.`);

  if (payload.kind === 'CONFERENCE') {
    if (total > sum.conf_remaining) {
      add('TRAVEL_CAP', 'soft', `Conference / TA claims are capped at ${settings.travel_cap_pct}% of the grant (${inr(sum.conf_cap)}). Remaining under the cap: ${inr(sum.conf_remaining)} (Note 2).`);
    }
    if (!payload.prior_approval_ref || !String(payload.prior_approval_ref).trim()) {
      add('NO_PRIOR_APPROVAL', 'soft', 'Participation requires prior approval - enter the approval reference (Guideline 1).');
    }
    if (!payload.attended) add('NOT_ATTENDED', 'soft', 'Expenses are not reimbursable unless the faculty member attended the event (Guideline 15).');
  }

  // Deadline: within a month of the conference / expense (Guideline 16)
  const basis = payload.kind === 'CONFERENCE'
    ? payload.event_end
    : (payload.items || []).map((i) => i.invoice_date).filter(Boolean).sort().pop();
  if (basis && isDate(basis)) {
    const days = Math.floor((parseD(todayStr()) - parseD(basis)) / 86400000);
    if (days > settings.claim_deadline_days) {
      add('LATE_CLAIM', 'soft', `Claim is ${days} days after the ${payload.kind === 'CONFERENCE' ? 'event' : 'latest invoice'}; the limit is ${settings.claim_deadline_days} days (Guideline 16).`);
    }
  }

  // Memberships per block year (Activity B)
  const newMem = (payload.items || []).filter((i) => i.category === MEMBERSHIP).length;
  if (newMem) {
    const fy = fyOf(todayStr());
    const { rows } = await c.query(
      `SELECT COUNT(*) AS n FROM claim_items ci JOIN claims cl ON cl.id = ci.claim_id
       WHERE cl.account_id=$1 AND cl.fy=$2 AND cl.status IN ('IN_REVIEW','APPROVED','PAID')
         AND ci.category=$3 AND cl.id <> COALESCE($4, 0)`,
      [account.id, fy, MEMBERSHIP, payload.id || null]);
    if (rows[0].n + newMem > settings.max_memberships_per_year) {
      add('MEMBERSHIP_LIMIT', 'soft', `Maximum ${settings.max_memberships_per_year} memberships per year; you would have ${rows[0].n + newMem}.`);
    }
  }
  if (payload.is_advance) add('ADVANCE', 'soft', 'Advance payment is not allowed; it can only be considered case-by-case with the Director\'s approval (Guidelines 11-12).');
  if (!attachmentCount) add('NO_BILL', 'info', 'No bill / invoice attached yet. Attach scanned bills so Accounts can verify.');
  return { violations: v, total, summary: sum };
}

async function createOrUpdate(user, payload, id) {
  const errs = validatePayload(payload);
  if (errs.length) throw new HttpError(400, 'Please fix the highlighted problems', errs);
  return tx(async (c) => {
    const account = await ledger.getActiveAccount(user.id, c);
    if (!account) throw new HttpError(400, 'You have no CPDA account in the active block. Contact Accounts.');
    const total = totalOf(payload.items);
    let claimId = id;
    const fields = [
      payload.kind, payload.title.trim(),
      payload.kind === 'CONFERENCE' ? payload.event_name : null,
      payload.kind === 'CONFERENCE' ? payload.event_location || null : null,
      payload.kind === 'CONFERENCE' ? payload.event_type : null,
      payload.kind === 'CONFERENCE' ? payload.event_start : null,
      payload.kind === 'CONFERENCE' ? payload.event_end : null,
      payload.kind === 'CONFERENCE' ? payload.prior_approval_ref || null : null,
      payload.kind === 'CONFERENCE' ? !!payload.attended : false,
      payload.pay_to === 'VENDOR' ? 'VENDOR' : 'FACULTY', !!payload.is_advance, total,
    ];
    if (!id) {
      const { rows } = await c.query(
        `INSERT INTO claims(user_id, account_id, fy, kind, title, event_name, event_location, event_type, event_start, event_end,
          prior_approval_ref, attended, pay_to, is_advance, total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [user.id, account.id, fyOf(todayStr()), ...fields]);
      claimId = rows[0].id;
    } else {
      const { rows } = await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE', [id]);
      const cl = rows[0];
      if (!cl) throw new HttpError(404, 'Claim not found');
      if (cl.user_id !== user.id) throw new HttpError(403, 'Not your claim');
      if (!['DRAFT', 'RETURNED'].includes(cl.status)) throw new HttpError(400, 'Only draft or returned claims can be edited');
      await c.query(
        `UPDATE claims SET kind=$1, title=$2, event_name=$3, event_location=$4, event_type=$5, event_start=$6, event_end=$7,
          prior_approval_ref=$8, attended=$9, pay_to=$10, is_advance=$11, total=$12, updated_at=now() WHERE id=$13`,
        [...fields, id]);
      await c.query('DELETE FROM claim_items WHERE claim_id=$1', [id]);
    }
    for (const it of payload.items) {
      await c.query(
        'INSERT INTO claim_items(claim_id, category, party, invoice_no, invoice_date, amount, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [claimId, it.category, it.party.trim(), it.invoice_no.trim(), it.invoice_date, Number(it.amount), it.remarks || null]);
    }
    await audit(c, user, id ? 'claim.update' : 'claim.create', 'claim', claimId, { total });
    return claimId;
  });
}

async function check(user, payload, claimId) {
  const settings = await getSettings();
  const account = await ledger.getActiveAccount(user.id);
  if (!account) throw new HttpError(400, 'You have no CPDA account in the active block.');
  let attachmentCount = 0;
  if (claimId) {
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE claim_id=$1', [claimId]);
    attachmentCount = rows[0].n;
  }
  const r = await computeViolations(pool, { user, account, payload: { ...payload, id: claimId }, attachmentCount, settings });
  return { violations: r.violations, total: r.total, summary: r.summary };
}

async function usersForStep(c, step, claim, faculty) {
  if (step.role === 'HOD') {
    const { rows } = await c.query("SELECT id FROM users WHERE role='HOD' AND active AND department_id=$1", [faculty.department_id]);
    return rows.map((r) => r.id);
  }
  if (step.key === 'JUNIOR') return [claim.assignee_id];
  const { rows } = await c.query('SELECT id FROM users WHERE role=$1 AND active', [step.role]);
  return rows.map((r) => r.id);
}

async function submit(user, id, body = {}) {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE', [id]);
    const claim = rows[0];
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.user_id !== user.id) throw new HttpError(403, 'Not your claim');
    if (!['DRAFT', 'RETURNED'].includes(claim.status)) throw new HttpError(400, 'Claim has already been submitted');
    await c.query('SELECT id FROM cpda_accounts WHERE id=$1 FOR UPDATE', [claim.account_id]);
    const { rows: items } = await c.query('SELECT * FROM claim_items WHERE claim_id=$1 ORDER BY id', [id]);
    const payload = {
      ...claim,
      event_start: claim.event_start, event_end: claim.event_end,
      items: items.map((i) => ({ ...i, invoice_date: i.invoice_date })),
    };
    const errs = validatePayload(payload);
    if (errs.length) throw new HttpError(400, 'Please fix the claim before submitting', errs);
    const settings = await getSettings(c);
    const account = { id: claim.account_id };
    const { rows: att } = await c.query('SELECT COUNT(*) AS n FROM attachments WHERE claim_id=$1', [id]);
    const r = await computeViolations(c, { user, account, payload, attachmentCount: att[0].n, settings });

    const hard = r.violations.filter((v) => v.severity === 'hard');
    const soft = r.violations.filter((v) => v.severity === 'soft');
    if (hard.length) throw new HttpError(422, 'This claim breaks a rule that cannot be waived', r.violations);
    const special = !!body.special_request;
    if (soft.length && !special) throw new HttpError(422, 'This claim breaks CPDA rules. Fix it, or request special approval of the Director.', r.violations);
    if (special && !(body.special_reason && String(body.special_reason).trim())) throw new HttpError(400, 'Please give a reason for the special approval request');

    const startStep = user.role === 'HOD' ? 1 : 0; // a HoD cannot recommend their own claim
    const claimNo = claim.claim_no || (await c.query("SELECT 'CPDA/' || $1::text || '/' || LPAD(nextval('claim_seq')::text, 4, '0') AS n", [fyLabel(claim.fy)])).rows[0].n;
    await c.query(
      `UPDATE claims SET status='IN_REVIEW', current_step=$1, claim_no=$2, special_request=$3, special_reason=$4,
         violations=$5, submitted_at=now(), updated_at=now(), assignee_id=NULL WHERE id=$6`,
      [startStep, claimNo, special && soft.length > 0, special && soft.length ? body.special_reason.trim() : null, JSON.stringify(r.violations), id]);
    await ledger.addEntry(c, {
      account_id: claim.account_id, fy: claim.fy, type: 'COMMITMENT', bucket: bucketOf(claim.kind), amount: r.total,
      claim_id: id, particulars: `Commitment: ${claimNo} ${claim.title}`, created_by: user.id,
    });
    await c.query(
      `INSERT INTO approvals(claim_id, step_key, step_label, actor_id, actor_name, actor_role, decision, comment)
       VALUES ($1,'SUBMIT','Submitted by faculty',$2,$3,$4,'SUBMITTED',$5)`,
      [id, user.id, user.name, user.role, special && soft.length ? 'Special approval requested: ' + body.special_reason.trim() : null]);
    const step = STEPS[startStep];
    await notify(c, await usersForStep(c, step, claim, user), `${claimNo}: new claim from ${user.name} awaiting "${step.label}" (${inr(r.total)})`, id);
    await audit(c, user, 'claim.submit', 'claim', id, { claimNo, total: r.total, special: special && soft.length > 0 });
    return { id, claim_no: claimNo };
  });
}

async function act(user, id, body) {
  const { action, comment } = body;
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE', [id]);
    const claim = rows[0];
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.status !== 'IN_REVIEW') throw new HttpError(400, 'This claim is not awaiting any action');
    const step = STEPS[claim.current_step];
    const faculty = (await c.query('SELECT * FROM users WHERE id=$1', [claim.user_id])).rows[0];
    if (step.role !== user.role) throw new HttpError(403, `This claim is waiting for: ${step.label}`);
    if (step.role === 'HOD' && user.department_id !== faculty.department_id) throw new HttpError(403, 'Only the HoD of the faculty member\'s department can act');
    if (step.key === 'JUNIOR' && claim.assignee_id !== user.id) throw new HttpError(403, 'This claim is assigned to another staff member');
    if (user.id === claim.user_id) throw new HttpError(403, 'You cannot act on your own claim');
    if (!['approve', 'reject', 'return'].includes(action)) throw new HttpError(400, 'Unknown action');
    if (action !== 'approve' && !(comment && String(comment).trim())) throw new HttpError(400, 'A comment is required to reject or return a claim');

    let decisionNote = comment ? String(comment).trim() : null;
    if (action === 'approve') {
      if (step.assign) {
        const { rows: j } = await c.query("SELECT id, name FROM users WHERE id=$1 AND role='ACCOUNTS_JUNIOR' AND active", [body.assignee_id]);
        if (!j[0]) throw new HttpError(400, 'Choose a junior accounts staff member to assign this claim to');
        await c.query('UPDATE claims SET assignee_id=$1 WHERE id=$2', [j[0].id, id]);
        claim.assignee_id = j[0].id;
        decisionNote = `Assigned to ${j[0].name}` + (decisionNote ? ` - ${decisionNote}` : '');
      }
      if (step.register) {
        const rg = body.register || {};
        if (!rg.register_page || !rg.register_sr || !rg.budget_head) throw new HttpError(400, 'Enter CPDA register page no., serial no. and budget head');
        const passed = rg.amount_passed === undefined || rg.amount_passed === '' ? claim.total : Number(rg.amount_passed);
        if (!(passed > 0) || passed > claim.total) throw new HttpError(400, 'Amount passed must be between 0 and the claim total');
        await c.query(
          'UPDATE claims SET register_page=$1, register_sr=$2, stock_register_no=$3, budget_head=$4, amount_passed=$5 WHERE id=$6',
          [rg.register_page, rg.register_sr, rg.stock_register_no || null, rg.budget_head, passed, id]);
        decisionNote = `Register p.${rg.register_page} / Sr.${rg.register_sr}, passed ${inr(passed)}` + (decisionNote ? ` - ${decisionNote}` : '');
      }
      if (claim.special_request && step.key === 'DIRECTOR' && !decisionNote) throw new HttpError(400, 'Record a comment for the special approval decision');
    }

    await c.query(
      `INSERT INTO approvals(claim_id, step_key, step_label, actor_id, actor_name, actor_role, decision, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, step.key, step.label, user.id, user.name, user.role, action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'RETURNED', decisionNote]);

    const release = () => ledger.addEntry(c, {
      account_id: claim.account_id, fy: claim.fy, type: 'COMMITMENT_RELEASE', bucket: bucketOf(claim.kind), amount: claim.total,
      claim_id: id, particulars: `Commitment released: ${claim.claim_no}`, created_by: user.id,
    });

    if (action === 'reject') {
      await release();
      await c.query("UPDATE claims SET status='REJECTED', current_step=NULL, updated_at=now() WHERE id=$1", [id]);
      await notify(c, [claim.user_id], `${claim.claim_no} was rejected at "${step.label}": ${decisionNote}`, id);
    } else if (action === 'return') {
      await release();
      await c.query("UPDATE claims SET status='RETURNED', current_step=NULL, updated_at=now() WHERE id=$1", [id]);
      await notify(c, [claim.user_id], `${claim.claim_no} was returned for correction by ${step.label}: ${decisionNote}`, id);
    } else if (claim.current_step === STEPS.length - 1) {
      const passed = claim.amount_passed || (await c.query('SELECT amount_passed FROM claims WHERE id=$1', [id])).rows[0].amount_passed || claim.total;
      await release();
      await ledger.addEntry(c, {
        account_id: claim.account_id, fy: claim.fy, type: 'EXPENDITURE', bucket: bucketOf(claim.kind), amount: passed,
        claim_id: id, particulars: `Expenditure: ${claim.claim_no} ${claim.title}`, created_by: user.id,
      });
      await c.query("UPDATE claims SET status='APPROVED', current_step=NULL, updated_at=now() WHERE id=$1", [id]);
      const { rows: ar } = await c.query("SELECT id FROM users WHERE role='ACCOUNTS_AR' AND active");
      await notify(c, [claim.user_id], `${claim.claim_no} has been approved by the Director (${inr(passed)}). Accounts will process payment.`, id);
      await notify(c, ar.map((r) => r.id), `${claim.claim_no} approved - pass for payment`, id);
    } else {
      const next = claim.current_step + 1;
      await c.query('UPDATE claims SET current_step=$1, updated_at=now() WHERE id=$2', [next, id]);
      await notify(c, await usersForStep(c, STEPS[next], claim, faculty), `${claim.claim_no}: claim from ${faculty.name} awaiting "${STEPS[next].label}"`, id);
      await notify(c, [claim.user_id], `${claim.claim_no} cleared "${step.label}" and moved to "${STEPS[next].label}"`, id);
    }
    await audit(c, user, `claim.${action}`, 'claim', id, { step: step.key });
    return { ok: true };
  });
}

async function markPaid(user, id, ref) {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE', [id]);
    const claim = rows[0];
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.status !== 'APPROVED') throw new HttpError(400, 'Only approved claims can be marked as paid');
    await c.query("UPDATE claims SET status='PAID', paid_at=now(), payment_ref=$1, updated_at=now() WHERE id=$2", [ref || null, id]);
    await c.query(
      `INSERT INTO approvals(claim_id, step_key, step_label, actor_id, actor_name, actor_role, decision, comment)
       VALUES ($1,'PAY','Passed for payment',$2,$3,$4,'PAID',$5)`, [id, user.id, user.name, user.role, ref ? 'Payment ref: ' + ref : null]);
    await notify(c, [claim.user_id], `${claim.claim_no} has been passed for payment${ref ? ' (ref ' + ref + ')' : ''}.`, id);
    await audit(c, user, 'claim.paid', 'claim', id, { ref });
    return { ok: true };
  });
}

async function addAttachment(user, claimId, file) {
  const { rows } = await pool.query('SELECT user_id, status FROM claims WHERE id=$1', [claimId]);
  if (!rows[0]) throw new HttpError(404, 'Claim not found');
  if (rows[0].user_id !== user.id) throw new HttpError(403, 'Not your claim');
  if (!['DRAFT', 'RETURNED'].includes(rows[0].status)) throw new HttpError(400, 'Bills cannot be changed after submission');
  const okTypes = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47] };
  const sig = okTypes[file.mimetype];
  // Verify the real file type from its first bytes, not just the extension
  if (!sig || !sig.every((b, i) => file.buffer[i] === b)) throw new HttpError(400, 'Only genuine PDF, JPG or PNG files are allowed');
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const { rows: a } = await pool.query(
    `INSERT INTO attachments(claim_id, file_name, mime_type, size_bytes, sha256, content, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, file_name, size_bytes, sha256`,
    [claimId, file.originalname, file.mimetype, file.size, sha, file.buffer, user.id]);
  await audit(pool, user, 'attachment.add', 'claim', claimId, { file: file.originalname, sha256: sha });
  return a[0];
}

module.exports = { createOrUpdate, check, submit, act, markPaid, addAttachment, validatePayload, computeViolations, bucketOf };
