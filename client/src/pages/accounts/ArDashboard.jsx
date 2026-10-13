import React from 'react';
import { api } from '../../api.js';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { ClaimTable, Loading, PageHead, useLoad } from '../../ui.jsx';

export default function ArDashboard() {
  const st = useClaimStats();
  const approved = useLoad(() => api('/claims?scope=all&status=APPROVED'));
  return (
    <>
      <PageHead title="Accounts - Assistant Registrar" sub="Receive claims, assign them to junior staff, review the register entry and pass approved claims for payment." />
      <StatStrip items={[['Claims in the chain', st.inReview], ['Approved, to be paid', st.approved], ['Paid', st.paid], ['Special approval requests', st.special]]} />
      <Inbox title="Waiting for you (receive & assign, or final review)" />
      <div className="section-title"><h2>Approved - pass for payment ({approved.data ? approved.data.length : 0})</h2></div>
      {approved.loading ? <Loading /> : <ClaimTable rows={approved.data} showFaculty empty="No approved claims waiting for payment." />}
    </>
  );
}
