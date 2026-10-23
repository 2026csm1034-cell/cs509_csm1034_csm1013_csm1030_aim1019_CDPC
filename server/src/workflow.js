// Approval chain, taken from the Accounts Section's handwritten notes.
// To add / remove / reorder a step, edit this array only.
const STEPS = [
  { key: 'HOD', role: 'HOD', label: 'HoD recommendation' },
  { key: 'AR_RECEIVE', role: 'ACCOUNTS_AR', label: 'Accounts (AR) receives & assigns', assign: true },
  { key: 'JUNIOR', role: 'ACCOUNTS_JUNIOR', label: 'Accounts verification & register entry', register: true },
  { key: 'AR_REVIEW', role: 'ACCOUNTS_AR', label: 'Accounts (AR) review' },
  { key: 'REGISTRAR', role: 'REGISTRAR', label: 'Registrar' },
  { key: 'DEAN_FAA', role: 'DEAN_FAA', label: 'Dean (FAA)' },
  { key: 'DIRECTOR', role: 'DIRECTOR', label: 'Director (final approval)' },
];

const ROLE_LABELS = {
  FACULTY: 'Faculty', HOD: 'Head of Department', ACCOUNTS_AR: 'Accounts - AR', ACCOUNTS_JUNIOR: 'Accounts - Junior Staff',
  REGISTRAR: 'Registrar', DEAN_FAA: 'Dean (FAA)', DIRECTOR: 'Director', ADMIN: 'Administrator',
};

const CONFERENCE_CATEGORIES = ['Registration Fee', 'Travel (TA/DA)', 'Visa Fee', 'Accommodation & Other'];
const MEMBERSHIP = 'Membership Fees';
const CONTINGENT_CATEGORIES = [
  MEMBERSHIP, 'Consumables (research)', 'Books & Stationery', 'Computer Consumables',
  'Repair & Maintenance of Computer', 'Publication Charges', 'Subscription', 'Library Books', 'Any other',
];

const stepsForRole = (role) => STEPS.map((s, i) => (s.role === role ? i : -1)).filter((i) => i >= 0);

module.exports = { STEPS, ROLE_LABELS, CONFERENCE_CATEGORIES, CONTINGENT_CATEGORIES, MEMBERSHIP, stepsForRole };
