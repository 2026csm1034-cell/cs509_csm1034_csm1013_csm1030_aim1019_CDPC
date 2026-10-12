import React, { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, money } from '../ui.jsx';

export default function ProrataCalc() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [f, setF] = useState({ doj: '', dor: '', exit_type: 'RETIRE', opted_out_joining_year: false, start_fy: Math.floor((fy - 2021) / 3) * 3 + 2021 });
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const calc = async (e) => {
    e.preventDefault(); setError(null);
    try { setRes(await api('/prorata', { method: 'POST', body: { ...f, dor: f.dor || null, doj: f.doj || null, start_fy: Number(f.start_fy) } })); } catch (err) { setError(err); }
  };
  return (
    <div className="panel">
      <h2>Pro-rata calculator</h2>
      <p className="muted">Credit = yearly entitlement x months in service / 12. Joining and retirement months count; the month of release does not (Guidelines 5 and 10).</p>
      <ErrorBox error={error} />
      <form onSubmit={calc}>
        <div className="grid3">
          <Field label="Block start year (e.g. 2024 for 2024-27)"><input type="number" value={f.start_fy} onChange={set('start_fy')} required /></Field>
          <Field label="Date of joining"><input type="date" value={f.doj} onChange={set('doj')} /></Field>
          <Field label="Date of leaving / retirement"><input type="date" value={f.dor} onChange={set('dor')} /></Field>
        </div>
        <div className="grid3">
          <Field label="Reason for leaving">
            <select value={f.exit_type} onChange={set('exit_type')}><option value="RETIRE">Retirement (month counted)</option><option value="RELEASE">Resignation / release (month not counted)</option></select>
          </Field>
          <div className="check" style={{ alignItems: 'center', marginTop: 22 }}><input id="oo" type="checkbox" checked={f.opted_out_joining_year} onChange={set('opted_out_joining_year')} /><label htmlFor="oo">Opted out of CPDA in the year of joining</label></div>
        </div>
        <button className="btn primary">Calculate</button>
      </form>
      {res && (
        <div className="tablewrap" style={{ marginTop: 18 }}>
          <table className="t">
            <thead><tr><th>Financial year</th><th className="num">Months</th><th>How counted</th><th className="num">Credit</th></tr></thead>
            <tbody>{res.rows.map((r) => <tr key={r.fy}><td>{r.label}</td><td className="num">{r.months}</td><td className="small">{r.note}</td><td className="num">{money(r.credit)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan="3">Total for the block (entitlement {money(res.entitlement)} per year)</td><td className="num">{money(res.total)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
