import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, Loading, PageHead, STATUS_LABEL, money, useLoad } from '../ui.jsx';

function Bars({ rows, label, value, fmt = money }) {
  const max = Math.max(...rows.map((r) => r[value]), 1);
  return (
    <div>
      {rows.map((r) => (
        <div key={r[label]} style={{ margin: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{r[label]}</span><b className="num">{fmt(r[value])}</b></div>
          <div className="meter"><i style={{ width: (r[value] / max) * 100 + '%' }} /></div>
        </div>
      ))}
    </div>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const curFy = () => { const d = new Date(); return d.getFullYear() - (d.getMonth() < 3 ? 1 : 0); };

function Report() {
  const opts = useLoad(() => api('/report/options'));
  const [q, setQ] = useState({ dept: '', fy: '', year: '', month: '', week: '', status: 'ALL', basis: 'submitted' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const qs = Object.entries(q).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  useEffect(() => {
    let live = true;
    api('/report?' + qs).then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [qs]);
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });
  const fys = Array.from({ length: 6 }, (_, i) => curFy() - i);
  const t = data && data.totals;
  return (
    <>
      <div className="section-title"><h2>Department and faculty report</h2>
        <a className="btn primary" href={`/api/report/export.xlsx?${qs}`} download>Download Excel (with filters)</a>
      </div>
      <div className="panel">
        <div className="reportbar">
          <Field label="Department"><select value={q.dept} onChange={set('dept')} disabled={opts.data && opts.data.hod}>{!(opts.data && opts.data.hod) && <option value="">All departments</option>}{(opts.data ? opts.data.departments : []).map((d) => <option key={d.id} value={d.id}>{d.code} - {d.name}</option>)}</select></Field>
          <Field label="Financial year"><select value={q.fy} onChange={set('fy')}><option value="">All</option>{fys.map((y) => <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, '0')}</option>)}</select></Field>
          <Field label="Year"><select value={q.year} onChange={set('year')}><option value="">All</option>{(opts.data ? opts.data.years : []).map((y) => <option key={y}>{y}</option>)}</select></Field>
          <Field label="Month"><select value={q.month} onChange={set('month')}><option value="">All</option>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Week (1-53)"><input type="number" min="1" max="53" value={q.week} onChange={set('week')} placeholder="All" /></Field>
          <Field label="Status"><select value={q.status} onChange={set('status')}><option value="ALL">All submitted</option><option value="MONEY">Approved + paid</option><option value="IN_REVIEW">In review</option><option value="PAID">Paid</option><option value="REJECTED">Rejected</option></select></Field>
          <Field label="Date used"><select value={q.basis} onChange={set('basis')}><option value="submitted">Submitted date</option><option value="paid">Payment date</option></select></Field>
          <Field label=" "><button className="btn" onClick={() => setQ({ dept: opts.data && opts.data.hod ? q.dept : '', fy: '', year: '', month: '', week: '', status: 'ALL', basis: 'submitted' })}>Clear filters</button></Field>
        </div>
        <ErrorBox error={error} />
        {!data && !error && <p className="muted">Loading...</p>}
        {t && (
          <div className="kpis">
            <div><small>Total amount to department(s) (approved + paid)</small><b>{money(t.amount)}</b></div>
            <div><small>Contingency / membership</small><b>{money(t.contingency)}</b></div>
            <div><small>Conference / TA</small><b>{money(t.conference)}</b></div>
            <div><small>In process</small><b>{money(t.in_process)}</b></div>
          </div>
        )}
        {data && (
          <>
            <h3>Department-wise</h3>
            <div className="tablewrap"><table className="t">
              <thead><tr><th>Department</th><th className="num">Faculty</th><th className="num">Claims</th><th className="num">Amount to department</th><th className="num">Contingency</th><th className="num">Conference</th><th className="num">In process</th></tr></thead>
              <tbody>{data.by_department.length === 0 && <tr><td colSpan="7" className="muted">No claims match these filters.</td></tr>}
                {data.by_department.map((d) => <tr key={d.code}><td>{d.code} <span className="small muted">{d.name}</span></td><td className="num">{d.faculty}</td><td className="num">{d.claims}</td><td className="num"><b>{money(d.amount)}</b></td><td className="num">{money(d.contingency)}</td><td className="num">{money(d.conference)}</td><td className="num">{money(d.in_process)}</td></tr>)}</tbody>
              {t && <tfoot><tr><td>Total</td><td /><td className="num">{t.claims}</td><td className="num">{money(t.amount)}</td><td className="num">{money(t.contingency)}</td><td className="num">{money(t.conference)}</td><td className="num">{money(t.in_process)}</td></tr></tfoot>}
            </table></div>
            <h3 style={{ marginTop: 18 }}>Faculty-wise</h3>
            <div className="tablewrap"><table className="t">
              <thead><tr><th>Faculty</th><th>Dept</th><th className="num">Claims</th><th className="num">Amount</th><th className="num">Contingency</th><th className="num">Conference</th><th className="num">In process</th></tr></thead>
              <tbody>{data.by_faculty.map((f) => <tr key={f.user_id}><td>{f.name}<div className="small muted">{f.emp_code}</div></td><td>{f.dept_code}</td><td className="num">{f.claims}</td><td className="num"><b>{money(f.amount)}</b></td><td className="num">{money(f.contingency)}</td><td className="num">{money(f.conference)}</td><td className="num">{money(f.in_process)}</td></tr>)}</tbody>
            </table></div>
            <p className="small muted" style={{ marginBottom: 0 }}>The Excel file has the same filters pre-applied plus drop-down filters on every sheet (department, financial year, year, month, ISO week), and separate sheets by month, week, category and every expense line.</p>
          </>
        )}
      </div>
    </>
  );
}

export default function Analytics() {
  const { data, loading, error } = useLoad(() => api('/analytics'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.block) return <p>No active block.</p>;
  return (
    <>
      <PageHead title="Analytics" sub={`Block ${data.block.label}. Spending recorded in the ledger.`} />
      <Report />
      <div className="section-title"><h2>By department</h2></div>
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>Department</th><th className="num">Faculty</th><th className="num">Allocated</th><th className="num">Spent</th><th className="num">In process</th><th className="num">Used</th></tr></thead>
          <tbody>
            {data.by_department.map((d) => (
              <tr key={d.code}><td>{d.name}</td><td className="num">{d.faculty}</td><td className="num">{money(d.allocated)}</td><td className="num">{money(d.spent)}</td><td className="num">{money(d.committed)}</td>
                <td className="num">{d.allocated ? Math.round(((d.spent + d.committed) / d.allocated) * 100) : 0}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cols" style={{ marginTop: 28, gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel"><h3>Approved spend by category</h3>{data.by_category.length ? <Bars rows={data.by_category} label="category" value="total" /> : <p className="muted">No approved claims yet.</p>}</div>
        <div className="panel"><h3>Claims by status</h3>
          <table className="t"><tbody>{data.by_status.map((s) => <tr key={s.status}><td>{STATUS_LABEL[s.status]}</td><td className="num">{s.n}</td><td className="num">{money(s.total)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="panel">
        <h3>No international conference claimed yet in this block ({data.no_international.length})</h3>
        <p className="small muted">The guidelines expect each faculty member to attend at least one international conference per three-year block.</p>
        <div className="tablewrap"><table className="t"><tbody>{data.no_international.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.emp_code}</td><td>{f.dept_code}</td></tr>)}</tbody></table></div>
      </div>
    </>
  );
}
