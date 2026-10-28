
// Runs the form generator against a recording fake of pdfkit to catch logic errors (cannot render pixels).

const Module = require('module');

const orig = Module._load;
const calls = [];

function FakeDoc() {
    const doc = new Proxy(
        {
            y: 100,
            page: { maxY: 800 }
        },
        {
            get(t, k) {
                if (k in t) {
                    return t[k];
                }

                if (k === 'pipe') {
                    return () => doc;
                }

                if (k === 'end') {
                    return () => calls.push(['end']);
                }

                if (k === 'widthOfString') {
                    return (s) => String(s).length * 4.5;
                }

                if (k === 'heightOfString') {
                    return (s) => 11;
                }

                if (k === 'text') {
                    return (s, ...a) => {
                        calls.push(['text', String(s)]);
                        return doc;
                    };
                }

                return (...a) => {
                    calls.push([String(k), ...a]);
                    return doc;
                };
            }
        }
    );

    return doc;
}

Module._load = function (r, ...a) {
    if (r === 'pdfkit') {
        return FakeDoc;
    }

    return orig.call(this, r, ...a);
};

const { claimPdf } = require('../src/services/pdf.js');

const base = {
    faculty: {
        name: 'Dr Anita Sharma',
        emp_code: 'F101',
        designation: 'Assistant Professor',
        dept_name: 'Computer Science and Engineering'
    },

    summary: {
        total_grant: 110000,
        expenditure: 20000,
        balance: 80000
    },

    block_label: '2024-27',

    items: [
        {
            category: 'Membership Fees',
            party: 'IEEE',
            invoice_no: 'M1',
            invoice_date: '2026-09-01',
            amount: 5000,
            remarks: ''
        },
        {
            category: 'Subscription',
            party: 'ACM',
            invoice_no: 'S2',
            invoice_date: '2026-09-02',
            amount: 3000,
            remarks: 'yearly'
        },
        {
            category: 'Books & Stationery',
            party: 'Bookstore',
            invoice_no: 'B3',
            invoice_date: '2026-09-03',
            amount: 900,
            remarks: ''
        }
    ],

    approvals: [
        {
            step_key: 'HOD',
            decision: 'APPROVED',
            actor_name: 'Dr HOD',
            created_at: '2026-10-02T10:00:00Z',
            comment: 'Fine'
        }
    ]
};

const mk = (o) => ({
    ...base,
    ...o,

    claim: {
        id: 5,
        claim_no: 'CPDA/2026-27/0005',
        kind: 'CONTINGENT',
        total: 8900,
        pay_to: 'FACULTY',
        status: 'IN_REVIEW',
        submitted_at: '2026-10-01T09:30:00Z',
        ...(o.claim || {})
    }
});

const texts = () =>
    calls
        .filter((c) => c[0] === 'text')
        .map((c) => c[1])
        .join('\n');

let fail = 0;

const ok = (n, c) => {
    console.log((c ? 'PASS  ' : 'FAIL  ') + n);

    if (!c) {
        fail++;
    }
};

const res = {};

calls.length = 0;
claimPdf(res, mk({}));

let t = texts();

ok(
    'submitted claim shows applicant digital signature',
    /DIGITALLY SIGNED - APPLICANT/.test(t) &&
        /Dr Anita Sharma/.test(t)
);

ok(
    'HOD digital signature appears after recommendation',
    /DIGITALLY SIGNED - HOD/.test(t) &&
        /Dr HOD/.test(t)
);

ok(
    'verification ID printed',
    /ID [0-9A-F]{10}/.test(t)
);

ok(
    'form content present (Hindi heading, table, accounts block)',
    /भारतीय/.test(t) &&
        /Membership Fees/.test(t) &&
        /For use by Accounts Section only/.test(t) &&
        /2024-27/.test(t)
);

ok(
    'total 8,900 and sanctioned 1,10,000 formatted Indian style',
    /8,900/.test(t) &&
        /1,10,000/.test(t)
);

calls.length = 0;

claimPdf(
    res,
    mk({
        claim: {
            status: 'DRAFT',
            submitted_at: null
        },
        approvals: []
    })
);

t = texts();

ok(
    'draft: no signatures, shows draft note',
    !/DIGITALLY SIGNED/.test(t) &&
        /Draft - not yet submitted/.test(t)
);

calls.length = 0;

claimPdf(
    res,
    mk({
        claim: {
            kind: 'CONFERENCE',
            event_name: 'ICSE',
            event_type: 'International',
            event_location: 'Rio',
            event_start: '2026-05-01',
            event_end: '2026-05-04'
        },

        items: [
            {
                category: 'Registration Fee',
                party: 'ICSE',
                invoice_no: 'R1',
                invoice_date: '2026-05-01',
                amount: 20000,
                remarks: ''
            }
        ]
    })
);

t = texts();

ok(
    'conference variant renders event line and its categories',
    /Conference\/Workshop: ICSE/.test(t) &&
        /Registration Fee/.test(t) &&
        /Visa Fee/.test(t)
);

calls.length = 0;

claimPdf(
    res,
    mk({
        approvals: [
            ...base.approvals,
            {
                step_key: 'JUNIOR',
                decision: 'APPROVED',
                actor_name: 'Staff One',
                created_at: '2026-10-03T10:00:00Z'
            },
            {
                step_key: 'DEAN_FAA',
                decision: 'APPROVED',
                actor_name: 'Dean X',
                created_at: '2026-10-05T10:00:00Z'
            }
        ]
    })
);

t = texts();

ok(
    'later approvers get digital signature boxes',
    /Staff One/.test(t) &&
        /Dean X/.test(t)
);

console.log(
    fail
        ? '\nPDF TESTS FAILED'
        : '\nPDF LOGIC TESTS PASSED'
);

process.exit(fail ? 1 : 0);
