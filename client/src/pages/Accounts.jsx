import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Loading, PageHead, money, useLoad } from '../ui.jsx';

export default function Accounts() {
  const nav = useNavigate();
  const { data, loading, error } = useLoad(() => api('/accounts'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const tot = data.reduce((t, r) => ({ g: t.g + r.summary.total_grant, e: t.e + r.summary.expenditure, c: t.c + r.summary.commitment, b: t.b + r.summary.balance }), { g: 0, e: 0, c: 0, b: 0 });
  return (
    <>
      <PageHead title="Faculty CPDA accounts" sub={data[0] ? `Active block ${data[0].block_label}. Click a row for the full ledger.` : 'No accounts yet.'} />
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>Faculty</th><th>Dept</th><th className="num">Grant incl. carry-in</th><th className="num">Spent</th><th className="num">In process</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/ledger/${r.id}`)}>
                <td>{r.name}<div className="small muted">{r.emp_code} - {r.designation}</div></td>
                <td>{r.dept_code}</td>
                <td className="num">{money(r.summary.total_grant)}</td><td className="num">{money(r.summary.expenditure)}</td>
                <td className="num">{money(r.summary.commitment)}</td><td className="num"><b>{money(r.summary.balance)}</b></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan="2">Total</td><td className="num">{money(tot.g)}</td><td className="num">{money(tot.e)}</td><td className="num">{money(tot.c)}</td><td className="num">{money(tot.b)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
