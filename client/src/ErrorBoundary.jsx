import React from 'react';

/** Shows the real error instead of a blank page, and lets the person log out of a broken session. */
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI crash:', error, info && info.componentStack); }
  logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) { /* ignore */ }
    window.location.href = '/login';
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2>Something went wrong on this page</h2>
        <p>Please send this message to the administrator:</p>
        <pre style={{ background: '#f4f4f4', padding: 12, whiteSpace: 'pre-wrap', borderRadius: 6 }}>{String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error))}</pre>
        <button onClick={() => window.location.reload()} style={{ marginRight: 8 }}>Reload</button>
        <button onClick={this.logout}>Log out and go to sign-in</button>
      </div>
    );
  }
}
