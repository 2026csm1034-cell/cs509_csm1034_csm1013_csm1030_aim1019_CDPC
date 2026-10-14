import React from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { BalanceBar, ErrorBox, Loading, PageHead, fmtDate, money, useLoad } from '../ui.jsx';

const TYPE_LABEL = {
  ALLOCATION: 'Allocation', PRORATA: 'Pro-rata allocation', CARRY_IN: 'Carried forward', COMMITMENT: 'Commitment (claim submitted)',
  COMMITMENT_RELEASE: 'Commitment released', EXPENDITURE: 'Expenditure', ADJUSTMENT_CR: 'Adjustment (credit)', ADJUSTMENT_DR: 'Adjustment (debit)',
};

export default function Ledger() {
  const { id } = useParams();
  const { data, loading, error } = useLoad(async () => {
    let accId = id;
    if (!accId) {
      const me = await api('/accounts/me');
      if (!me.account) return { none: true };
      accId = me.account.id;
    }
    return api(`/accounts/${accId}/ledger`);
  }, [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (data.none) return <div className="alert warn">You have no CPDA account in the active block yet. Please contact Accounts.</div>;
  const { account: a, entries, summary: s, by_fy, settings } = data;
  return (
    <>
      <PageHead title={`CPDA ledger ${a.block_label}`} sub={`${a.name} (${a.emp_code}), ${a.dept_name || ''}`}>
        <a className="btn" href={`/api/accounts/${a.id}/ledger.xlsx`}>Download Excel</a>
      </PageHead>
      <div className="hero">
        <div className="cap">Available balance</div>
        <div className="big">{money(s.balance)}</div>
        <BalanceBar summary={s} />
        <div className="ledgerline">
          <div><small>Allocated</small><b>{money(s.allocated)}</b></div>
          <div><small>Carried forward</small><b>{money(s.carry_in)}</b></div>
          <div><small>Conference / TA cap ({settings.travel_cap_pct}%)</small><b>{money(s.conf_cap)}</b></div>
          <div><small>Cap still available</small><b>{money(s.conf_remaining)}</b></div>
        </div>
      </div>
      <div className="section-title"><h2>By financial year</h2></div>
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>Financial year</th><th className="num">Allocated</th><th className="num">Carried in</th><th className="num">Spent</th><th className="num">In process</th></tr></thead>
          <tbody>{by_fy.map((r) => <tr key={r.fy}><td>{r.label}</td><td className="num">{money(r.allocated)}</td><td className="num">{money(r.carry_in)}</td><td className="num">{money(r.spent)}</td><td className="num">{money(r.committed)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="section-title"><h2>Ledger entries</h2><span className="small muted">Append-only: entries are never edited, only corrected by a new entry.</span></div>
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>Date</th><th>Entry</th><th>Particulars</th><th>Head</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="small">{fmtDate(e.entry_date)}</td>
                <td className="small">{TYPE_LABEL[e.entry_type]}</td>
                <td>{e.particulars}</td>
                <td className="small">{e.bucket === 'CONFERENCE' ? 'Conference / TA' : e.bucket === 'CONTINGENCY' ? 'Contingency' : ''}</td>
                <td className="num" style={{ color: e.signed < 0 ? 'var(--brick)' : 'var(--green)' }}>{e.signed < 0 ? '-' : '+'}{money(e.amount)}</td>
                <td className="num">{money(e.running_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
