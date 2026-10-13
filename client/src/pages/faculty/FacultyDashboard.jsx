import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../App.jsx';
import { BalanceBar, ClaimTable, ErrorBox, Loading, PageHead, money, useLoad } from '../../ui.jsx';

export default function FacultyDashboard({ hod = false }) {
  const { user } = useAuth();
  const acc = useLoad(() => api('/accounts/me'));
  const claims = useLoad(() => api('/claims?scope=mine'));
  if (acc.loading) return <Loading />;
  const s = acc.data && acc.data.summary;
  const returned = (claims.data || []).filter((c) => c.status === 'RETURNED');
  return (
    <>
      <PageHead title={`Welcome, ${user.name}`} sub={acc.data && acc.data.account ? `Your CPDA account for block ${acc.data.account.block_label}` : 'CPDA account'}>
        <Link className="btn primary" to="/claims/new">New claim</Link>
      </PageHead>
      <ErrorBox error={acc.error || claims.error} />
      {!s && <div className="alert warn">You do not have a CPDA account in the active block yet. Please contact the Accounts Section.</div>}
      {s && (
        <div className="hero">
          <div className="cap">Available balance</div>
          <div className="big">{money(s.balance)}</div>
          <BalanceBar summary={s} />
          <div className="ledgerline">
            <div><small>Allocated this block</small><b>{money(s.allocated)}</b></div>
            <div><small>Carried from last block</small><b>{money(s.carry_in)}</b></div>
            <div style={{ gridColumn: 'span 2' }}>
              <small>Conference / TA cap ({acc.data.settings.travel_cap_pct}% of grant): used {money(s.conf_used)} of {money(s.conf_cap)}</small>
              <div className={'meter' + (s.conf_cap && s.conf_used / s.conf_cap > 0.85 ? ' hot' : '')}><i style={{ width: Math.min(100, s.conf_cap ? (s.conf_used / s.conf_cap) * 100 : 0) + '%' }} /></div>
            </div>
          </div>
        </div>
      )}
      {returned.length > 0 && (
        <div className="alert warn"><b>{returned.length} claim(s) returned for correction.</b> Open them, fix the point mentioned and resubmit.</div>
      )}
      <div className="section-title"><h2>Recent claims</h2><Link to="/claims">View all</Link></div>
      {claims.loading ? <Loading /> : <ClaimTable rows={(claims.data || []).slice(0, 6)} empty="You have no claims yet. Start with New claim." />}
      <div className="section-title"><h2>Rules at a glance</h2></div>
      <div className="panel small">
        Claim within one month of the event or expense. Conference / TA spending can use up to {acc.data && acc.data.settings.travel_cap_pct}% of the grant;
        membership and contingent expenses can use the rest. Bills are reimbursed after approval, not paid in advance. Anything outside these rules can be sent as a special approval request to the Director.
      </div>
    </>
  );
}
