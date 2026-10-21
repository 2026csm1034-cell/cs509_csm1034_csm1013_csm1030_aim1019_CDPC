import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ClaimTable, ErrorBox, Loading, PageHead, STATUS_LABEL, useLoad } from '../ui.jsx';

function StatusFilter({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by status" style={{ padding: 8, borderRadius: 6, border: '1px solid var(--line)' }}>
      <option value="">All statuses</option>
      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export function MyClaims() {
  const [status, setStatus] = useState('');
  const { data, loading, error } = useLoad(() => api(`/claims?scope=mine${status ? '&status=' + status : ''}`), [status]);
  return (
    <>
      <PageHead title="My claims" sub="Everything you have submitted or saved as a draft.">
        <StatusFilter value={status} onChange={setStatus} />{' '}
        <Link className="btn primary" to="/claims/new">New claim</Link>
      </PageHead>
      <ErrorBox error={error} />
      {loading ? <Loading /> : <ClaimTable rows={data} empty="You have no claims yet." />}
    </>
  );
}

export function AllClaims() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const { data, loading, error } = useLoad(() => api(`/claims?scope=all${status ? '&status=' + status : ''}`), [status]);
  const title = user.role === 'HOD' ? 'Department claims' : user.role === 'ACCOUNTS_JUNIOR' ? 'Claims assigned to me' : 'All claims';
  return (
    <>
      <PageHead title={title} sub="Click a claim to see its bills, sign-off trail and ledger impact."><StatusFilter value={status} onChange={setStatus} /></PageHead>
      <ErrorBox error={error} />
      {loading ? <Loading /> : <ClaimTable rows={data} showFaculty empty="No claims found." />}
    </>
  );
}
