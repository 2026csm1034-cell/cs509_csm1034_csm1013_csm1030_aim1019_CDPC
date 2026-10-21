const { pool } = require('../db');
const { getSettings, fyLabel, monthsInService, proRataCredit } = require('../rules');

const SIGN = {
  ALLOCATION: 1, PRORATA: 1, CARRY_IN: 1, ADJUSTMENT_CR: 1, COMMITMENT_RELEASE: 1,
  EXPENDITURE: -1, COMMITMENT: -1, ADJUSTMENT_DR: -1,
};

async function addEntry(c, e) {
  const { rows } = await c.query(
    `INSERT INTO ledger_entries(account_id, fy, entry_date, entry_type, bucket, amount, claim_id, particulars, created_by)
     VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7,$8,$9) RETURNING *`,
    [e.account_id, e.fy, e.entry_date || null, e.type, e.bucket || null, e.amount, e.claim_id || null, e.particulars || null, e.created_by || null]
  );
  return rows[0];
}

/** Balances are always computed from the append-only ledger. */
async function summary(accountId, c = pool, settings) {
  settings = settings || (await getSettings(c));
  const { rows } = await c.query(
    'SELECT entry_type, bucket, SUM(amount) AS s FROM ledger_entries WHERE account_id=$1 GROUP BY 1,2',
    [accountId]
  );
  let allocated = 0, carry_in = 0, expenditure = 0, commitment = 0;
  let confExp = 0, contExp = 0, confCommit = 0, contCommit = 0;
  for (const r of rows) {
    const s = Number(r.s);
    const conf = r.bucket === 'CONFERENCE';
    switch (r.entry_type) {
      case 'ALLOCATION': case 'PRORATA': case 'ADJUSTMENT_CR': allocated += s; break;
      case 'ADJUSTMENT_DR': allocated -= s; break;
      case 'CARRY_IN': carry_in += s; break;
      case 'EXPENDITURE': expenditure += s; if (conf) confExp += s; else contExp += s; break;
      case 'COMMITMENT': commitment += s; if (conf) confCommit += s; else contCommit += s; break;
      case 'COMMITMENT_RELEASE': commitment -= s; if (conf) confCommit -= s; else contCommit -= s; break;
      default: break;
    }
  }
  const conf_cap = Math.round((allocated * settings.travel_cap_pct) / 100);
  const conf_used = confExp + confCommit;
  return {
    allocated, carry_in, expenditure, commitment,
    balance: allocated + carry_in - expenditure - commitment,
    total_grant: allocated + carry_in,
    conf_cap, conf_used, conf_remaining: Math.max(0, conf_cap - conf_used),
    conf_spent: confExp, cont_spent: contExp, conf_committed: confCommit, cont_committed: contCommit,
  };
}

async function entries(accountId, c = pool) {
  const { rows } = await c.query(
    `SELECT le.*, cl.claim_no FROM ledger_entries le LEFT JOIN claims cl ON cl.id = le.claim_id
     WHERE le.account_id=$1 ORDER BY le.id`, [accountId]);
  let run = 0;
  return rows.map((r) => {
    run += SIGN[r.entry_type] * r.amount;
    return { ...r, signed: SIGN[r.entry_type] * r.amount, running_balance: run };
  });
}

async function getActiveAccount(userId, c = pool) {
  const { rows } = await c.query(
    `SELECT a.*, b.label AS block_label, b.start_fy, b.end_fy FROM cpda_accounts a
     JOIN cpda_blocks b ON b.id = a.block_id WHERE a.user_id=$1 AND b.active LIMIT 1`, [userId]);
  return rows[0] || null;
}

/** Credit one FY allocation (full or pro-rata). Idempotent per account + FY. */
async function allocateFy(c, account, user, fy, settings, byUserId) {
  const { rows: ex } = await c.query(
    `SELECT 1 FROM ledger_entries WHERE account_id=$1 AND fy=$2 AND entry_type IN ('ALLOCATION','PRORATA') LIMIT 1`,
    [account.id, fy]);
  if (ex.length) return null;
  const m = monthsInService(fy, user);
  if (m.months <= 0) return null;
  const amount = proRataCredit(settings.yearly_entitlement, m.months);
  const full = m.months === 12;
  return addEntry(c, {
    account_id: account.id, fy, type: full ? 'ALLOCATION' : 'PRORATA', amount,
    particulars: full ? `CPDA allocation for FY ${fyLabel(fy)}` : `Pro-rata allocation FY ${fyLabel(fy)} (${m.months}/12 months)`,
    created_by: byUserId,
    entry_date: `${fy}-04-01`,
  });
}

/** Create accounts for all active faculty / HoDs and credit allocations up to the current FY. */
async function initBlockAccounts(c, block, settings, byUserId) {
  const { fyOf, todayStr } = require('../rules');
  const upto = Math.min(block.end_fy, fyOf(todayStr()));
  const { rows: users } = await c.query("SELECT * FROM users WHERE role IN ('FACULTY','HOD') AND active ORDER BY id");
  let created = 0, credited = 0;
  for (const u of users) {
    let { rows: a } = await c.query('SELECT * FROM cpda_accounts WHERE user_id=$1 AND block_id=$2', [u.id, block.id]);
    if (!a[0]) {
      a = (await c.query('INSERT INTO cpda_accounts(user_id, block_id) VALUES ($1,$2) RETURNING *', [u.id, block.id])).rows;
      created++;
    }
    for (let fy = block.start_fy; fy <= upto; fy++) if (await allocateFy(c, a[0], u, fy, settings, byUserId)) credited++;
  }
  return { created, credited };
}

/** Carry the unspent balance of the previous block into the new one, capped (Guideline 4). Idempotent. */
async function carryForward(c, fromBlock, toBlock, settings, byUserId) {
  const { rows: accs } = await c.query('SELECT a.*, u.active FROM cpda_accounts a JOIN users u ON u.id=a.user_id WHERE a.block_id=$1', [fromBlock.id]);
  let carried = 0, lapsed = 0, count = 0;
  for (const a of accs) {
    if (!a.active) continue;
    const s = await summary(a.id, c, settings);
    if (s.balance <= 0) continue;
    let { rows: t } = await c.query('SELECT * FROM cpda_accounts WHERE user_id=$1 AND block_id=$2', [a.user_id, toBlock.id]);
    if (!t[0]) t = (await c.query('INSERT INTO cpda_accounts(user_id, block_id) VALUES ($1,$2) RETURNING *', [a.user_id, toBlock.id])).rows;
    const { rows: ex } = await c.query("SELECT 1 FROM ledger_entries WHERE account_id=$1 AND entry_type='CARRY_IN'", [t[0].id]);
    if (ex.length) continue;
    const amt = Math.min(s.balance, settings.carry_forward_max);
    await addEntry(c, {
      account_id: t[0].id, fy: toBlock.start_fy, type: 'CARRY_IN', amount: amt, created_by: byUserId, entry_date: `${toBlock.start_fy}-04-01`,
      particulars: `Carry-forward from block ${fromBlock.label}: unspent Rs ${s.balance.toLocaleString('en-IN')}, carried Rs ${amt.toLocaleString('en-IN')}` + (amt < s.balance ? ' (capped, balance above cap lapses)' : ''),
    });
    carried += amt; lapsed += s.balance - amt; count++;
  }
  return { accounts: count, carried, lapsed };
}

module.exports = { addEntry, summary, entries, getActiveAccount, allocateFy, initBlockAccounts, carryForward, SIGN };
