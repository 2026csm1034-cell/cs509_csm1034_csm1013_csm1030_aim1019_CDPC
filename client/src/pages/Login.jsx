import React, { useState } from 'react';
import { useAuth } from '../App.jsx';
import { ErrorBox } from '../ui.jsx';

const DEMO = [
  ['Faculty (CSE)', 'anita.sharma'], ['Faculty (EE)', 'kavya.rao'], ['Faculty on long leave', 'sanjay.gupta'], ['HoD (CSE)', 'hod.cse'], ['Accounts AR', 'ar'],
  ['Accounts junior staff', 'junior1'], ['Registrar', 'registrar'], ['Dean FAA', 'dean'], ['Director', 'director'], ['Administrator', 'admin'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="login">
      <div className="l">
        <h1>Cumulative Professional Development Allowance, in one place.</h1>
        <p>Claim, approve and track CPDA and budget funds without the paper file. Every rupee in the ledger traces back to a claim, a bill and a sign-off.</p>
      </div>
      <div className="r">
        <h2>Sign in</h2>
        <p className="muted">Use your institute email.</p>
        <ErrorBox error={error} />
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <details className="demo" open>
          <summary>Demo accounts (password for all: Demo@1234)</summary>
          <table>
            <tbody>
              {DEMO.map(([label, key]) => (
                <tr key={key}><td>{label}</td><td><button type="button" onClick={() => { setEmail(`${key}@iitrpr.demo`); setPassword('Demo@1234'); }}>{key}@iitrpr.demo</button></td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}
