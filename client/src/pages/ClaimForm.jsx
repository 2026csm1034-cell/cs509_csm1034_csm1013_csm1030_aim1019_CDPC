import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Field, Loading, PageHead, money, useLoad } from '../ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({ category: '', party: '', invoice_no: '', invoice_date: '', amount: '', remarks: '' });
const SEV = { hard: 'err', soft: 'warn', info: 'ok' };

export default function ClaimForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const meta = useLoad(() => api('/claims/meta'));
  const existing = useLoad(() => (id ? api(`/claims/${id}`) : Promise.resolve(null)), [id]);
  const [f, setF] = useState({
    kind: 'CONTINGENT', title: '', event_name: '', event_location: '', event_type: 'National', event_start: '', event_end: '',
    prior_approval_ref: '', attended: false, pay_to: 'FACULTY', is_advance: false, special_request: false, special_reason: '',
  });
  const [items, setItems] = useState([blankItem()]);
  const [files, setFiles] = useState([]);
  const [savedId, setSavedId] = useState(id ? Number(id) : null);
  const [oldFiles, setOldFiles] = useState([]);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const c = d.claim;
    setF((p) => ({ ...p, kind: c.kind, title: c.title, event_name: c.event_name || '', event_location: c.event_location || '', event_type: c.event_type || 'National',
      event_start: c.event_start || '', event_end: c.event_end || '', prior_approval_ref: c.prior_approval_ref || '', attended: c.attended, pay_to: c.pay_to, is_advance: c.is_advance }));
    setItems(d.items.map((i) => ({ category: i.category, party: i.party, invoice_no: i.invoice_no, invoice_date: i.invoice_date, amount: i.amount, remarks: i.remarks || '' })));
    setOldFiles(d.attachments);
  }, [existing.data]);

  const cats = meta.data ? (f.kind === 'CONFERENCE' ? meta.data.conference_categories : meta.data.contingent_categories) : [];
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const payload = () => ({ ...f, items: items.map((i) => ({ ...i, amount: Number(i.amount) })) });

  // live rule check, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      api('/claims/check', { method: 'POST', body: { ...payload(), id: savedId } }).then(setCheck).catch(() => setCheck(null));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [f, items, savedId, files.length]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setKind = (kind) => { setF({ ...f, kind }); setItems(items.map((i) => ({ ...i, category: '' }))); };
  const setItem = (idx, k, v) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));

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
  const run = async (submit) => {
    setBusy(true); setError(null);
    try {
      const cid = await save();
      if (submit) {
        await api(`/claims/${cid}/submit`, { method: 'POST', body: { special_request: f.special_request, special_reason: f.special_reason } });
      }
      nav(`/claims/${cid}`);
    } catch (e) { setError(e); setBusy(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  if (meta.loading || existing.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  const soft = check && check.violations.some((v) => v.severity === 'soft');
  const hard = check && check.violations.some((v) => v.severity === 'hard');

  return (
    <>
      <PageHead title={id ? 'Edit claim' : 'New CPDA claim'} sub="Fill the same details as the paper reimbursement form. The rules are checked as you type." />
      <ErrorBox error={error} />
      <div className="cols">
        <div>
          <div className="panel">
            <h3>What are you claiming for?</h3>
            <div className="seg" role="group" style={{ marginBottom: 14 }}>
              <button type="button" className={f.kind === 'CONTINGENT' ? 'on' : ''} onClick={() => setKind('CONTINGENT')}>Contingency / Membership</button>
              <button type="button" className={f.kind === 'CONFERENCE' ? 'on' : ''} onClick={() => setKind('CONFERENCE')}>Conference / Workshop / Training</button>
            </div>
            <Field label="Claim title"><input value={f.title} onChange={set('title')} placeholder={f.kind === 'CONFERENCE' ? 'e.g. ICSE conference - paper presentation' : 'e.g. Lab consumables and books'} /></Field>
            {f.kind === 'CONFERENCE' && (
              <>
                <div className="grid2">
                  <Field label="Conference / workshop name"><input value={f.event_name} onChange={set('event_name')} /></Field>
                  <Field label="Location"><input value={f.event_location} onChange={set('event_location')} /></Field>
                </div>
                <div className="grid3">
                  <Field label="Type"><select value={f.event_type} onChange={set('event_type')}><option>National</option><option>International</option></select></Field>
                  <Field label="Start date"><input type="date" value={f.event_start} onChange={set('event_start')} /></Field>
                  <Field label="End date"><input type="date" value={f.event_end} onChange={set('event_end')} max={today()} /></Field>
                </div>
                <Field label="Prior approval reference" hint="Participation requires prior approval."><input value={f.prior_approval_ref} onChange={set('prior_approval_ref')} /></Field>
                <div className="check"><input id="att" type="checkbox" checked={f.attended} onChange={set('attended')} /><label htmlFor="att">I attended the event. (Expenses are not reimbursable otherwise.)</label></div>
              </>
            )}
          </div>

          <div className="panel">
            <h3>Expense lines</h3>
            <div className="lines">
              {items.map((it, i) => (
                <div className="linebox" key={i}>
                  <div className="head"><b>Line {i + 1}</b>{items.length > 1 && <button type="button" className="btn sm danger" onClick={() => setItems(items.filter((_, k) => k !== i))}>Remove</button>}</div>
                  <div className="grid2">
                    <Field label="Category"><select value={it.category} onChange={(e) => setItem(i, 'category', e.target.value)}><option value="">Select...</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
                    <Field label="Particulars / party name"><input value={it.party} onChange={(e) => setItem(i, 'party', e.target.value)} /></Field>
                  </div>
                  <div className="grid3">
                    <Field label="Invoice no."><input value={it.invoice_no} onChange={(e) => setItem(i, 'invoice_no', e.target.value)} /></Field>
                    <Field label="Invoice date"><input type="date" max={today()} value={it.invoice_date} onChange={(e) => setItem(i, 'invoice_date', e.target.value)} /></Field>
                    <Field label="Amount (Rs)"><input type="number" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} /></Field>
                  </div>
                  <Field label="Remarks (optional)"><input value={it.remarks} onChange={(e) => setItem(i, 'remarks', e.target.value)} /></Field>
                </div>
              ))}
            </div>
            <p style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
              <button type="button" className="btn" onClick={() => setItems([...items, blankItem()])}>Add another line</button>
              <span>Total <b style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>{money(total)}</b></span>
            </p>
          </div>

          <div className="panel">
            <h3>Bills and payment</h3>
            <Field label="Attach bills / invoices (PDF, JPG or PNG, up to 5 MB each)">
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles([...e.target.files])} />
            </Field>
            {oldFiles.length > 0 && <p className="small muted">Already attached: {oldFiles.map((a) => <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.file_name} </a>)}</p>}
            <div className="grid2">
              <Field label="Reimburse to"><select value={f.pay_to} onChange={set('pay_to')}><option value="FACULTY">Me (faculty member)</option><option value="VENDOR">Vendor</option></select></Field>
            </div>
            <div className="check"><input id="adv" type="checkbox" checked={f.is_advance} onChange={set('is_advance')} /><label htmlFor="adv">This is an advance payment request (needs the Director's special approval)</label></div>
          </div>
        </div>

        <div style={{ position: 'sticky', top: 76 }}>
          <div className="panel">
            <h3>Rule check</h3>
            {check ? (
              <>
                <p className="small muted" style={{ marginTop: -6 }}>Balance {money(check.summary.balance)} - Conference/TA cap left {money(check.summary.conf_remaining)}</p>
                {check.violations.length === 0 && <div className="alert ok">All CPDA rules satisfied.</div>}
                {check.violations.map((v, i) => <div key={i} className={`alert ${SEV[v.severity]}`}>{v.message}</div>)}
              </>
            ) : <p className="muted">Checking...</p>}
            {soft && !hard && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="check"><input id="sp" type="checkbox" checked={f.special_request} onChange={set('special_request')} /><label htmlFor="sp">Request special approval of the Director for the points above</label></div>
                {f.special_request && <Field label="Reason (shown to every approver)"><textarea value={f.special_reason} onChange={set('special_reason')} /></Field>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy} onClick={() => run(false)}>Save draft</button>
              <button className="btn primary" disabled={busy || hard} onClick={() => run(true)}>{busy ? 'Working...' : 'Submit claim'}</button>
            </div>
            {hard && <p className="small" style={{ color: 'var(--brick)' }}>This claim cannot be submitted because of a rule that cannot be waived.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
