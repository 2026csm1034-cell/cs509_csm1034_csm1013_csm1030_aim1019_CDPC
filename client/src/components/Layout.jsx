import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { fmtDT } from '../ui.jsx';

const NAV = {
  FACULTY: [['/', 'Dashboard'], ['/claims/new', 'New claim'], ['/claims', 'My claims'], ['/ledger', 'My ledger']],
  HOD: [['/', 'Dashboard'], ['/claims/new', 'New claim'], ['/claims', 'My claims'], ['/ledger', 'My ledger'], ['/accounts', 'Department accounts'], ['/all-claims', 'Department claims'], ['/analytics', 'Analytics']],
  ACCOUNTS_AR: [['/', 'Dashboard'], ['/all-claims', 'All claims'], ['/accounts', 'Faculty accounts'], ['/prorata', 'Pro-rata calculator'], ['/analytics', 'Analytics']],
  ACCOUNTS_JUNIOR: [['/', 'My assigned claims'], ['/all-claims', 'All assigned'], ['/accounts', 'Faculty accounts']],
  REGISTRAR: [['/', 'Dashboard'], ['/all-claims', 'All claims'], ['/accounts', 'Faculty accounts'], ['/analytics', 'Analytics']],
  DEAN_FAA: [['/', 'Dashboard'], ['/all-claims', 'All claims'], ['/accounts', 'Faculty accounts'], ['/analytics', 'Analytics']],
  DIRECTOR: [['/', 'Dashboard'], ['/all-claims', 'All claims'], ['/accounts', 'Faculty accounts'], ['/analytics', 'Analytics']],
  ADMIN: [['/', 'Administration'], ['/all-claims', 'All claims'], ['/accounts', 'Faculty accounts'], ['/prorata', 'Pro-rata calculator'], ['/analytics', 'Analytics']],
};

function Bell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const ref = useRef();
  const load = () => api('/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) { await load(); }
    if (!next && data.unread) { await api('/notifications/read-all', { method: 'POST' }); load(); }
  };
  return (
    <div className="bell" ref={ref}>
      <button className="btn sm" onClick={toggle} aria-label="Notifications">Notifications{data.unread > 0 && <span className="dot">{data.unread}</span>}</button>
      {open && (
        <div className="drop">
          {data.items.length === 0 && <div className="empty">Nothing yet.</div>}
          {data.items.map((n) => (
            <div key={n.id} className={'it' + (n.is_read ? '' : ' un')} onClick={() => { setOpen(false); api('/notifications/read-all', { method: 'POST' }).then(load); if (n.claim_id) nav(`/claims/${n.claim_id}`); }}>
              {n.message}
              <div className="small muted">{fmtDT(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand"><b>CPDA Portal</b><span>IIT Ropar - Accounts Section</span></div>
        <nav className="nav">
          {(NAV[user.role] || []).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm burger" onClick={() => setOpen(!open)}>Menu</button>
          <Bell />
          <div className="who"><b>{user.name}</b><span>{user.role_label}{user.dept_code ? ` - ${user.dept_code}` : ''}</span></div>
          <button className="btn sm" onClick={logout}>Log out</button>
        </header>
        <main className="page"><Outlet /></main>
      </div>
    </div>
  );
}
