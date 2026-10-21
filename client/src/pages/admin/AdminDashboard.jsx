import React, { useState } from 'react';
import { api } from '../../api.js';
import ProrataCalc from '../../components/ProrataCalc.jsx';
import { ErrorBox, Field, Loading, PageHead, Tabs, fmtDT, money, useLoad } from '../../ui.jsx';

function Msg({ ok, error }) {
  return <>{ok && <div className="alert ok">{ok}</div>}<ErrorBox error={error} /></>;
}

const ROLES = ['FACULTY', 'HOD', 'ACCOUNTS_AR', 'ACCOUNTS_JUNIOR', 'REGISTRAR', 'DEAN_FAA', 'DIRECTOR', 'ADMIN'];
const blankUser = { name: '', email: '', emp_code: '', role: 'FACULTY', department_id: '', designation: '', doj: '', dor: '', exit_type: 'RETIRE', opted_out_joining_year: false, probation_cleared: true, on_leave_over_30: false, active: true, password: '' };

function Users() {
  const users = useLoad(() => api('/admin/users'));
  const depts = useLoad(() => api('/departments'));
  const [form, setForm] = useState(null);
  const [ok, setOk] = useState('');
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setError(null); setOk('');
    try {
      const body = { ...form, department_id: form.department_id ? Number(form.department_id) : null, doj: form.doj || null, dor: form.dor || null };
      if (form.id) await api(`/admin/users/${form.id}`, { method: 'PUT', body }); else await api('/admin/users', { method: 'POST', body });
      setOk(form.id ? 'User updated.' : 'User created. Run "Create accounts and allocate" under Blocks so they get a CPDA account.'); setForm(null); users.reload();
    } catch (err) { setError(err); }
  };
  return (
    <>
      <Msg ok={ok} error={error} />
      {form ? (
        <form className="panel" onSubmit={save}>
          <h2>{form.id ? 'Edit user' : 'New user'}</h2>
          <div className="grid3">
            <Field label="Name"><input value={form.name} onChange={set('name')} required /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label="Employee code"><input value={form.emp_code} onChange={set('emp_code')} required /></Field>
          </div>
          <div className="grid3">
            <Field label="Role"><select value={form.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Department"><select value={form.department_id || ''} onChange={set('department_id')}><option value="">None</option>{(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></Field>
            <Field label="Designation"><input value={form.designation || ''} onChange={set('designation')} /></Field>
          </div>
          <div className="grid3">
            <Field label="Date of joining"><input type="date" value={form.doj || ''} onChange={set('doj')} /></Field>
            <Field label="Date of leaving / retirement"><input type="date" value={form.dor || ''} onChange={set('dor')} /></Field>
            <Field label="Leaving reason"><select value={form.exit_type || 'RETIRE'} onChange={set('exit_type')}><option value="RETIRE">Retirement</option><option value="RELEASE">Resignation / release</option></select></Field>
          </div>
          <div className="grid2">
            <div>
              <div className="check"><input id="pc" type="checkbox" checked={form.probation_cleared} onChange={set('probation_cleared')} /><label htmlFor="pc">Probation cleared</label></div>
              <div className="check"><input id="ll" type="checkbox" checked={form.on_leave_over_30} onChange={set('on_leave_over_30')} /><label htmlFor="ll">On deputation / leave beyond 30 days</label></div>
              <div className="check"><input id="oo" type="checkbox" checked={form.opted_out_joining_year} onChange={set('opted_out_joining_year')} /><label htmlFor="oo">Opted out of CPDA in year of joining</label></div>
              <div className="check"><input id="ac" type="checkbox" checked={form.active} onChange={set('active')} /><label htmlFor="ac">Active</label></div>
            </div>
            <Field label={form.id ? 'New password (leave empty to keep)' : 'Password (default Welcome@123)'}><input type="text" value={form.password} onChange={set('password')} /></Field>
          </div>
          <button className="btn primary">Save</button> <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
        </form>
      ) : <p><button className="btn primary" onClick={() => setForm({ ...blankUser })}>Add user</button></p>}
      {users.loading ? <Loading /> : (
        <div className="tablewrap"><table className="t">
          <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Email</th><th>Status</th><th /></tr></thead>
          <tbody>{users.data.map((u) => (
            <tr key={u.id}><td>{u.name}<div className="small muted">{u.emp_code}</div></td><td className="small">{u.role_label}</td><td>{u.dept_code}</td><td className="small">{u.email}</td>
              <td className="small">{u.active ? 'Active' : 'Inactive'}{u.on_leave_over_30 && ' - long leave'}{u.dor && ` - leaves ${u.dor}`}</td>
              <td><button className="btn sm" onClick={() => setForm({ ...u, password: '', doj: u.doj || '', dor: u.dor || '', department_id: u.department_id || '' })}>Edit</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Departments() {
  const depts = useLoad(() => api('/departments'));
  const [f, setF] = useState({ code: '', name: '' });
  const [ok, setOk] = useState(''); const [error, setError] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setError(null); setOk('');
    try { await api('/admin/departments', { method: 'POST', body: f }); setF({ code: '', name: '' }); setOk('Department added.'); depts.reload(); } catch (err) { setError(err); }
  };
  return (
    <>
      <Msg ok={ok} error={error} />
      <form className="panel" onSubmit={add}><h2>Add department</h2>
        <div className="grid2"><Field label="Code"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required /></Field><Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field></div>
        <button className="btn primary">Add</button></form>
      {depts.loading ? <Loading /> : <div className="tablewrap"><table className="t"><tbody>{depts.data.map((d) => <tr key={d.id}><td>{d.code}</td><td>{d.name}</td></tr>)}</tbody></table></div>}
    </>
  );
}

function Rules() {
  const s = useLoad(() => api('/admin/settings'));
  const [vals, setVals] = useState({});
  const [ok, setOk] = useState(''); const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault(); setError(null); setOk('');
    try { await api('/admin/settings', { method: 'PUT', body: vals }); setOk('Rules saved. They apply to the next claim check immediately.'); setVals({}); s.reload(); } catch (err) { setError(err); }
  };
  if (s.loading) return <Loading />;
  return (
    <form className="panel" onSubmit={save}>
      <h2>Fund rules</h2>
      <p className="muted">Stored as data, so a new office order or GoI norm only needs an edit here, not a code change.</p>
      <Msg ok={ok} error={error} />
      {s.data.map((r) => (
        <Field key={r.key} label={r.description}><input type="number" min="0" value={vals[r.key] ?? r.value} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} /></Field>
      ))}
      <button className="btn primary">Save rules</button>
    </form>
  );
}

function Blocks() {
  const blocks = useLoad(() => api('/admin/blocks'));
  const [startFy, setStartFy] = useState('');
  const [from, setFrom] = useState({});
  const [ok, setOk] = useState(''); const [error, setError] = useState(null);
  const run = async (fn, msg) => {
    setError(null); setOk('');
    try { const r = await fn(); setOk(typeof msg === 'function' ? msg(r) : msg); blocks.reload(); } catch (err) { setError(err); }
  };
  if (blocks.loading) return <Loading />;
  return (
    <>
      <Msg ok={ok} error={error} />
      <div className="panel">
        <h2>New 3-year block</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Start year (2027 creates block 2027-30)"><input type="number" value={startFy} onChange={(e) => setStartFy(e.target.value)} /></Field>
          <button className="btn primary" style={{ marginBottom: 12 }} onClick={() => run(() => api('/admin/blocks', { method: 'POST', body: { start_fy: Number(startFy) } }), 'Block created.')}>Create block</button>
        </div>
      </div>
      {blocks.data.map((b) => (
        <div key={b.id} className="panel">
          <h2>Block {b.label} {b.active && <span className="badge b-APPROVED">Active</span>}</h2>
          <p className="muted">{b.accounts} faculty accounts.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {!b.active && <button className="btn" onClick={() => run(() => api(`/admin/blocks/${b.id}/activate`, { method: 'POST' }), 'Block activated.')}>Make active</button>}
            <button className="btn" onClick={() => run(() => api(`/admin/blocks/${b.id}/init-accounts`, { method: 'POST' }), (r) => `${r.created} accounts created, ${r.credited} allocations credited (full or pro-rata).`)}>Create accounts and allocate</button>
            {[b.start_fy, b.start_fy + 1, b.start_fy + 2].map((fy) => (
              <button key={fy} className="btn sm" onClick={() => run(() => api(`/admin/blocks/${b.id}/allocate-fy`, { method: 'POST', body: { fy } }), (r) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}: ${r.credited} allocations credited.`)}>Allocate FY {fy}-{String((fy + 1) % 100).padStart(2, '0')}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <select value={from[b.id] || ''} onChange={(e) => setFrom({ ...from, [b.id]: e.target.value })} aria-label="Carry forward from block" style={{ padding: 8, borderRadius: 6, border: '1px solid var(--line)' }}>
              <option value="">Carry forward unspent balance from...</option>
              {blocks.data.filter((x) => x.id !== b.id && x.start_fy < b.start_fy).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <button className="btn" disabled={!from[b.id]} onClick={() => run(() => api(`/admin/blocks/${b.id}/carry-forward`, { method: 'POST', body: { from_block_id: Number(from[b.id]) } }), (r) => `${r.accounts} accounts: ${money(r.carried)} carried, ${money(r.lapsed)} lapsed above the cap.`)}>Carry forward</button>
          </div>
        </div>
      ))}
    </>
  );
}

function Audit() {
  const a = useLoad(() => api('/admin/audit'));
  if (a.loading) return <Loading />;
  return (
    <div className="tablewrap"><table className="t">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>{a.data.map((r) => <tr key={r.id}><td className="small">{fmtDT(r.created_at)}</td><td>{r.user_name}</td><td className="small">{r.action}</td><td className="small muted">{r.entity} {r.entity_id || ''} {r.details ? JSON.stringify(r.details).slice(0, 110) : ''}</td></tr>)}</tbody>
    </table></div>
  );
}

export default function AdminDashboard() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHead title="Administration" sub="Users, rules, blocks and allocations." />
      <Tabs value={tab} onChange={setTab} tabs={[['users', 'Users'], ['depts', 'Departments'], ['rules', 'Fund rules'], ['blocks', 'Blocks & allocation'], ['prorata', 'Pro-rata'], ['audit', 'Audit log']]} />
      {tab === 'users' && <Users />}
      {tab === 'depts' && <Departments />}
      {tab === 'rules' && <Rules />}
      {tab === 'blocks' && <Blocks />}
      {tab === 'prorata' && <ProrataCalc />}
      {tab === 'audit' && <Audit />}
    </>
  );
}
