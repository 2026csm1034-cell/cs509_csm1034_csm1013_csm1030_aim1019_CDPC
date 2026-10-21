import React from 'react';
import ProrataCalc from '../components/ProrataCalc.jsx';
import { PageHead } from '../ui.jsx';

export default function ProrataPage() {
  return (
    <>
      <PageHead title="Pro-rata calculator" sub="Work out the CPDA credit for a faculty member who joins or leaves in the middle of a year." />
      <ProrataCalc />
    </>
  );
}
