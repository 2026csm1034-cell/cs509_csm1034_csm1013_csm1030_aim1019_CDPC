import React from 'react';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { PageHead } from '../../ui.jsx';

export default function RegistrarDashboard() {
  const st = useClaimStats();
  return (
    <>
      <PageHead title="Registrar" sub="Review claims after Accounts has verified them and entered them in the register." />
      <StatStrip items={[['In the approval chain', st.inReview], ['Approved', st.approved + st.paid], ['Rejected or returned', st.rejected], ['Special approval requests', st.special]]} />
      <Inbox title="Waiting for the Registrar" empty="No claims waiting for you." />
    </>
  );
}
