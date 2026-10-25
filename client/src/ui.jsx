import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n) => inr.format(Number(n || 0));
export const fmtDate = (d) => (d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export const STATUS_LABEL = { DRAFT: 'Draft', IN_REVIEW: 'In review', RETURNED: 'Returned to you', REJECTED: 'Rejected', APPROVED: 'Approved', PAID: 'Paid' };
export const KIND_LABEL = { CONFERENCE: 'Conference / TA', CONTINGENT: 'Contingency / Membership' };

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => setState({ loading: false, data, error: null })).catch((error) => setState({ loading: false, data: null, error }));
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export const Loading = () => <p className="muted">Loading...</p>;

export function ErrorBox({ error }) {
  if (!error) return null;
  const list = Array.isArray(error.details) ? error.details : [];
  return (
    <div className="alert err" role="alert">
      {error.message}
      {list.length > 0 && <ul>{list.map((d, i) => <li key={i}>{typeof d === 'string' ? d : d.message}</li>)}</ul>}
    </div>
  );
}

export const StatusBadge = ({ status }) => <span className={`badge b-${status}`}>{STATUS_LABEL[status] || status}</span>;

export function PageHead({ title, sub, children }) {
  return (
    <div className="pagehead">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      <div>{children}</div>
    </div>
  );
}

export function ClaimTable({ rows, showFaculty, empty = 'No claims here.' }) {
  const nav = useNavigate();
  if (!rows || !rows.length) return <div className="tablewrap"><div className="empty">{empty}</div></div>;
  return (
    <div className="tablewrap">
      <table className="t">
        <thead>
          <tr><th>Claim</th><th>Details</th><th>Type</th><th className="num">Amount</th><th>Status</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => nav(`/claims/${r.id}`)}>
              <td className="nw small">{r.claim_no || <span className="muted">draft</span>}</td>
              <td>
                {r.title}
                {r.special_request && <span className="flag">special approval</span>}
                {showFaculty && <div className="small muted">{r.faculty_name} ({r.dept_code})</div>}
              </td>
              <td className="small">{KIND_LABEL[r.kind]}</td>
              <td className="num">{money(r.total)}</td>
              <td><StatusBadge status={r.status} />{r.step_label && <div className="small muted">{r.step_label}</div>}</td>
              <td className="small muted">{fmtDT(r.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BalanceBar({ summary }) {
  const total = Math.max(summary.total_grant, 1);
  const pct = (n) => Math.max(0, Math.min(100, (n / total) * 100));
  return (
    <>
      <div className="bar" role="img" aria-label="Spent, in process and available">
        <i className="s" style={{ width: pct(summary.expenditure) + '%' }} />
        <i className="c" style={{ width: pct(summary.commitment) + '%' }} />
        <i className="a" style={{ width: pct(summary.balance) + '%' }} />
      </div>
      <div className="legend">
        <span className="s">Spent <b>{money(summary.expenditure)}</b></span>
        <span className="c">In process <b>{money(summary.commitment)}</b></span>
        <span className="a">Available <b>{money(summary.balance)}</b></span>
      </div>
    </>
  );
}

export function Tracker({ steps, claim, approvals }) {
  const failedIdx = (() => {
    if (!['REJECTED', 'RETURNED'].includes(claim.status)) return -1;
    const last = [...approvals].reverse().find((a) => a.decision === claim.status);
    return last ? steps.findIndex((s) => s.key === last.step_key) : -1;
  })();
  const stateOf = (i) => {
    if (['APPROVED', 'PAID'].includes(claim.status)) {
      // closed offline by Accounts: only steps that were really approved in the portal count as done
      if (approvals.some((a) => a.step_key === 'AR_OFFLINE_FINAL')) return approvals.some((a) => a.decision === 'APPROVED' && String(a.step_key).startsWith(steps[i].key)) ? 'done' : 'skipped';
      return 'done';
    }
    if (claim.status === 'IN_REVIEW') return i < claim.current_step ? 'done' : i === claim.current_step ? 'current' : 'pending';
    if (failedIdx >= 0) return i < failedIdx ? 'done' : i === failedIdx ? 'failed' : 'pending';
    return 'pending';
  };
  return (
    <ol className="tracker">
      {steps.map((s, i) => <li key={s.key} className={stateOf(i)}><i />{s.label}{stateOf(i) === 'skipped' && ' (closed offline)'}</li>)}
    </ol>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

/** Three headline cards: total, contingency/membership, conference/TA. `summary` comes from the ledger. */
export function AmountCards({ summary: s, capPct = 70 }) {
  const pct = (used, cap) => (cap > 0 ? Math.min(100, (used / cap) * 100) : 0);
  const cards = [
    { key: 'total', title: 'Total CPDA amount', sub: 'Whole block grant', left: s.balance, of: s.total_grant, used: s.expenditure + s.commitment,
      rows: [['Spent', s.expenditure], ['In process', s.commitment], ['Carried in', s.carry_in]] },
    { key: 'cont', title: 'Contingency amount', sub: 'Membership, consumables, books, computer, publication', left: s.cont_remaining, of: s.cont_cap, used: s.cont_used,
      rows: [['Spent', s.cont_spent], ['In process', s.cont_committed]] },
    { key: 'conf', title: 'Conference amount', sub: `Conference / TA / DA (up to ${capPct}% of grant)`, left: s.conf_remaining, of: s.conf_cap, used: s.conf_used,
      rows: [['Spent', s.conf_spent], ['In process', s.conf_committed]] },
  ];
  return (
    <div className="amtcards">
      {cards.map((c) => (
        <div key={c.key} className={`amt ${c.key}`}>
          <div className="t">{c.title}</div>
          <div className="sub">{c.sub}</div>
          <div className="left"><small>{c.key === 'total' ? 'Available now' : 'Remaining'}</small>{money(c.left)}</div>
          <div className={'meter' + (pct(c.used, c.of) > 85 ? ' hot' : '')}><i style={{ width: pct(c.used, c.of) + '%' }} /></div>
          <div className="of">{c.key === 'total' ? 'Total grant' : 'Allotted'} <b>{money(c.of)}</b> &middot; used <b>{money(c.used)}</b></div>
          <div className="rows">{c.rows.map(([k, v]) => <span key={k}>{k} <b>{money(v)}</b></span>)}</div>
        </div>
      ))}
    </div>
  );
}
