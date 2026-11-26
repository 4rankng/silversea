// CR-010.1 (SIL-896) — the debit-merge grid's ops-fee aggregation rides LIVE
// money. QA's lô MATS7539769000: the vantai ×5-twin merge left registry-voided
// twins on the books; the grid used to reborn them as 5 red CSHT lines
// (2.500.000₫ × 5), a phantom PHÍ GN OP TC line, a Tổng TC inflated to
// 41.013.200₫, and a spuriously pending hard-block — while /advances
// (registry-filtered) showed the one real record. Pins, house style:
//  - source-scan: the opsRows read filters through liveDebitOpsExpense() +
//    not-REJECTED, and ONE record lands in ONE cluster (INVOICED_ → group 4,
//    else → group 5, never both);
//  - the SQL the live law renders (registry notExists + approvalStatus);
//  - the pure DoD fixture: 1 CSHT record → exactly ONE 2.500.000₫ line, the
//    two pending no-invoice fees (450.000₫ / 50.000₫) show red in group 5,
//    integer VND throughout.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';

import { liveDebitOpsExpense, liveDebitTripExpense, standaloneDebitTripRevenue } from '../../services/live-debit-expense-scope';
import {
  buildDebitMergeChiHo,
  buildDebitMergeNoInvoice,
  debitMergeFeeNameOf,
  debitMergeOpsChargeContribution,
  debitMergeTongTcUnlocked,
} from '../../services/debit-merge.service';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(here, '..', '..', 'services', 'debit-merge.service.ts'),
  'utf8',
);

describe('SIL-896 — the opsRows read rides the live-money law', () => {
  test('source pins: liveDebitOpsExpense + not-REJECTED filter the merge read', () => {
    // The where clause of the ops-rows read (the ONE aggregation feeding
    // group 4, group 5, Lạch Huyện, ops-charge and pendingFeeCount).
    assert.match(serviceSource, /liveDebitOpsExpense\(\),/);
    assert.match(
      serviceSource,
      /ne\(s\.opsExpenseEntries\.approvalStatus, 'REJECTED'\),/,
      'a REJECTED row is absent from the grid (SIL-882 auto-removal law)',
    );
    // The dead branches are gone: pending is exactly "live and unapproved".
    assert.match(serviceSource, /const pending = row\.confirmedAt == null;/);
  });

  test('one record → ONE cluster: INVOICED_* pushes group 4, the bare else pushes group 5', () => {
    // The bucket chain must stay mutually exclusive per row — the phantom
    // GN line came from a voided twin reborn in the second bucket.
    const loop = serviceSource.slice(
      serviceSource.indexOf('for (const row of opsRows)'),
      serviceSource.indexOf('const chiHoByLot'),
    );
    assert.match(loop, /} else if \(row\.costGroup != null && row\.costGroup\.startsWith\('INVOICED_'\)\) \{/);
    assert.match(loop, /} else \{\n      const bucket = noInvoiceRawByLot/);
    assert.doesNotMatch(loop, /!rejected/, 'no rejected/voided branching left on live-only rows');
  });

  test('liveDebitOpsExpense renders the registry law the other money surfaces ride', () => {
    const dialect = new PgDialect();
    const condition = liveDebitOpsExpense();
    assert.ok(condition, 'liveDebitOpsExpense() is a concrete and() condition');
    const { sql, params } = dialect.sqlToQuery(condition);
    assert.match(sql, /approval_status/);
    assert.match(sql, /expense_accounting_sources/);
    assert.match(sql, /"expense_accounting_sources"\."status" = /);
    assert.equal(params.includes('VOIDED'), true, 'the registry arm voids on status=VOIDED');
  });

  test('revenueRows filters with liveDebitTripExpense and standaloneDebitTripRevenue so OPS-projected trip_expenses are never double-counted in Tổng TC', () => {
    const revenueQuery = serviceSource.slice(
      serviceSource.indexOf('const revenueRows = await db.select'),
      serviceSource.indexOf('const revenueByLot = new Map'),
    );
    assert.match(revenueQuery, /liveDebitTripExpense\(\),/);
    assert.match(revenueQuery, /standaloneDebitTripRevenue\(\),/);

    const dialect = new PgDialect();
    const standalone = standaloneDebitTripRevenue();
    const { sql, params } = dialect.sqlToQuery(standalone);
    assert.match(sql, /not exists/i);
    assert.match(sql, /expense_accounting_sources/);
    assert.match(sql, /linked_trip_expense_id/);
    assert.equal(params.includes('OPS'), true, 'standaloneDebitTripRevenue excludes OPS-projected trip_expenses');
    assert.ok(liveDebitTripExpense(), 'liveDebitTripExpense() is a concrete condition');
  });
});

describe('SIL-896 DoD — the QA lot fixture aggregates once, in one cluster', () => {
  // The lot's real shape (card): 3 pending no-invoice records + 1 approved.
  // The CSHT record is invoice-bearing → INVOICED_ (cluster by category CSHT);
  // Hải quan luồng xanh + Chọn vỏ are OPS_REGULAR (group 5 GN).
  const chiHoRows = [
    { category: 'CSHT', charge: '2500000', paid: '2500000', feeName: 'Phí kết cấu hạ tầng', invoiceNumber: null, pending: true },
    { category: 'LIFT', charge: '7603200', paid: '7603200', feeName: 'Phí nâng vỏ', invoiceNumber: '360403', pending: false },
  ];
  const noInvoiceRows = [
    { costGroup: 'OPS_REGULAR', charge: null, paid: '450000', feeName: 'Hải quan luồng xanh', pending: true },
    { costGroup: 'OPS_REGULAR', charge: null, paid: '50000', feeName: 'Chọn vỏ', pending: true },
  ];

  test('CSHT 2.500.000₫ renders exactly ONE line, counted once', () => {
    const chiHo = buildDebitMergeChiHo(chiHoRows);
    assert.equal(chiHo.csht.length, 1);
    assert.equal(chiHo.csht[0].amount, '2500000');
    assert.equal(chiHo.csht[0].pending, true);
    // The approved Phí nâng rides ITS cluster (lift), not CSHT.
    assert.equal(chiHo.lift.length, 1);
    assert.equal(chiHo.lift[0].amount, '7603200');
    assert.equal(chiHo.lift[0].pending, undefined);
  });

  test('the two no-invoice pending fees show in group 5 with red family flags', () => {
    const group5 = buildDebitMergeNoInvoice(noInvoiceRows);
    // Phí GN OP TC = the two entries' integer sum, never duplicated.
    assert.equal(group5.gnFee, 500000);
    assert.equal(group5.gnFeePending, true);
    // Tên phí lists BOTH missing fees, in row order.
    assert.deepEqual(group5.fees.map((fee) => fee.name), ['Hải quan luồng xanh', 'Chọn vỏ']);
    assert.deepEqual(group5.fees.map((fee) => fee.amount), [450000, 50000]);
    assert.equal(group5.fees.every((fee) => fee.pending === true), true);
  });

  test('money stays integer VND through the builders', () => {
    const chiHo = buildDebitMergeChiHo(chiHoRows);
    const group5 = buildDebitMergeNoInvoice(noInvoiceRows);
    for (const fee of [...chiHo.csht, ...chiHo.lift]) assert.match(fee.amount, /^\d+$/);
    assert.equal(Number.isInteger(group5.gnFee), true);
  });
});

describe('SIL-896 round 11 — Tên phí and Tổng TC on the un-negotiated pending fees', () => {
  // QA repro (builds 7a0ac8ff → 2530c955, staging vantai, lot
  // MATS7539769000): the advances-flow writer stores fee_name as '' (never
  // NULL) and the un-negotiated customer_charge_amount as 0 (never NULL) —
  // so the round-8 nullish fallbacks never fired: the grid showed an EMPTY
  // Tên phí cell for 'Hải quan luồng xanh' (450.000₫) + 'Chọn vỏ'
  // (50.000₫), Tổng TC dropped exactly their 500.000₫ (31.013.200₫
  // instead of 31.513.200₫), and Phí GN OP TC read as one unnamed
  // 500.000₫ aggregate. Names live on the expense-type catalog row the
  // read already joins; the money lives on the recorded amount.

  test('buildDebitMergeNoInvoice: the exact QA rows aggregate once per fee, each line named + sided', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: '0', paid: '450000', feeName: 'Hải quan luồng xanh', pending: true },
      { costGroup: 'OPS_REGULAR', charge: '0', paid: '50000', feeName: 'Chọn vỏ', pending: true },
    ]);
    assert.equal(result.gnFee, 500000);
    assert.equal(result.gnFeePending, true);
    assert.equal(result.gnPaid, 0);
    assert.deepEqual(result.fees, [
      { name: 'Hải quan luồng xanh', amount: 450000, side: 'gn', pending: true },
      { name: 'Chọn vỏ', amount: 50000, side: 'gn', pending: true },
    ]);
  });

  test('source pins: the read selects the catalog name and the buckets resolve through the shared fallbacks', () => {
    assert.match(serviceSource, /typeName: s\.forwarderExpenseTypes\.name,/);
    assert.match(serviceSource, /feeName: debitMergeFeeNameOf\(\{ feeName: row\.feeName, typeName: row\.typeName \}\)/);
    assert.match(serviceSource, /const contribution = debitMergeOpsChargeContribution\(row\);/);
    // Round 11: the assembly must CARRY side onto the wire — the money cells
    // render one line per fee from it (a mapped-over side renders the
    // aggregated-stack law dead).
    assert.match(serviceSource, /side: fee\.side, pending: fee\.pending/);
    // The read loop resolves every bucket name through the fallback; the
    // pure builders keep pushing their (already resolved) input rows.
    const opsLoop = serviceSource.slice(
      serviceSource.indexOf('for (const row of opsRows)'),
      serviceSource.indexOf('const chiHoByLot'),
    );
    assert.doesNotMatch(
      opsLoop,
      /feeName: row\.feeName(?!, typeName)/,
      'no bucket may push the raw entry name — the catalog fallback is the law',
    );
  });

  test('Tên phí: entry feeName wins, blank entry name falls to the catalog (the writer stores \'\', not NULL)', () => {
    assert.equal(debitMergeFeeNameOf({ feeName: null, typeName: 'Hải quan luồng xanh' }), 'Hải quan luồng xanh');
    assert.equal(debitMergeFeeNameOf({ feeName: '', typeName: 'Chọn vỏ' }), 'Chọn vỏ');
    assert.equal(debitMergeFeeNameOf({ feeName: '   ', typeName: 'Hải quan luồng xanh' }), 'Hải quan luồng xanh');
    assert.equal(debitMergeFeeNameOf({ feeName: 'Tên tự nhập', typeName: 'Hải quan luồng xanh' }), 'Tên tự nhập');
    assert.equal(debitMergeFeeNameOf({ feeName: null, typeName: null }), null);
  });

  test('receivable contribution: negotiated charge joins as-is (0 = un-negotiated on this wire → rides the amount); Lạch Huyện never falls back', () => {
    // The two QA fees (staging ids 107/112, build 2530c955): NO negotiated
    // charge entered, and the advances writer (receivableForCost) stores
    // **0 — not NULL** — so the round-8 null-check answered 0 and their
    // 500.000₫ dropped out of Tổng TC again (31.013.200₫ vs 31.513.200₫).
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'HAI_QUAN_LUONG_XANH', charge: '0', amount: '450000' }), 450000);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: '0', amount: '50000' }), 50000);
    // A truly null charge keeps the round-8 fallback.
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'HQGS_GREEN', charge: null, amount: '450000' }), 450000);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: null, amount: '50000' }), 50000);
    // A negotiated charge keeps its exact value (negatives included — the
    // existing semantics).
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: '120000', amount: '50000' }), 120000);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: '-70000', amount: '50000' }), -70000);
    // Lạch Huyện: the amount is the điều vận cost — only its charge bills,
    // 0 included (never falls back to the amount).
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: null, amount: '900000' }), null);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '0', amount: '900000' }), null);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '300000', amount: '900000' }), 300000);
    // A negative un-negotiated amount is absent (the builders' drop law).
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: null, amount: '-50000' }), null);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'CHON_VO', charge: null, amount: null }), null);
  });

  test('DoD arithmetic: Tổng TC = 31.513.200₫ on the QA lot shape (cước + chi-hộ + un-negotiated GN fees)', () => {
    // ops-charge side = CSHT 2.500.000 (charged, pending) + nâng vỏ
    // 7.603.200 (charged, approved) + the two un-negotiated GN fees'
    // 450.000 + 50.000 — the builders' cell money, counted once.
    const opsChargeKnownTotal = 2500000 + 7603200 + 450000 + 50000;
    assert.equal(debitMergeTongTcUnlocked({
      revenue: undefined,
      freightAuto: 20910000,
      psKnownTotal: null,
      opsChargeKnownTotal,
    }), 31513200);
  });
});
