import React from 'react';
import { api } from '../api.js';
import { ClaimTable, ErrorBox, Loading, useLoad } from '../ui.jsx';

/** Claims waiting for the logged-in user's action. */
export default function Inbox({ title = 'Waiting for your action', empty = 'Nothing is waiting for you.' }) {
  const { data, loading, error } = useLoad(() => api('/claims?scope=inbox'));
  return (
    <>
      <div className="section-title"><h2>{title}{data ? ` (${data.length})` : ''}</h2></div>
      <ErrorBox error={error} />
      {loading ? <Loading /> : <ClaimTable rows={data} showFaculty empty={empty} />}
    </>
  );
}

export function StatStrip({ items }) {
  return (
    <div className="ledgerline" style={{ marginTop: 0, marginBottom: 22, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 20px 14px' }}>
      {items.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}
    </div>
  );
}

export function useClaimStats() {
  const { data } = useLoad(() => api('/claims?scope=all'));
  const rows = data || [];
  const n = (s) => rows.filter((r) => r.status === s).length;
  return { rows, inReview: n('IN_REVIEW'), approved: n('APPROVED'), paid: n('PAID'), rejected: n('REJECTED') + n('RETURNED'), special: rows.filter((r) => r.special_request && r.status === 'IN_REVIEW').length };
}
