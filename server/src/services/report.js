// Department / faculty analysis. `aggregate` is pure (easy to test); `workbook` writes the Excel file.
const ExcelJS = require('exceljs');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GONE = ['APPROVED', 'PAID'];               // money that went to the faculty / department
const num = (v) => Number(v || 0);
const fyLabel = (fy) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
const passedOf = (r) => num(r.amount_passed || r.total);

function blank() { return { claims: 0, approved_claims: 0, amount: 0, in_process: 0, contingency: 0, conference: 0, rejected_returned: 0 }; }
function add(t, r) {
  t.claims += 1;
  if (GONE.includes(r.status)) {
    t.approved_claims += 1; const a = passedOf(r); t.amount += a;
    if (r.kind === 'CONFERENCE') t.conference += a; else t.contingency += a;
  } else if (r.status === 'IN_REVIEW') t.in_process += num(r.total);
  else t.rejected_returned += 1;
  return t;
}

function aggregate(rows, items = [], allocation = []) {
  const dept = new Map(), fac = new Map(), month = new Map(), week = new Map(), cat = new Map();
  const allocByCode = new Map(allocation.map((a) => [a.code, a]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    const dk = r.dept_code || '-';
    if (!dept.has(dk)) dept.set(dk, { code: dk, name: r.dept_name || 'No department', faculty: new Set(), ...blank() });
    const d = dept.get(dk); add(d, r); d.faculty.add(r.user_id);
    if (!fac.has(r.user_id)) fac.set(r.user_id, { user_id: r.user_id, name: r.name, emp_code: r.emp_code, dept_code: dk, ...blank() });
    add(fac.get(r.user_id), r);
    const mk = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!month.has(mk)) month.set(mk, { period: mk, label: `${MONTHS[r.month - 1]} ${r.year}`, ...blank(), by_dept: {} });
    const m = month.get(mk); add(m, r);
    if (GONE.includes(r.status)) m.by_dept[dk] = (m.by_dept[dk] || 0) + passedOf(r);
    if (!week.has(r.week_label)) week.set(r.week_label, { period: r.week_label, ...blank(), by_dept: {} });
    const w = week.get(r.week_label); add(w, r);
    if (GONE.includes(r.status)) w.by_dept[dk] = (w.by_dept[dk] || 0) + passedOf(r);
  }
  for (const it of items) {
    const r = byId.get(it.claim_id);
    if (!r || !GONE.includes(r.status)) continue;
    if (!cat.has(it.category)) cat.set(it.category, { category: it.category, lines: 0, amount: 0 });
    const c = cat.get(it.category); c.lines += 1; c.amount += num(it.amount);
  }
  const by_department = [...dept.values()].map((d) => {
    const al = allocByCode.get(d.code) || {};
    return { ...d, faculty: d.faculty.size, allocated_block: num(al.allocated), spent_block: num(al.spent), committed_block: num(al.committed) };
  }).sort((a, b) => b.amount - a.amount);
  const totals = by_department.reduce((t, d) => {
    ['claims', 'approved_claims', 'amount', 'in_process', 'contingency', 'conference', 'rejected_returned'].forEach((k) => { t[k] += d[k]; });
    return t;
  }, blank());
  const byPeriod = (m) => [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
  return {
    totals,
    by_department,
    by_faculty: [...fac.values()].sort((a, b) => a.dept_code.localeCompare(b.dept_code) || b.amount - a.amount),
    by_month: byPeriod(month), by_week: byPeriod(week),
    by_category: [...cat.values()].sort((a, b) => b.amount - a.amount),
  };
}

const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } } };
function sheet(wb, name, columns, rows, { totalRow } = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.h, key: c.k, width: c.w || 14, style: c.money ? { numFmt: '#,##0.00' } : c.date ? { numFmt: 'dd-mmm-yyyy' } : {} }));
  ws.getRow(1).eachCell((cell) => { cell.font = HEAD.font; cell.fill = HEAD.fill; cell.alignment = { vertical: 'middle', wrapText: true }; });
  rows.forEach((r) => ws.addRow(r));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };   // Excel filter drop-downs
  if (totalRow && rows.length) {
    const t = ws.addRow(totalRow); t.font = { bold: true };
  }
  return ws;
}

function workbook({ filters, agg, rows, items }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'CPDA Portal'; wb.created = new Date();
  const F = (k) => filters[k] || 'All';
  const s = wb.addWorksheet('Summary'); s.columns = [{ width: 38 }, { width: 28 }];
  [['CPDA analysis report', ''], ['Generated', new Date().toLocaleString('en-IN')], ['', ''],
    ['Department', F('dept_label')], ['Financial year', filters.fy ? fyLabel(Number(filters.fy)) : 'All'], ['Calendar year', F('year')],
    ['Month', filters.month ? MONTHS[Number(filters.month) - 1] : 'All'], ['Week (ISO)', F('week')], ['Status', F('status_label')], ['Date used', filters.basis === 'paid' ? 'Payment date' : 'Date claim was submitted'],
    ['', ''], ['Claims in selection', agg.totals.claims], ['Approved / paid claims', agg.totals.approved_claims],
    ['TOTAL AMOUNT TO DEPARTMENT(S) - approved + paid (Rs)', agg.totals.amount], ['   of which Contingency / Membership', agg.totals.contingency],
    ['   of which Conference / TA', agg.totals.conference], ['In process (not yet approved) (Rs)', agg.totals.in_process], ['Rejected / returned claims', agg.totals.rejected_returned],
  ].forEach((r) => s.addRow(r));
  s.getRow(1).font = { bold: true, size: 14 }; s.getRow(14).font = { bold: true };
  [14, 15, 16, 17].forEach((n) => { s.getRow(n).getCell(2).numFmt = '#,##0.00'; });

  const deptCols = agg.by_department.map((d) => d.code);
  sheet(wb, 'By Department', [
    { h: 'Dept', k: 'code', w: 9 }, { h: 'Department', k: 'name', w: 34 }, { h: 'Faculty who claimed', k: 'faculty', w: 12 }, { h: 'Claims', k: 'claims', w: 9 },
    { h: 'Approved / paid claims', k: 'approved_claims', w: 12 }, { h: 'AMOUNT TO DEPARTMENT (Rs)', k: 'amount', w: 18, money: true },
    { h: 'Contingency (Rs)', k: 'contingency', w: 16, money: true }, { h: 'Conference (Rs)', k: 'conference', w: 16, money: true },
    { h: 'In process (Rs)', k: 'in_process', w: 16, money: true }, { h: 'Rejected / returned', k: 'rejected_returned', w: 11 },
    { h: 'Share of total %', k: 'share', w: 11 }, { h: 'Block allocation (Rs)', k: 'allocated_block', w: 18, money: true }, { h: 'Block spent (Rs)', k: 'spent_block', w: 16, money: true },
  ], agg.by_department.map((d) => ({ ...d, share: agg.totals.amount ? Math.round((d.amount / agg.totals.amount) * 1000) / 10 : 0 })),
  { totalRow: { code: 'TOTAL', claims: agg.totals.claims, approved_claims: agg.totals.approved_claims, amount: agg.totals.amount, contingency: agg.totals.contingency, conference: agg.totals.conference, in_process: agg.totals.in_process, rejected_returned: agg.totals.rejected_returned } });

  sheet(wb, 'By Faculty', [
    { h: 'Dept', k: 'dept_code', w: 9 }, { h: 'Faculty', k: 'name', w: 28 }, { h: 'Emp code', k: 'emp_code', w: 12 }, { h: 'Claims', k: 'claims', w: 9 },
    { h: 'Approved / paid claims', k: 'approved_claims', w: 12 }, { h: 'AMOUNT (Rs)', k: 'amount', w: 16, money: true }, { h: 'Contingency (Rs)', k: 'contingency', w: 16, money: true },
    { h: 'Conference (Rs)', k: 'conference', w: 16, money: true }, { h: 'In process (Rs)', k: 'in_process', w: 16, money: true }, { h: 'Rejected / returned', k: 'rejected_returned', w: 11 },
  ], agg.by_faculty);

  const pivot = (list) => list.map((m) => ({ ...m, ...Object.fromEntries(deptCols.map((c) => [`d_${c}`, m.by_dept[c] || 0])) }));
  const pcols = (first) => [first, { h: 'Claims', k: 'claims', w: 9 }, { h: 'AMOUNT (Rs)', k: 'amount', w: 16, money: true }, { h: 'Contingency (Rs)', k: 'contingency', w: 16, money: true },
    { h: 'Conference (Rs)', k: 'conference', w: 16, money: true }, { h: 'In process (Rs)', k: 'in_process', w: 16, money: true },
    ...deptCols.map((c) => ({ h: `${c} (Rs)`, k: `d_${c}`, w: 14, money: true }))];
  sheet(wb, 'By Month', pcols({ h: 'Month', k: 'label', w: 12 }), pivot(agg.by_month));
  sheet(wb, 'By Week', pcols({ h: 'ISO week', k: 'period', w: 12 }), pivot(agg.by_week));
  sheet(wb, 'By Category', [{ h: 'Category', k: 'category', w: 34 }, { h: 'Lines', k: 'lines', w: 9 }, { h: 'Approved / paid amount (Rs)', k: 'amount', w: 22, money: true }], agg.by_category);

  sheet(wb, 'All claims', [
    { h: 'Claim no', k: 'claim_no', w: 20 }, { h: 'Dept', k: 'dept_code', w: 8 }, { h: 'Faculty', k: 'name', w: 26 }, { h: 'Emp code', k: 'emp_code', w: 11 },
    { h: 'Type', k: 'type', w: 16 }, { h: 'Title', k: 'title', w: 32 }, { h: 'Status', k: 'status', w: 12 }, { h: 'Claimed (Rs)', k: 'total', w: 14, money: true },
    { h: 'Passed (Rs)', k: 'passed', w: 14, money: true }, { h: 'Submitted', k: 'submitted_at', w: 14, date: true }, { h: 'Paid', k: 'paid_at', w: 14, date: true },
    { h: 'Financial year', k: 'fy_label', w: 11 }, { h: 'Year', k: 'year', w: 7 }, { h: 'Month', k: 'month_name', w: 8 }, { h: 'ISO week', k: 'week_label', w: 10 }, { h: 'Block', k: 'block_label', w: 10 },
  ], rows.map((r) => ({ ...r, type: r.kind === 'CONFERENCE' ? 'Conference / TA' : 'Contingency', passed: GONE.includes(r.status) ? passedOf(r) : null,
    fy_label: fyLabel(r.fy), month_name: MONTHS[r.month - 1] })));

  const byId = new Map(rows.map((r) => [r.id, r]));
  sheet(wb, 'Expense lines', [
    { h: 'Claim no', k: 'claim_no', w: 20 }, { h: 'Dept', k: 'dept_code', w: 8 }, { h: 'Faculty', k: 'name', w: 26 }, { h: 'Status', k: 'status', w: 12 }, { h: 'Category', k: 'category', w: 30 },
    { h: 'Party', k: 'party', w: 28 }, { h: 'Invoice no', k: 'invoice_no', w: 14 }, { h: 'Invoice date', k: 'invoice_date', w: 14, date: true }, { h: 'Amount (Rs)', k: 'amount', w: 14, money: true },
    { h: 'Financial year', k: 'fy_label', w: 11 }, { h: 'Year', k: 'year', w: 7 }, { h: 'Month', k: 'month_name', w: 8 }, { h: 'ISO week', k: 'week_label', w: 10 },
  ], items.map((i) => { const r = byId.get(i.claim_id) || {}; return { ...i, claim_no: r.claim_no, dept_code: r.dept_code, name: r.name, status: r.status, fy_label: r.fy != null ? fyLabel(r.fy) : '', year: r.year, month_name: MONTHS[(r.month || 1) - 1], week_label: r.week_label,
    invoice_date: i.invoice_date ? new Date(String(i.invoice_date).slice(0, 10) + 'T00:00:00') : null }; }));
  return wb;
}

module.exports = { aggregate, workbook, fyLabel, GONE };
