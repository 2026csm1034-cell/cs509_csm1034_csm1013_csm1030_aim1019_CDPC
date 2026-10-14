import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, KIND_LABEL, Loading, PageHead, StatusBadge, Tracker, fmtDT, fmtDate, money, useLoad, Field } from '../ui.jsx';

const SEV = { hard: 'err', soft: 'warn', info: 'ok' };
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');

function ActionPanel({ d, reload }) {
  const { claim, current_step_def: step, juniors } = d;
  const [comment, setComment] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reg, setReg] = useState({ register_page: '', register_sr: '', stock_register_no: '', budget_head: claim.kind === 'CONFERENCE' ? 'CPDA - Conference' : 'CPDA - Contingency', amount_passed: claim.total });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async (action) => {
    setBusy(true); setError(null);
    try {
      await api(`/claims/${claim.id}/action`, { method: 'POST', body: { action, comment, assignee_id: assignee ? Number(assignee) : undefined, register: step.register ? reg : undefined } });
      setComment(''); reload();
    } catch (e) { setError(e); }
    setBusy(false);
  };
  return (
    <div className="panel" style={{ borderColor: 'var(--blue)' }}>
      <h3>Your action: {step.label}</h3>
      <ErrorBox error={error} />
      {claim.special_request && <div className="alert warn"><b>Special approval requested.</b> {claim.special_reason}</div>}
      {step.assign && (
        <Field label="Assign to junior accounts staff">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Select...</option>{juniors.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
        </Field>
      )}
      {step.register && (
        <>
          <div className="grid2">
            <Field label="CPDA register page no."><input value={reg.register_page} onChange={(e) => setReg({ ...reg, register_page: e.target.value })} /></Field>
            <Field label="Serial no."><input value={reg.register_sr} onChange={(e) => setReg({ ...reg, register_sr: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Budget head"><input value={reg.budget_head} onChange={(e) => setReg({ ...reg, budget_head: e.target.value })} /></Field>
            <Field label="Amount passed (Rs)"><input type="number" value={reg.amount_passed} onChange={(e) => setReg({ ...reg, amount_passed: e.target.value })} /></Field>
          </div>
          <Field label="Stock register entry no. (for purchased items)"><input value={reg.stock_register_no} onChange={(e) => setReg({ ...reg, stock_register_no: e.target.value })} /></Field>
        </>
      )}
      <Field label="Comment" hint="Required to reject or return."><textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy} onClick={() => go('approve')}>{step.key === 'HOD' ? 'Recommend' : 'Approve'}</button>
        <button className="btn warn" disabled={busy} onClick={() => go('return')}>Return for correction</button>
        <button className="btn danger" disabled={busy} onClick={() => go('reject')}>Reject</button>
      </div>
    </div>
  );
}

function PayPanel({ d, reload }) {
  const [ref, setRef] = useState('');
  const [error, setError] = useState(null);
  const pay = async () => {
    try { await api(`/claims/${d.claim.id}/pay`, { method: 'POST', body: { payment_ref: ref } }); reload(); } catch (e) { setError(e); }
  };
  return (
    <div className="panel" style={{ borderColor: 'var(--green)' }}>
      <h3>Approved: pass for payment</h3>
      <ErrorBox error={error} />
      <Field label="Payment reference (NEFT / cheque no.)"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <button className="btn primary" onClick={pay}>Mark as paid</button>
    </div>
  );
}

export default function ClaimDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useLoad(() => api(`/claims/${id}`), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { claim: c, faculty, items, attachments, approvals, summary, steps, can } = d;
  return (
    <>
      <PageHead title={c.title} sub={`${c.claim_no || 'Draft'} - ${KIND_LABEL[c.kind]} - ${faculty.name} (${faculty.dept_code})`}>
        <StatusBadge status={c.status} />{' '}
        {can.edit && <Link className="btn" to={`/claims/${c.id}/edit`}>{c.status === 'RETURNED' ? 'Correct and resubmit' : 'Edit draft'}</Link>}{' '}
        {c.claim_no && <a className="btn" href={`/api/claims/${c.id}/pdf`} target="_blank" rel="noreferrer">Claim form (PDF)</a>}{' '}
        <button className="btn" onClick={() => nav(-1)}>Back</button>
      </PageHead>

      {c.status === 'RETURNED' && <div className="alert warn"><b>Returned for correction.</b> {[...approvals].reverse().find((a) => a.decision === 'RETURNED')?.comment}</div>}
      {c.status === 'REJECTED' && <div className="alert err"><b>Rejected.</b> {[...approvals].reverse().find((a) => a.decision === 'REJECTED')?.comment}</div>}
      {c.special_request && <div className="alert warn"><b>Special approval requested:</b> {c.special_reason}</div>}

      <div className="cols">
        <div>
          {can.act && <ActionPanel d={d} reload={reload} />}
          {can.pay && <PayPanel d={d} reload={reload} />}

          <div className="panel">
            <h3>Expense lines</h3>
            <div className="tablewrap" style={{ border: 'none' }}>
              <table className="t">
                <thead><tr><th>Category</th><th>Particulars</th><th>Invoice</th><th className="num">Amount</th></tr></thead>
                <tbody>{items.map((i) => <tr key={i.id}><td>{i.category}</td><td>{i.party}{i.remarks && <div className="small muted">{i.remarks}</div>}</td><td className="small">{i.invoice_no}<div className="muted">{fmtDate(i.invoice_date)}</div></td><td className="num">{money(i.amount)}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan="3">Total</td><td className="num">{money(c.total)}</td></tr></tfoot>
              </table>
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              {c.kind === 'CONFERENCE' && (<><dt>Event</dt><dd>{c.event_name} ({c.event_type}), {c.event_location}, {fmtDate(c.event_start)} to {fmtDate(c.event_end)}</dd>
                <dt>Prior approval</dt><dd>{c.prior_approval_ref || '-'}</dd><dt>Attended</dt><dd>{c.attended ? 'Yes' : 'No'}</dd></>)}
              <dt>Reimburse to</dt><dd>{c.pay_to === 'VENDOR' ? 'Vendor' : 'Faculty member'}{c.is_advance && ' (advance requested)'}</dd>
              {c.register_page && (<><dt>CPDA register</dt><dd>Page {c.register_page}, Sr. {c.register_sr}{c.stock_register_no && `, stock register ${c.stock_register_no}`}</dd><dt>Budget head</dt><dd>{c.budget_head}</dd>
                <dt>Amount passed</dt><dd>{money(c.amount_passed)}</dd></>)}
              {c.paid_at && (<><dt>Payment</dt><dd>Paid {fmtDate(c.paid_at)}{c.payment_ref && ` (ref ${c.payment_ref})`}</dd></>)}
            </dl>
          </div>

          <div className="panel">
            <h3>Bills ({attachments.length})</h3>
            {attachments.length === 0 && <p className="muted">No bills attached.</p>}
            <table className="t"><tbody>
              {attachments.map((a) => (
                <tr key={a.id}><td><a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.file_name}</a></td><td className="small muted">{kb(a.size_bytes)}</td>
                  <td className="small muted" title="SHA-256 fingerprint: proves the bill has not been altered">sha256 {a.sha256.slice(0, 12)}...</td></tr>
              ))}
            </tbody></table>
          </div>

          {c.violations && c.violations.filter((v) => v.severity !== 'info').length > 0 && (
            <div className="panel"><h3>Rule exceptions recorded at submission</h3>
              {c.violations.filter((v) => v.severity !== 'info').map((v, i) => <div key={i} className={`alert ${SEV[v.severity]}`}>{v.message}</div>)}</div>
          )}
        </div>

        <div>
          <div className="panel"><h3>Where is it?</h3>
            {['DRAFT'].includes(c.status) ? <p className="muted">Not submitted yet.</p> : <Tracker steps={steps} claim={c} approvals={approvals} />}
          </div>
          <div className="panel"><h3>Sign-off trail</h3>
            {approvals.length === 0 && <p className="muted">No actions yet.</p>}
            {approvals.map((a) => (
              <div key={a.id} style={{ marginBottom: 12 }}>
                <b>{a.decision === 'SUBMITTED' ? 'Submitted' : a.decision === 'APPROVED' ? 'Approved' : a.decision === 'REJECTED' ? 'Rejected' : a.decision === 'RETURNED' ? 'Returned' : 'Paid'}</b> - {a.step_label}
                <div className="small muted">{a.actor_name}, {fmtDT(a.created_at)}</div>
                {a.comment && <div className="small">{a.comment}</div>}
              </div>
            ))}
          </div>
          {summary && (
            <div className="panel"><h3>Faculty account now</h3>
              <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
                <dt>Grant incl. carry-in</dt><dd className="num">{money(summary.total_grant)}</dd><dt>Spent</dt><dd className="num">{money(summary.expenditure)}</dd>
                <dt>In process</dt><dd className="num">{money(summary.commitment)}</dd><dt><b>Balance</b></dt><dd className="num"><b>{money(summary.balance)}</b></dd>
                <dt>Conference cap left</dt><dd className="num">{money(summary.conf_remaining)}</dd>
              </dl></div>
          )}
        </div>
      </div>
    </>
  );
}
