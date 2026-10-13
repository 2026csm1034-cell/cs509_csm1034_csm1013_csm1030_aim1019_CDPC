import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../App.jsx';
import Inbox, { StatStrip, useClaimStats } from '../../components/Inbox.jsx';
import { PageHead, money, useLoad } from '../../ui.jsx';

export default function HodDashboard() {
  const { user } = useAuth();
  const st = useClaimStats();
  const acc = useLoad(() => api('/accounts/me'));
  const s = acc.data && acc.data.summary;
  return (
    <>
      <PageHead title={`Head of ${user.dept_name || 'Department'}`} sub="Recommend or return claims from your department's faculty.">
        <Link className="btn primary" to="/claims/new">New claim (own CPDA)</Link>
      </PageHead>
      <StatStrip items={[['Department claims in review', st.inReview], ['Approved / paid', st.approved + st.paid], ['Rejected or returned', st.rejected], ['Your own CPDA balance', s ? money(s.balance) : '-']]} />
      <Inbox title="Claims awaiting your recommendation" empty="No claims waiting for your recommendation." />
    </>
  );
}
