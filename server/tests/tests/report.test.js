
// aggregate() maths and the Excel builder (with a recording fake of exceljs)

const Module = require('module');

const orig = Module._load;
const sheets = {};

class FakeWB {
    constructor() {
        this.xlsx = {};
    }

    addWorksheet(name) {
        const ws = {
            name,
            rows: [],
            columns: [],
            autoFilter: null,
            views: [],

            addRow(r) {
                ws.rows.push(r);

                return {
                    font: {},
                    getCell: () => ({})
                };
            },

            getRow() {
                return {
                    eachCell() {},
                    font: {},
                    getCell: () => ({})
                };
            }
        };

        sheets[name] = ws;

        return ws;
    }
}

Module._load = function (r, ...a) {
    if (r === 'exceljs') {
        return {
            Workbook: FakeWB
        };
    }

    if (/\.\.\/db$/.test(r)) {
        return {
            pool: {},
            HttpError: Error
        };
    }

    return orig.call(this, r, ...a);
};

const { aggregate, workbook } = require('../src/services/report.js');

const mk = (o) => ({
    id: 1,
    claim_no: 'C',
    kind: 'CONTINGENT',
    status: 'PAID',
    total: 1000,
    amount_passed: null,
    user_id: 1,
    name: 'A',
    emp_code: 'E1',
    dept_code: 'CSE',
    dept_name: 'Computer Science',
    year: 2026,
    month: 10,
    week_label: '2026-W43',
    fy: 2026,
    block_label: '2024-27',
    ...o
});

const rows = [
    mk({
        id: 1,
        total: 1000,
        amount_passed: 900
    }), // paid, passed 900

    mk({
        id: 2,
        kind: 'CONFERENCE',
        status: 'APPROVED',
        total: 5000
    }), // approved conf 5000

    mk({
        id: 3,
        status: 'IN_REVIEW',
        total: 700
    }), // in process

    mk({
        id: 4,
        status: 'REJECTED',
        total: 300
    }), // rejected

    mk({
        id: 5,
        user_id: 2,
        name: 'B',
        emp_code: 'E2',
        dept_code: 'EE',
        dept_name: 'Electrical',
        month: 9,
        week_label: '2026-W37',
        total: 2000
    })
];

const items = [
    {
        claim_id: 1,
        category: 'Membership Fees',
        amount: 900
    },
    {
        claim_id: 2,
        category: 'Travel (TA/DA)',
        amount: 5000
    },
    {
        claim_id: 3,
        category: 'Books & Stationery',
        amount: 700
    },
    {
        claim_id: 5,
        category: 'Membership Fees',
        amount: 2000
    }
];

const agg = aggregate(
    rows,
    items,
    [
        {
            code: 'CSE',
            allocated: 480000,
            spent: 6000,
            committed: 700
        }
    ]
);

let fail = 0;

const ok = (n, c) => {
    console.log((c ? 'PASS  ' : 'FAIL  ') + n);

    if (!c) {
        fail++;
    }
};

const cse = agg.by_department.find((d) => d.code === 'CSE');
const ee = agg.by_department.find((d) => d.code === 'EE');

ok(
    'CSE amount = passed 900 + conf 5000 (approved+paid only)',
    cse.amount === 5900 &&
        cse.conference === 5000 &&
        cse.contingency === 900
);

ok(
    'in-process and rejected kept apart',
    cse.in_process === 700 &&
        cse.rejected_returned === 1
);

ok(
    'EE amount 2000, grand total 7900',
    ee.amount === 2000 &&
        agg.totals.amount === 7900
);

ok(
    'allocation context merged for CSE',
    cse.allocated_block === 480000
);

ok(
    'faculty split',
    agg.by_faculty.find((f) => f.name === 'A').amount === 5900 &&
        agg.by_faculty.find((f) => f.name === 'B').amount === 2000
);

ok(
    'month + week buckets with per-dept pivot',
    agg.by_month.length === 2 &&
        agg.by_week.find((w) => w.period === '2026-W37').by_dept.EE === 2000
);

ok(
    'category totals only count approved/paid lines',
    agg.by_category.find((c) => c.category === 'Membership Fees').amount === 2900 &&
        !agg.by_category.find((c) => c.category === 'Books & Stationery')
);

workbook({
    filters: {
        dept_label: 'All departments',
        status_label: 'All submitted'
    },
    agg,
    rows,
    items
});

ok(
    'workbook has all sheets',
    [
        'Summary',
        'By Department',
        'By Faculty',
        'By Month',
        'By Week',
        'By Category',
        'All claims',
        'Expense lines'
    ].every((n) => sheets[n])
);

ok(
    'filterable (autoFilter) on data sheets',
    [
        'By Department',
        'By Faculty',
        'All claims',
        'Expense lines'
    ].every((n) => sheets[n].autoFilter)
);

ok(
    'All claims rows carry FY / year / month / week columns for Excel filtering',
    sheets['All claims'].rows[0].fy_label === '2026-27' &&
        sheets['All claims'].rows[0].month_name === 'Oct' &&
        sheets['All claims'].rows[0].week_label === '2026-W43'
);

console.log(
    fail
        ? '\nREPORT TESTS FAILED'
        : '\nREPORT TESTS PASSED'
);

process.exit(fail ? 1 : 0);
