import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../App.jsx';
import { ErrorBox } from '../ui.jsx';

const DEMO = [
  ['Faculty (CSE)', 'anita.sharma'], ['Faculty (EE)', 'kavya.rao'], ['Faculty on long leave', 'sanjay.gupta'], ['HoD (CSE)', 'hod.cse'], ['Accounts AR', 'ar'],
  ['Accounts junior staff', 'junior1'], ['Registrar', 'registrar'], ['Dean FAA', 'dean'], ['Director', 'director'], ['Administrator', 'admin'],
];

export default function Login() {
  const { login, googleLogin } = useAuth();
  const googleButton = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleButton.current) return undefined;
    let script = document.querySelector('script[data-google-identity]');
    const initialize = () => {
      if (!window.google?.accounts?.id || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          setBusy(true); setError(null);
          try { await googleLogin(response.credential); }
          catch (err) { setError(err); }
          finally { setBusy(false); }
        },
        auto_select: false,
      });
      googleButton.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 280 });
      setGoogleReady(true);
    };
    if (window.google?.accounts?.id) initialize();
    else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true; script.defer = true; script.dataset.googleIdentity = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', initialize);
    }
    return () => { if (script) script.removeEventListener('load', initialize); };
  }, [googleLogin]);
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
        <div className="google-signin">
          <div className="muted" style={{ margin: '16px 0 10px' }}>Or continue with Google</div>
          {import.meta.env.VITE_GOOGLE_CLIENT_ID ? <div ref={googleButton} aria-label="Continue with Google" /> : <p className="small muted">Google sign-in needs VITE_GOOGLE_CLIENT_ID in client/.env.</p>}
          {googleReady && <p className="small muted">New accounts require administrator approval before access is enabled.</p>}
        </div>
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
