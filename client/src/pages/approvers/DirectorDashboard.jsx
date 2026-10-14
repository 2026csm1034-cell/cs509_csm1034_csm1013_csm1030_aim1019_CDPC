import React from 'react';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { PageHead } from '../../ui.jsx';

export default function DirectorDashboard() {
  const st = useClaimStats();
  return (
    <>
      <PageHead title="Director" sub="Final approval. Claims marked 'special approval' broke a CPDA rule and need your decision with a comment." />
      <StatStrip items={[['In the approval chain', st.inReview], ['Approved', st.approved + st.paid], ['Rejected or returned', st.rejected], ['Special approval requests', st.special]]} />
      <Inbox title="Waiting for your final approval" empty="No claims waiting for you." />
    </>
  );
}
