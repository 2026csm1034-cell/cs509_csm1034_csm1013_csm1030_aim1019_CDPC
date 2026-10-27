const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { if (/\.\/db$/.test(r)) return { pool: {}, tx: async () => {}, HttpError: Error }; if (/\.\.?\/rules$/.test(r)) return { getSettings: async () => ({ travel_cap_pct: 70, carry_forward_max: 50000 }), fyLabel: (x) => x }; return orig.call(this, r, ...a); };
const ledger = require('../src/services/ledger.js');
const rows = [
  { entry_type: 'ALLOCATION', bucket: null, s: '100000' }, { entry_type: 'CARRY_IN', bucket: null, s: '10000' },
  { entry_type: 'EXPENDITURE', bucket: 'CONFERENCE', s: '20000' }, { entry_type: 'EXPENDITURE', bucket: 'CONTINGENCY', s: '8000' },
  { entry_type: 'COMMITMENT', bucket: 'CONFERENCE', s: '5000' }, { entry_type: 'COMMITMENT', bucket: 'CONTINGENCY', s: '2000' },
  { entry_type: 'COMMITMENT_RELEASE', bucket: 'CONTINGENCY', s: '500' },
];
(async () => {
  const s = await ledger.summary(1, { query: async () => ({ rows }) }, { travel_cap_pct: 70 });
  console.log(s);
  const ok = s.total_grant === 110000 && s.conf_cap === 70000 && s.conf_used === 25000 && s.conf_remaining === 45000
    && s.cont_cap === 40000 && s.cont_used === 9500 && s.cont_remaining === 30500 && s.balance === 110000 - 28000 - 6500;
  console.log(ok ? 'LEDGER SUMMARY TEST PASSED' : 'LEDGER SUMMARY TEST FAILED'); process.exit(ok ? 0 : 1);
})();
