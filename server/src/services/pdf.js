// Offline reimbursement form: reproduces the paper "REIMBURSEMENT FORM FOR 'CPDA'" (IIT Ropar) on one A4 page,
// pre-filled from the portal so it can be printed, signed by hand and passed on physically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const DEVA_FONT = path.join(__dirname, '..', '..', 'assets', 'fonts', 'FreeSansBold.ttf'); // GNU FreeSans (covers Devanagari)

// Rows of the paper form (contingency claims) and of the conference variant. Order = order on paper.
const CONTINGENT_ROWS = [
  { label: 'Membership Fees', note: '(Maximum three in one Block Year)', cats: ['Membership Fees'] },
  { label: 'Purchase of Consumables', note: '(for Pursuing research purpose)', cats: ['Consumables (research)'] },
  { label: 'Purchase of Books & Stationery', cats: ['Books & Stationery', 'Library Books'] },
  { label: 'Purchase of Computer related consumables', cats: ['Computer Consumables'] },
  { label: 'Repair and Maintenance of Computer', cats: ['Repair & Maintenance of Computer'] },
  { label: 'Publication Charges in Journals and Conferences', cats: ['Publication Charges'] },
  { label: 'Any other', cats: ['Any other', 'Subscription'] },
];
const CONFERENCE_ROWS = [
  { label: 'Registration Fee', cats: ['Registration Fee'] },
  { label: 'Travel (TA/DA)', cats: ['Travel (TA/DA)'] },
  { label: 'Visa Fee', cats: ['Visa Fee'] },
  { label: 'Accommodation & Other', cats: ['Accommodation & Other'] },
];

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => {
  if (!d) return '';
  const s = typeof d === 'string' ? d.slice(0, 10) : null;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const dt = new Date(d);
  return isNaN(dt) ? '' : `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};
const money = (n) => {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  const [i, f] = v.toFixed(2).split('.');
  const last3 = i.slice(-3), rest = i.slice(0, -3);
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  return f === '00' ? grouped : `${grouped}.${f}`;
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function inWords(num) {
  let n = Math.floor(Number(num) || 0);
  if (n <= 0) return '';
  const two = (x) => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? ' ' + ONES[x % 10] : ''));
  const three = (x) => [x >= 100 ? ONES[Math.floor(x / 100)] + ' Hundred' : '', x % 100 ? two(x % 100) : ''].filter(Boolean).join(' ');
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + ' Crore');
  if (lk) parts.push(two(lk) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (n) parts.push(three(n));
  return parts.join(' ') + ' only';
}

function groupItems(kind, items) {
  const rows = (kind === 'CONFERENCE' ? CONFERENCE_ROWS : CONTINGENT_ROWS).map((r) => ({ ...r, items: [] }));
  for (const it of items) {
    const row = rows.find((r) => r.cats.includes(it.category)) || rows[rows.length - 1];
    row.items.push({ ...it, _prefix: it.category !== row.cats[0] && it.category !== row.label ? it.category : '' });
  }
  return rows;
}

/** Streams the filled-in form to `res`. */
function claimPdf(res, d, { filename } = {}) {
  const { claim, faculty, items, approvals, summary, block_label } = d;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 28, bottom: 20, left: 36, right: 36 }, info: { Title: `CPDA reimbursement form ${claim.claim_no || ''}` } });
  doc.pipe(res);
  const L = 36, W = 523, R = L + W, BOTTOM = 815;

  let deva = false;
  try { if (fs.existsSync(DEVA_FONT)) { doc.registerFont('Deva', DEVA_FONT); deva = true; } } catch (_) { deva = false; }

  const ink = '#111', grey = '#666';
  const T = (s, x, y, o = {}) => doc.text(String(s ?? ''), x, y, { lineBreak: false, ...o });
  const dotted = (x1, x2, y) => { doc.save().lineWidth(0.6).strokeColor('#444').dash(1, { space: 1.6 }).moveTo(x1, y).lineTo(x2, y).stroke().undash().restore(); };
  const need = (y, h) => { if (y + h > BOTTOM) { doc.addPage(); return 28; } return y; };
  const lastApproval = (key) => [...approvals].reverse().find((a) => a.decision === 'APPROVED' && [].concat(key).some((k) => String(a.step_key).startsWith(k)));
  const fmtDT = (d) => { const dt = new Date(d); return isNaN(dt) ? '' : `${fmtDate(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`; };
  // Tamper-evident ID: SHA-256 over the claim, its total and who signed when. Anyone can recompute it from the portal record.
  const verifyId = (parts) => crypto.createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 10).toUpperCase();
  const stamp = (x, sy, w, who, when, role, seed) => {
    doc.save();
    doc.lineWidth(0.8).strokeColor('#1b5e9b').roundedRect(x, sy, w, 27, 3).stroke();
    doc.fillColor('#1b5e9b').font('Helvetica-Bold').fontSize(6); T('DIGITALLY SIGNED' + (role ? ' - ' + role : ''), x + 4, sy + 3, { width: w - 8 });
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(7.5); T(who || '', x + 4, sy + 10, { width: w - 8, ellipsis: true });
    doc.fillColor('#444').font('Helvetica').fontSize(5.8); T(`${fmtDT(when)}  |  ID ${verifyId([claim.claim_no || claim.id, claim.total, ...seed])}`, x + 4, sy + 19, { width: w - 8 });
    doc.restore();
  };
  const eNote = (a) => (a ? `e-${a.step_key.includes('OVERRIDE') ? 'approved (A/Section)' : 'approved'}: ${a.actor_name}, ${fmtDate(a.created_at)}` : '');

  // ---------- header
  doc.fillColor(ink);
  if (claim.claim_no) { doc.font('Helvetica').fontSize(7.5).fillColor(grey); T(`Claim No: ${claim.claim_no}`, L, 28, { width: W, align: 'right', lineBreak: false }); doc.fillColor(ink); }
  let y = 40;
  if (deva) { doc.font('Deva').fontSize(13); T('भारतीय प्रौद्योगिकी संस्थान रोपड़', L, y, { width: W, align: 'center' }); y += 17; }
  doc.font('Helvetica-Bold').fontSize(10.5); T('INDIAN INSTITUTE OF TECHNOLOGY ROPAR', L, y, { width: W, align: 'center' }); y += 13;
  doc.font('Helvetica-Bold').fontSize(8.5); T('Rupnagar, Punjab-140001', L, y, { width: W, align: 'center' }); y += 12;
  doc.lineWidth(0.5).strokeColor('#888').moveTo(L + 110, y).lineTo(R - 110, y).stroke(); y += 8;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(9.5); T("REIMBURSEMENT FORM FOR 'CPDA'", L, y, { width: W, align: 'center', underline: true }); y += 20;

  const field = (n, label, value) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink);
    T(`${n}.`, L + 8, y); T(label, L + 28, y); T(':', L + 190, y);
    doc.font('Helvetica').fontSize(9.5); T(value || '', L + 200, y - 1, { width: W - 204 });
    dotted(L + 196, R, y + 10);
    y += 17;
  };
  field(1, 'Name of Employee', faculty.name);
  field(2, 'Designation & Department', [faculty.designation, faculty.dept_name].filter(Boolean).join(', '));
  field(3, 'Employee Code', faculty.emp_code);
  if (claim.kind === 'CONFERENCE') {
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#333');
    const ev = `Conference/Workshop: ${claim.event_name || ''} (${claim.event_type || ''}), ${claim.event_location || ''}, ${fmtDate(claim.event_start)} to ${fmtDate(claim.event_end)}` +
      `${claim.prior_approval_ref ? '  |  Prior approval ref: ' + claim.prior_approval_ref : ''}`;
    doc.text(ev, L + 8, y - 2, { width: W - 8 }); y = doc.y + 4; doc.fillColor(ink);
  }
  y += 4;

  // ---------- table
  const cols = [118, 125, 75, 70, 70, 65];
  const heads = ['Category', 'Particulars/\nParty Name', 'Invoice No.', 'Date of\nInvoice', 'Amount', 'Remarks\nif any'];
  const xs = cols.reduce((a, w, i) => { a.push(i ? a[i - 1] + cols[i - 1] : L); return a; }, []);
  const box = (x, yy, w, h) => doc.save().lineWidth(0.7).strokeColor('#222').rect(x, yy, w, h).stroke().restore();

  const HEAD_H = 30;
  heads.forEach((h, i) => { box(xs[i], y, cols[i], HEAD_H); doc.font('Helvetica-Bold').fontSize(9).fillColor(ink); doc.text(h, xs[i] + 3, y + (h.includes('\n') ? 4 : 10), { width: cols[i] - 6, align: 'center' }); });
  y += HEAD_H;

  const cellH = (txt, w, size) => { doc.font('Helvetica').fontSize(size); return txt ? doc.heightOfString(String(txt), { width: w - 6 }) : 0; };
  const rows = groupItems(claim.kind, items);
  for (const r of rows) {
    const itemHs = r.items.map((it) => Math.max(14, cellH(it.party, cols[1], 8.5), cellH(it.invoice_no, cols[2], 8.5),
      cellH((it._prefix ? it._prefix + (it.remarks ? ' - ' : '') : '') + (it.remarks || ''), cols[5], 7.5)) + 6);
    doc.font('Helvetica').fontSize(9);
    const catH = doc.heightOfString(r.label, { width: cols[0] - 6 }) + (r.note ? 10 : 0) + 10;
    const rowH = Math.max(30, catH, itemHs.reduce((a, b) => a + b, 0));
    y = need(y, rowH);
    cols.forEach((w, i) => box(xs[i], y, w, rowH));
    doc.font('Helvetica').fontSize(9).fillColor(ink); doc.text(r.label, xs[0] + 3, y + 4, { width: cols[0] - 6 });
    if (r.note) { doc.font('Helvetica').fontSize(6); doc.text(r.note, xs[0] + 3, doc.y + 1, { width: cols[0] - 6 }); }
    let iy = y;
    r.items.forEach((it, k) => {
      if (k > 0) doc.save().lineWidth(0.3).strokeColor('#aaa').moveTo(xs[1], iy).lineTo(R, iy).stroke().restore();
      doc.font('Helvetica').fontSize(8.5).fillColor(ink);
      doc.text(it.party || '', xs[1] + 3, iy + 3, { width: cols[1] - 6 });
      doc.text(it.invoice_no || '', xs[2] + 3, iy + 3, { width: cols[2] - 6 });
      doc.text(fmtDate(it.invoice_date), xs[3] + 3, iy + 3, { width: cols[3] - 6 });
      doc.text(money(it.amount), xs[4] + 3, iy + 3, { width: cols[4] - 6 });
      doc.fontSize(7.5).text((it._prefix ? it._prefix + (it.remarks ? ' - ' : '') : '') + (it.remarks || ''), xs[5] + 3, iy + 3, { width: cols[5] - 6 });
      iy += itemHs[k];
    });
    y += rowH;
  }
  // total row
  y = need(y, 22);
  cols.forEach((w, i) => box(xs[i], y, w, 22));
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ink);
  T('Total', xs[0] + 3, y + 6); T(money(claim.total), xs[4] + 3, y + 6, { width: cols[4] - 6 });
  y += 30;

  // ---------- certificate
  y = need(y, 150);
  doc.font('Helvetica').fontSize(8.5).fillColor(ink);
  doc.text('It is certified that claim are being made for the professional development which is related with the research and teaching purpose and as per the Institute guidelines of the CPDA Norms vide F. No 01-DR/Misc/IITRPR/6221 dated 05-08-2021. I will take full responsibility for any clarification and refund or to deduct, if it\'s not as per the guidelines of CPDA Norms.',
    L, y, { width: W, lineGap: 1.5 });
  y = doc.y + 12;

  // amount line with underline fields and circled choice
  let x = L;
  const seg = (txt, o = {}) => { doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5); T(txt, x, y); const w = doc.widthOfString(txt); const at = x; x += w; return { x: at, w }; };
  seg('The amount of Rs. ');
  doc.font('Helvetica-Bold').fontSize(9); T(money(claim.total), x + 2, y - 1); dotted(x, x + 90, y + 10); x += 96;
  seg(' may please be reimbursed to ');
  const me = seg('me'); seg(' / '); const vendor = seg('vendor'); seg(" [Please Tick '");
  doc.save().lineWidth(1).moveTo(x + 1, y + 5).lineTo(x + 4, y + 9).lineTo(x + 10, y).stroke().restore(); x += 12; seg("']");
  const pick = claim.pay_to === 'VENDOR' ? vendor : me;
  doc.save().lineWidth(0.9).strokeColor('#000').ellipse(pick.x + pick.w / 2, y + 4.5, pick.w / 2 + 4, 8).stroke().restore();
  y += 22;

  doc.font('Helvetica').fontSize(8.5).fillColor(ink);
  T('Date: ' + fmtDate(claim.submitted_at || new Date()), L + 2, y + 6);
  T('Signature of the faculty member', R - 190, y, { width: 190, align: 'right' });
  if (claim.status !== 'DRAFT' && claim.submitted_at) stamp(R - 150, y + 12, 150, faculty.name, claim.submitted_at, 'APPLICANT', ['SUBMIT', faculty.emp_code]);
  else { doc.font('Helvetica-Oblique').fontSize(7).fillColor(grey); T('Draft - not yet submitted. Sign here.', R - 200, y + 14, { width: 200, align: 'right' }); doc.fillColor(ink); }
  y += 42;

  // recommendation
  y = need(y, 70);
  const hod = lastApproval('HOD');
  const rejHod = [...approvals].reverse().find((a) => String(a.step_key).startsWith('HOD'));
  doc.font('Helvetica').fontSize(8.5);
  const rec = { x: L, y };
  T('Recommended', L, y); const wRec = doc.widthOfString('Recommended'); T('/Not recommended', L + wRec, y);
  if (hod) doc.save().lineWidth(0.9).ellipse(L + wRec / 2, y + 4.5, wRec / 2 + 4, 8).stroke().restore();
  y += 16;
  T('Comments, if any', L, y); dotted(L + 78, L + 270, y + 10);
  const hodComment = hod && hod.comment ? hod.comment : (rejHod && rejHod.comment ? rejHod.comment : '');
  if (hodComment) { doc.font('Helvetica').fontSize(8); T(hodComment, L + 80, y - 1, { width: 188 }); }
  y += 26;
  doc.font('Helvetica-Bold').fontSize(8.5); T('Signature of HOD/Coordinator', L, y);
  if (hod) stamp(L, y + 11, 170, hod.actor_name, hod.created_at, 'HOD', ['HOD', hod.actor_name]);
  y += 42;

  // ---------- accounts section
  y = need(y, 190);
  const labelW = doc.font('Helvetica-Bold').fontSize(8.5).widthOfString('For use by Accounts Section only') + 8;
  doc.save().lineWidth(0.7).rect(L + 200, y - 3, labelW, 15).stroke().restore();
  T('For use by Accounts Section only', L + 204, y + 1);
  y += 20; dotted(L, R, y); y += 10;

  const sum = summary || {};
  const line = (parts) => { // parts: [{t, bold}, {v, w}] sequence on one baseline
    let px = L;
    parts.forEach((p) => {
      if (p.t !== undefined) { doc.font(p.bold === false ? 'Helvetica' : 'Helvetica-Bold').fontSize(8.5).fillColor(ink); T(p.t, px, y); px += doc.widthOfString(p.t) + 4; }
      else { doc.font('Helvetica').fontSize(8.5); T(p.v || '', px + 2, y - 1, { width: p.w - 4 }); dotted(px, px + p.w, y + 10); px += p.w + 6; }
    });
    y += 21;
  };
  line([{ t: 'CPDA block' }, { v: block_label, w: 95 }, { t: 'Amount Sanctioned' }, { v: sum.total_grant != null ? money(sum.total_grant) : '', w: 90 }, { t: 'Amount utilized Rs.' }, { v: sum.expenditure != null ? money(sum.expenditure) : '', w: 95 }]);
  line([{ t: 'Budget head(s) under which utilized' }, { v: claim.budget_head || '', w: 305 }]);
  line([{ t: 'This claim entered in CPDA Register Page No.' }, { v: claim.register_page || '', w: 45 }, { t: 'Sr. No.' }, { v: claim.register_sr || '', w: 45 }, { t: 'Passed for payment of Rs.' }, { v: claim.amount_passed ? money(claim.amount_passed) : '', w: 85 }]);
  line([{ t: '(Rs.' }, { v: claim.amount_passed ? inWords(claim.amount_passed) : '', w: 255 }, { t: ') Balance available' }, { v: sum.balance != null ? money(sum.balance) : '', w: 85 }]);
  if (claim.stock_register_no) { doc.font('Helvetica').fontSize(7.5).fillColor(grey); T(`Stock register entry no.: ${claim.stock_register_no}`, L, y - 8); doc.fillColor(ink); y += 6; }

  // ---------- sign-off blocks (wet signatures; portal e-approvals printed beneath each title)
  y = need(y + 10, 140);
  const sig = (label, key, sx, sy, w = 120, align = 'left') => {
    doc.font('Helvetica').fontSize(8.5).fillColor(ink); T(label, sx, sy, { width: w, align });
    const a = key ? lastApproval(key) : null;
    if (a) stamp(sx, sy + 11, Math.max(w, 118), a.actor_name, a.created_at, a.step_key === 'AR_OFFLINE_FINAL' ? 'AR - FINAL (OFFLINE)' : a.step_key === 'AR_REVIEW' ? 'AR' : '', [a.step_key, a.actor_name]);
  };
  const c4 = W / 4;
  sig('JAA/SAA', 'JUNIOR', L + 8, y, c4 - 10);
  sig('JAO/AO', null, L + c4 + 40, y, c4 - 10);
  sig('AR/DR', ['AR_REVIEW', 'AR_OFFLINE_FINAL'], L + 2 * c4 + 40, y, c4 - 10);
  sig('Audit', null, R - 100, y, 100, 'right');
  y += 58;
  sig('Registrar', 'REGISTRAR', L + 8, y, c4 - 10);
  sig('Director', 'DIRECTOR', L + c4 + 40, y, c4 - 10);
  sig('Dean, FAA', 'DEAN_FAA', R - 130, y, 130, 'right');
  y += 44;

  doc.font('Helvetica').fontSize(6.5).fillColor('#888');
  T(`Generated from the CPDA Portal on ${fmtDate(new Date())}${claim.claim_no ? ' - ' + claim.claim_no : ''}. Pre-filled from portal records; blue boxes are digital signatures recorded in the portal (verify the ID there); other boxes are for hand signature.`, L, Math.min(y, 828), { width: W, align: 'center' });
  doc.end();
}

module.exports = { claimPdf, inWords, money };
