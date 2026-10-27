// AR offline final approval: permission, guards, ledger postings and closing of remaining steps
const Module = require('module'); const orig = Module._load;
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
let claim, queries;
const c = { query: async (sql, args) => {
  queries.push([sql.replace(/\s+/g, ' ').trim(), args]);
  if (/SELECT \* FROM claims WHERE id=\$1 FOR UPDATE/.test(sql)) return { rows: claim ? [claim] : [] };
  if (/FROM users WHERE role='HOD'/.test(sql)) return { rows: [{ id: 50 }] };
  if (/INSERT INTO ledger_entries/.test(sql)) return { rows: [{ id: 1 }] };
  return { rows: [] };
} };
Module._load = function (r, ...a) {
  if (/^\.\.\/db$/.test(r)) return { pool: c, tx: async (fn) => fn(c), HttpError };
  if (/^\.\.\/rules$/.test(r)) return { getSettings: async () => ({}), fyOf: () => 2026, fyLabel: String, todayStr: () => '2026-10-25', parseD: (s) => new Date(s) };
  if (/^\.\/notify$/.test(r)) return { notify: async (_c, ids, msg) => queries.push(['NOTIFY', ids, msg]), audit: async (_c, u, action) => queries.push(['AUDIT', action]) };
  return orig.call(this, r, ...a);
};
const svc = require('../src/services/claims.js');
const AR = { id: 9, name: 'AR Officer', role: 'ACCOUNTS_AR' };
const base = () => ({ id: 3, claim_no: 'CPDA/2026-27/0003', user_id: 1, account_id: 7, fy: 2026, kind: 'CONTINGENT', title: 'Books', total: 5000, status: 'IN_REVIEW', current_step: 3, amount_passed: null });
let fail = 0; const ok = (n, v) => { console.log((v ? 'PASS  ' : 'FAIL  ') + n); if (!v) fail++; };
const rejects = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.status === code; } };
(async () => {
  queries = []; claim = base();
  ok('only AR may use it (403)', await rejects(() => svc.offlineFinal({ id: 2, role: 'REGISTRAR', name: 'R' }, 3, { reference: 'x', confirm: true }), 403));
  ok('reference required (400)', await rejects(() => svc.offlineFinal(AR, 3, { confirm: true }), 400));
  ok('confirmation required (400)', await rejects(() => svc.offlineFinal(AR, 3, { reference: 'Signed 25 Oct' }), 400));
  claim = { ...base(), current_step: 0 };
  ok('refused while still at HoD stage (400)', await rejects(() => svc.offlineFinal(AR, 3, { reference: 'x', confirm: true }), 400));
  claim = { ...base(), status: 'APPROVED' };
  ok('refused if already approved (400)', await rejects(() => svc.offlineFinal(AR, 3, { reference: 'x', confirm: true }), 400));
  claim = { ...base(), user_id: 9 };
  ok('cannot finalise own claim (403)', await rejects(() => svc.offlineFinal(AR, 3, { reference: 'x', confirm: true }), 403));
  claim = base();
  ok('amount above claim total refused (400)', await rejects(() => svc.offlineFinal(AR, 3, { reference: 'x', confirm: true, amount_passed: 9999 }), 400));
  queries = []; claim = base();
  const r = await svc.offlineFinal(AR, 3, { reference: 'Signed form 25/10/2026', confirm: true, amount_passed: 4800, register_page: '12', register_sr: '7' });
  const sql = queries.map((q) => q[0]).join('\n');
  ok('success returns ok', r.ok === true);
  ok('approval row recorded as AR_OFFLINE_FINAL with reference and closed steps', queries.some((q) => /INSERT INTO approvals/.test(q[0]) && /'AR_OFFLINE_FINAL','Approved offline - final authority \(Accounts AR\)'/.test(q[0]) && /Signed form 25\/10\/2026/.test(q[1][4]) && /Registrar/.test(q[1][4])));
  const led = queries.filter((q) => /INSERT INTO ledger_entries/.test(q[0]));
  ok('commitment released (5000) and expenditure posted (4800)', led.length === 2 && led[0][1][3] === 'COMMITMENT_RELEASE' && led[0][1][5] === 5000 && led[1][1][3] === 'EXPENDITURE' && led[1][1][5] === 4800);
  ok('claim set APPROVED and step cleared', /UPDATE claims SET status='APPROVED', current_step=NULL/.test(sql));
  ok('passed amount + register saved', queries.some((q) => /UPDATE claims SET amount_passed/.test(q[0]) && q[1][0] === 4800 && q[1][1] === '12'));
  ok('faculty notified and audit logged', queries.some((q) => q[0] === 'NOTIFY' && q[1].includes(1)) && queries.some((q) => q[0] === 'AUDIT' && q[1] === 'claim.offline_final'));
  console.log(fail ? '\nOFFLINE-FINAL TESTS FAILED' : '\nOFFLINE-FINAL TESTS PASSED'); process.exit(fail ? 1 : 0);
})();
