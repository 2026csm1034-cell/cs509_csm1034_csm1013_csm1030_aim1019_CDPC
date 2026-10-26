import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorBox, Field, Loading, PageHead, money, useLoad } from '../ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const SEV = { hard: 'err', soft: 'warn', info: 'ok' };

// Rows of the institute's paper form, in the same order. `cats` are the portal categories each row accepts.
const ROWS = {
  CONTINGENT: [
    { label: 'Membership Fees', note: '(Maximum three in one Block Year)', cats: ['Membership Fees'] },
    { label: 'Purchase of Consumables', note: '(for Pursuing research purpose)', cats: ['Consumables (research)'] },
    { label: 'Purchase of Books & Stationery', cats: ['Books & Stationery', 'Library Books'] },
    { label: 'Purchase of Computer related consumables', cats: ['Computer Consumables'] },
    { label: 'Repair and Maintenance of Computer', cats: ['Repair & Maintenance of Computer'] },
    { label: 'Publication Charges in Journals and Conferences', cats: ['Publication Charges'] },
    { label: 'Any other', cats: ['Any other', 'Subscription'] },
  ],
  CONFERENCE: [
    { label: 'Registration Fee', cats: ['Registration Fee'] },
    { label: 'Travel (TA/DA)', cats: ['Travel (TA/DA)'] },
    { label: 'Visa Fee', cats: ['Visa Fee'] },
    { label: 'Accommodation & Other', cats: ['Accommodation & Other'] },
  ],
};
const uid = () => Math.random().toString(36).slice(2);
const blank = (category) => ({ _k: uid(), category, party: '', invoice_no: '', invoice_date: '', amount: '', remarks: '' });
const isBlank = (i) => !i.party && !i.invoice_no && !i.invoice_date && !i.amount && !i.remarks;

// one line per form row, plus any lines that already exist
function seed(kind, items = []) {
  const rows = ROWS[kind];
  const known = new Set(rows.flatMap((r) => r.cats));
  const out = [];
  rows.forEach((r) => {
    const mine = items.filter((i) => r.cats.includes(i.category));
    out.push(...(mine.length ? mine.map((i) => ({ ...i, _k: i._k || uid() })) : [blank(r.cats[0])]));
  });
  items.filter((i) => !known.has(i.category)).forEach((i) => out.push({ ...i, _k: uid(), category: rows[rows.length - 1].cats[0] }));
  return out;
}

export default function ClaimForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const meta = useLoad(() => api('/claims/meta'));
  const prefill = useLoad(() => api('/claims/prefill'));
  const existing = useLoad(() => (id ? api(`/claims/${id}`) : Promise.resolve(null)), [id]);
  const [f, setF] = useState({
    kind: 'CONTINGENT', title: '', event_name: '', event_location: '', event_type: 'National', event_start: '', event_end: '',
    prior_approval_ref: '', attended: false, pay_to: 'FACULTY', is_advance: false, special_request: false, special_reason: '',
  });
  const [items, setItems] = useState(() => seed('CONTINGENT'));
  const [files, setFiles] = useState([]);
  const [savedId, setSavedId] = useState(id ? Number(id) : null);
  const [oldFiles, setOldFiles] = useState([]);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const fileRef = useRef();

  // load an existing claim (edit / resubmit)
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const c = d.claim;
    setF((p) => ({ ...p, kind: c.kind, title: c.title, event_name: c.event_name || '', event_location: c.event_location || '', event_type: c.event_type || 'National',
      event_start: c.event_start || '', event_end: c.event_end || '', prior_approval_ref: c.prior_approval_ref || '', attended: c.attended, pay_to: c.pay_to, is_advance: c.is_advance }));
    setItems(seed(c.kind, d.items.map((i) => ({ category: i.category, party: i.party, invoice_no: i.invoice_no, invoice_date: String(i.invoice_date).slice(0, 10), amount: i.amount, remarks: i.remarks || '' }))));
    setOldFiles(d.attachments);
  }, [existing.data]);

  // remember how this person was reimbursed last time
  useEffect(() => {
    if (!id && prefill.data && prefill.data.pay_to) setF((p) => ({ ...p, pay_to: prefill.data.pay_to }));
  }, [prefill.data, id]);

  const rows = ROWS[f.kind];
  const filled = items.filter((i) => !isBlank(i));
  const total = filled.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const autoTitle = () => {
    if (f.title.trim()) return f.title.trim();
    if (f.kind === 'CONFERENCE') return f.event_name ? `${f.event_name} - conference claim` : 'Conference claim';
    const cats = [...new Set(filled.map((i) => rows.find((r) => r.cats.includes(i.category))?.label).filter(Boolean))];
    return cats.length ? cats.slice(0, 2).join(', ') + (cats.length > 2 ? ' and more' : '') : 'Contingency claim';
  };
  const payload = () => ({ ...f, title: autoTitle(), items: filled.map(({ _k, ...i }) => ({ ...i, amount: Number(i.amount) })) });

  // live rule check, debounced
  useEffect(() => {
    if (!filled.length) { setCheck(null); return undefined; }
    const t = setTimeout(() => {
      api('/claims/check', { method: 'POST', body: { ...payload(), id: savedId } }).then(setCheck).catch(() => setCheck(null));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [f, items, savedId, files.length]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setKind = (kind) => { setF({ ...f, kind }); setItems(seed(kind)); };
  const setItem = (idx, k, v) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const onParty = (idx, row, v) => {
    const hit = (prefill.data?.parties || []).find((p) => row.cats.includes(p.category) && p.party === v);
    setItems(items.map((it, i) => (i === idx ? { ...it, party: v, remarks: it.remarks || (hit && hit.remarks) || '' } : it)));
  };

  const copyPrevious = async () => {
    if (!copyFrom) return;
    try {
      const d = await api(`/claims/${copyFrom}`);
      const c = d.claim;
      setF((p) => ({ ...p, kind: c.kind, title: '', event_name: c.event_name || '', event_location: c.event_location || '', event_type: c.event_type || 'National', pay_to: c.pay_to }));
      // keep who / what / remarks; invoice number, date and amount are new each time
      setItems(seed(c.kind, d.items.map((i) => ({ category: i.category, party: i.party, invoice_no: '', invoice_date: '', amount: '', remarks: i.remarks || '' }))));
      setCopyFrom('');
    } catch (e) { setError(e); }
  };

  const save = async () => {
    const body = payload();
    const r = savedId ? await api(`/claims/${savedId}`, { method: 'PUT', body }) : await api('/claims', { method: 'POST', body });
    setSavedId(r.id);
    for (const file of files) {
      const form = new FormData(); form.append('file', file);
      await api(`/claims/${r.id}/attachments`, { method: 'POST', form });
    }
    setFiles([]); if (fileRef.current) fileRef.current.value = '';
    return r.id;
  };
  // Downloads the filled form straight away (the browser saves it; no new tab, no page change)
  const download = (cid) => { const a = document.createElement('a'); a.href = `/api/claims/${cid}/pdf`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const run = async (submit, andDownload = false) => {
    setBusy(true); setError(null);
    try {
      const cid = await save();
      if (submit) await api(`/claims/${cid}/submit`, { method: 'POST', body: { special_request: f.special_request, special_reason: f.special_reason } });
      if (andDownload) download(cid);
      nav(`/claims/${cid}`);
    } catch (e) { setError(e); setBusy(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  if (meta.loading || existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const soft = check && check.violations.some((v) => v.severity === 'soft');
  const hard = check && check.violations.some((v) => v.severity === 'hard');
  const acct = prefill.data && prefill.data.account;
  const sum = (check && check.summary) || (acct && acct.summary) || null;
  const prof = (prefill.data && prefill.data.profile) || { name: user.name, emp_code: user.emp_code, designation: user.designation, dept_name: user.dept_name };
  const grouped = rows.map((r) => ({ ...r, lines: items.map((it, idx) => ({ it, idx })).filter((x) => r.cats.includes(x.it.category)) }));
  const dash = (v) => (v === undefined || v === null || v === '' ? '' : money(v));

  return (
    <>
      <PageHead title={id ? 'Edit claim' : 'New CPDA claim'} sub="The form below is the institute's reimbursement form. Your details are already filled in; add only the bills." />
      <ErrorBox error={error} />
      <div className="cols">
        <div>
          <div className="panel">
            <div className="seg wide" role="group">
              <button type="button" className={f.kind === 'CONTINGENT' ? 'on' : ''} onClick={() => setKind('CONTINGENT')}>Contingency / Membership</button>
              <button type="button" className={f.kind === 'CONFERENCE' ? 'on' : ''} onClick={() => setKind('CONFERENCE')}>Conference / Workshop / Training</button>
            </div>
            <div className="grid2">
              <Field label="Claim title (optional)" hint="Left empty, it is made from the categories you use."><input value={f.title} onChange={set('title')} placeholder={autoTitle()} /></Field>
              {prefill.data && prefill.data.previous.length > 0 && !id && (
                <Field label="Start from an earlier claim" hint="Copies party names and remarks; you add the new invoice details.">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                      <option value="">Choose...</option>
                      {prefill.data.previous.map((p) => <option key={p.id} value={p.id}>{(p.claim_no || 'Draft') + ' - ' + p.title}</option>)}
                    </select>
                    <button type="button" className="btn" disabled={!copyFrom} onClick={copyPrevious}>Use</button>
                  </div>
                </Field>
              )}
            </div>
          </div>

          {/* ---------- the paper form ---------- */}
          <div className="paper">
            <div className="inst">
              <div className="hi">भारतीय प्रौद्योगिकी संस्थान रोपड़</div>
              <div className="en">INDIAN INSTITUTE OF TECHNOLOGY ROPAR</div>
              <div className="ad">Rupnagar, Punjab-140001</div>
              <hr />
            </div>
            <div className="ftitle">REIMBURSEMENT FORM FOR 'CPDA'</div>

            <div className="pf"><b>1. Name of Employee</b><div className="v">{prof.name}</div></div>
            <div className="pf"><b>2. Designation &amp; Department</b><div className="v">{[prof.designation, prof.dept_name].filter(Boolean).join(', ') || <span className="muted">Not set - ask the Admin to add your designation</span>}</div></div>
            <div className="pf"><b>3. Employee Code</b><div className="v">{prof.emp_code}</div></div>
            <div className="prefilled">Filled in from your profile.</div>

            {f.kind === 'CONFERENCE' && (
              <div className="evbox">
                <h4>Conference / workshop details</h4>
                <div className="grid2">
                  <Field label="Name"><input value={f.event_name} onChange={set('event_name')} /></Field>
                  <Field label="Location"><input value={f.event_location} onChange={set('event_location')} /></Field>
                </div>
                <div className="grid3">
                  <Field label="Type"><select value={f.event_type} onChange={set('event_type')}><option>National</option><option>International</option></select></Field>
                  <Field label="Start date"><input type="date" value={f.event_start} onChange={set('event_start')} /></Field>
                  <Field label="End date"><input type="date" value={f.event_end} onChange={set('event_end')} max={today()} /></Field>
                </div>
                <Field label="Prior approval reference" hint="Participation requires prior approval."><input value={f.prior_approval_ref} onChange={set('prior_approval_ref')} /></Field>
                <div className="check"><input id="att" type="checkbox" checked={f.attended} onChange={set('attended')} /><label htmlFor="att">I attended the event. (Expenses are not reimbursable otherwise.)</label></div>
              </div>
            )}

            <table className="pt">
              <colgroup><col style={{ width: '19%' }} /><col style={{ width: '24%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /><col style={{ width: '14%' }} /></colgroup>
              <thead><tr><th>Category</th><th>Particulars/<br />Party Name</th><th>Invoice No.</th><th>Date of<br />Invoice</th><th>Amount</th><th>Remarks<br />if any</th></tr></thead>
              <tbody>
                {grouped.map((r, ri) => r.lines.map(({ it, idx }, k) => (
                  <tr key={it._k} className={k > 0 ? 'subrow' : ''}>
                    {k === 0 && (
                      <td className="cat" rowSpan={r.lines.length}>
                        {r.label}{r.note && <small>{r.note}</small>}
                        <button type="button" className="addline" onClick={() => setItems([...items, blank(r.cats[0])])}>+ add another line</button>
                      </td>
                    )}
                    <td>
                      {k === 0 && (
                        <datalist id={`pl-${ri}`}>
                          {(prefill.data?.parties || []).filter((p) => r.cats.includes(p.category)).map((p) => <option key={p.party} value={p.party} />)}
                        </datalist>
                      )}
                      {r.cats.length > 1 && (
                        <select value={it.category} onChange={(e) => setItem(idx, 'category', e.target.value)} aria-label="Type">
                          {r.cats.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      )}
                      <input list={`pl-${ri}`} value={it.party} onChange={(e) => onParty(idx, r, e.target.value)} aria-label={`${r.label} party name`} />
                    </td>
                    <td><input value={it.invoice_no} onChange={(e) => setItem(idx, 'invoice_no', e.target.value)} aria-label="Invoice number" /></td>
                    <td><input type="date" max={today()} value={it.invoice_date} onChange={(e) => setItem(idx, 'invoice_date', e.target.value)} aria-label="Invoice date" /></td>
                    <td><input type="number" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(idx, 'amount', e.target.value)} aria-label="Amount" /></td>
                    <td>
                      <input value={it.remarks} onChange={(e) => setItem(idx, 'remarks', e.target.value)} aria-label="Remarks" />
                      {r.lines.length > 1 && <button type="button" className="rm" onClick={() => setItems(items.filter((_, i) => i !== idx))}>remove line</button>}
                    </td>
                  </tr>
                )))}
                <tr className="tot"><td>Total</td><td /><td /><td /><td>{money(total)}</td><td /></tr>
              </tbody>
            </table>

            <p className="cert">It is certified that claim are being made for the professional development which is related with the research and teaching purpose and as per the Institute guidelines of the CPDA Norms vide F. No 01-DR/Misc/IITRPR/6221 dated 05-08-2021. I will take full responsibility for any clarification and refund or to deduct, if it's not as per the guidelines of CPDA Norms.</p>

            <div className="amountline">
              <span>The amount of Rs.</span><span className="blank">{total ? total.toLocaleString('en-IN') : ''}</span>
              <span>may please be reimbursed to</span>
              <label><input type="radio" name="payto" checked={f.pay_to === 'FACULTY'} onChange={() => setF({ ...f, pay_to: 'FACULTY' })} /> me</label>
              <span>/</span>
              <label><input type="radio" name="payto" checked={f.pay_to === 'VENDOR'} onChange={() => setF({ ...f, pay_to: 'VENDOR' })} /> vendor</label>
              <span className="muted">[Please Tick '✓']</span>
            </div>
            <div className="sigrow">
              <div>Date: <b>{fmt(today())}</b></div>
              <div style={{ textAlign: 'right' }}>Signature of the faculty member<div className="esign">Signed electronically as {prof.name} when you press Submit.</div></div>
            </div>

            <div className="grey">
              Recommended/Not recommended &nbsp; Comments, if any ______________________<br />
              <b>Signature of HOD/Coordinator</b> &mdash; completed by your HoD in the portal after you submit.
            </div>
            <div className="grey">
              <h5>For use by Accounts Section only</h5>
              <div className="g3">
                <span>CPDA block <b>{acct ? acct.block_label : ''}</b></span>
                <span>Amount Sanctioned <b>{sum ? dash(sum.total_grant) : ''}</b></span>
                <span>Amount utilized Rs. <b>{sum ? dash(sum.expenditure) : ''}</b></span>
                <span>Budget head(s) under which utilized ________</span>
                <span>Register Page No. ____ Sr. No. ____</span>
                <span>Balance available <b>{sum ? dash(sum.balance) : ''}</b></span>
              </div>
              <div style={{ marginTop: 6 }}>JAA/SAA &nbsp; JAO/AO &nbsp; AR/DR &nbsp; Audit &nbsp; Registrar &nbsp; Dean, FAA &mdash; completed by the Accounts Section and approvers.</div>
            </div>
          </div>

          <div className="panel">
            <h3>Bills</h3>
            <Field label="Attach bills / invoices (PDF, JPG or PNG, up to 5 MB each)">
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles([...e.target.files])} />
            </Field>
            {oldFiles.length > 0 && <p className="small muted">Already attached: {oldFiles.map((a) => <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.file_name} </a>)}</p>}
            <div className="check"><input id="adv" type="checkbox" checked={f.is_advance} onChange={set('is_advance')} /><label htmlFor="adv">This is an advance payment request (needs the Director's special approval)</label></div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 76 }}>
          <div className="panel">
            <h3>Rule check</h3>
            {sum && <p className="small muted" style={{ marginTop: -6 }}>Balance {money(sum.balance)} - Conference/TA cap left {money(sum.conf_remaining)}</p>}
            {!check && <p className="muted">Fill at least one line to check the rules.</p>}
            {check && check.violations.length === 0 && <div className="alert ok">All CPDA rules satisfied.</div>}
            {check && check.violations.map((v, i) => <div key={i} className={`alert ${SEV[v.severity]}`}>{v.message}</div>)}
            {soft && !hard && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="check"><input id="sp" type="checkbox" checked={f.special_request} onChange={set('special_request')} /><label htmlFor="sp">Request special approval of the Director for the points above</label></div>
                {f.special_request && <Field label="Reason (shown to every approver)"><textarea value={f.special_reason} onChange={set('special_reason')} /></Field>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy || !filled.length} onClick={() => run(false)}>Save draft</button>
              <button className="btn" disabled={busy || !filled.length} onClick={() => run(false, true)}>Save &amp; download form</button>
              <button className="btn primary" disabled={busy || hard || !filled.length} onClick={() => run(true)}>{busy ? 'Working...' : 'Submit claim'}</button>
              <button className="btn primary" disabled={busy || hard || !filled.length} onClick={() => run(true, true)}>Submit &amp; download signed form</button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>The downloaded PDF is the institute's form with your digital signature. Your HoD's digital signature is added after recommendation; download it again from the claim page.</p>
            {hard && <p className="small" style={{ color: 'var(--brick)' }}>This claim cannot be submitted because of a rule that cannot be waived.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
