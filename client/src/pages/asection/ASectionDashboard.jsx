import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { ClaimTable, ErrorBox, Loading, PageHead, money, useLoad } from '../../ui.jsx';

export default function ASectionDashboard() {
  const { data, loading, error } = useLoad(() => api('/claims?scope=all'));
  const claims = data || [];
  const pending = claims.filter((c) => c.status === 'IN_REVIEW');
  const approved = claims.filter((c) => c.status === 'APPROVED');
  const returned = claims.filter((c) => c.status === 'RETURNED');
  const totalPending = pending.reduce((sum, c) => sum + Number(c.total || 0), 0);
  return (
    <>
      <PageHead title="A/Section dashboard" sub="Review and process CPDA claims across departments." >
        <Link className="btn" to="/all-claims">Open all claims</Link>
      </PageHead>
      <ErrorBox error={error} />
      {loading ? <Loading /> : <>
        <div className="stats">
          <div className="stat"><span>In review</span><b>{pending.length}</b></div>
          <div className="stat"><span>In-review claim value</span><b>{money(totalPending)}</b></div>
          <div className="stat"><span>Approved, awaiting payment</span><b>{approved.length}</b></div>
          <div className="stat"><span>Returned for correction</span><b>{returned.length}</b></div>
        </div>
        <section className="panel">
          <h2>Claims requiring attention</h2>
          <p className="muted">Open a claim to inspect documents and the approval trail. A/Section actions are recorded in the audit trail.</p>
          <ClaimTable rows={pending} showFaculty empty="No claims are currently in review." />
        </section>
        <section className="panel">
          <h2>Recently updated claims</h2>
          <ClaimTable rows={claims.slice(0, 10)} showFaculty empty="No claims found." />
        </section>
      </>}
    </>
  );
}
