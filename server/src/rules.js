// Fund rules and pro-rata maths. Limits come from the `settings` table (rules as data).
const { pool } = require('./db');

const DEFAULT_SETTINGS = {
  yearly_entitlement: [100000, 'CPDA entitlement per financial year (Rs)'],
  travel_cap_pct: [70, 'Max % of block grant usable for conferences / TA / DA (Point A)'],
  carry_forward_max: [300000, 'Max unspent balance carried to next block (Rs)'],
  claim_deadline_days: [30, 'Claim must be filed within this many days of the conference / expense'],
  max_memberships_per_year: [3, 'Max professional-body memberships per block year'],
};

async function getSettings(c = pool) {
  const { rows } = await c.query('SELECT key, value FROM settings');
  const s = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) s[k] = DEFAULT_SETTINGS[k][0];
  for (const r of rows) s[r.key] = Number(r.value);
  return s;
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const parseD = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null);
const fyOf = (d) => {
  const dt = typeof d === 'string' ? parseD(d) : d;
  return dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
};
const fyIndex = (d) => (d.getMonth() + 9) % 12; // Apr=0 ... Mar=11
const fyLabel = (fy) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
const blockLabel = (start, end) => `${start}-${String((end + 1) % 100).padStart(2, '0')}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Months of service in a financial year (Apr..Mar), per Guidelines 5 and 10.
 *  - Joining: months left in the year INCLUDING the joining month
 *  - Retirement: months INCLUDING the retirement month
 *  - Leaving / release: months EXCLUDING the release month
 */
function monthsInService(fy, p) {
  const joined = parseD(p.doj);
  const left = parseD(p.dor);
  let start = 0;
  let end = 11;
  const notes = [];
  if (joined) {
    const jf = fyOf(joined);
    if (jf > fy) return { months: 0, note: 'Not yet joined' };
    if (jf === fy) {
      if (p.opted_out_joining_year) return { months: 0, note: 'Opted out of CPDA for the year of joining' };
      start = fyIndex(joined);
      notes.push(`joined in ${MONTHS[start]} (month counted)`);
    }
  }
  if (left) {
    const lf = fyOf(left);
    if (lf < fy) return { months: 0, note: 'Already left service' };
    if (lf === fy) {
      if (p.exit_type === 'RELEASE') {
        end = fyIndex(left) - 1;
        notes.push(`released in ${MONTHS[fyIndex(left)]} (month not counted)`);
      } else {
        end = fyIndex(left);
        notes.push(`retires in ${MONTHS[end]} (month counted)`);
      }
    }
  }
  const months = Math.max(0, end - start + 1);
  return { months, note: notes.length ? notes.join(', ') : 'Full year' };
}
const proRataCredit = (entitlement, months) => Math.round((entitlement * months) / 12);

function proRataTable(p, startFy, endFy, entitlement) {
  const rows = [];
  for (let fy = startFy; fy <= endFy; fy++) {
    const m = monthsInService(fy, p);
    rows.push({ fy, label: fyLabel(fy), months: m.months, note: m.note, credit: proRataCredit(entitlement, m.months), full: m.months === 12 });
  }
  return rows;
}

module.exports = { DEFAULT_SETTINGS, getSettings, fyOf, fyLabel, blockLabel, monthsInService, proRataCredit, proRataTable, todayStr, parseD, MONTHS };
