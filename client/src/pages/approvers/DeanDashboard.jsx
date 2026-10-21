import React from 'react';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { PageHead } from '../../ui.jsx';

export default function DeanDashboard() {
  const st = useClaimStats();
  return (
    <>
      <PageHead title="Dean (Faculty Affairs & Administration)" sub="Approve claims before they go to the Director, and advise on cases outside the rules." />
      <StatStrip items={[['In the approval chain', st.inReview], ['Approved', st.approved + st.paid], ['Rejected or returned', st.rejected], ['Special approval requests', st.special]]} />
      <Inbox title="Waiting for the Dean" empty="No claims waiting for you." />
    </>
  );
}
