import React from 'react';
import { api } from '../api.js';
import { ErrorBox, Loading, PageHead, STATUS_LABEL, money, useLoad } from '../ui.jsx';

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

export default function Analytics() {
  const { data, loading, error } = useLoad(() => api('/analytics'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.block) return <p>No active block.</p>;
  return (
    <>
      <PageHead title="Analytics" sub={`Block ${data.block.label}. Spending recorded in the ledger.`} />
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
