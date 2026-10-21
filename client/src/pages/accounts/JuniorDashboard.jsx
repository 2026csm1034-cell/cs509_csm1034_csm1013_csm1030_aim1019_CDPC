import React from 'react';
import { api } from '../../api.js';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { ClaimTable, Loading, PageHead, useLoad } from '../../ui.jsx';

export default function JuniorDashboard() {
  const st = useClaimStats();
  const approved = useLoad(() => api('/claims?scope=all&status=APPROVED'));
  return (
    <>
      <PageHead title="Accounts - junior staff" sub="Verify bills, enter each claim in the CPDA register and record the amount passed." />
      <StatStrip items={[['Assigned to me (all)', st.rows.length], ['Still in the chain', st.inReview], ['Approved, to be paid', st.approved], ['Paid', st.paid]]} />
      <Inbox title="Assigned to you for verification & register entry" empty="No claims are assigned to you right now." />
      <div className="section-title"><h2>Approved - enter payment details</h2></div>
      {approved.loading ? <Loading /> : <ClaimTable rows={approved.data} showFaculty empty="Nothing waiting for payment entry." />}
    </>
  );
}
