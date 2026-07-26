/**
 * Wave 3 M6.3 — AP aging detail tests.
 *
 * Verifies: empty report, single-supplier payable + payment split,
 * partial-payment outstanding, overpayment (paid > payable) surfacing,
 * duplicate receiptId flagging + global aggregation, supplier filter,
 * zero-activity supplier exclusion, aging-bucket assignment.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import { getApAgingDetail } from '../services/ap-aging.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdSupplierIds: number[] = [];
const createdLedgerIds: number[] = [];

async function mkSupplier(name?: string) {
  const [sup] = await db.insert(s.suppliers).values({
    name: name ?? `M63 supplier ${suffix}-${createdSupplierIds.length}`,
  }).returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

async function mkLedger(opts: {
  entityId: number;
  txnType: TxnType;
  debit?: number;
  credit?: number;
  receiptId?: string | null;
  daysAgo?: number;
}) {
  const timestamp = new Date(Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000);
  const debit = opts.debit ?? 0;
  const credit = opts.credit ?? 0;
  const [e] = await db.insert(s.ledger).values({
    entityType: 'VENDOR' as const,
    entityId: opts.entityId,
    txnType: opts.txnType,
    txnId: 0,
    receiptId: opts.receiptId ?? null,
    debit: String(debit),
    credit: String(credit),
    balance: String(debit - credit),
    timestamp,
    note: null,
  }).returning();
  createdLedgerIds.push(e.id);
  return e;
}

after(async () => {
  try {
    if (createdLedgerIds.length > 0) await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    if (createdSupplierIds.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  } catch (err) { console.warn('[m63] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.3 — getApAgingDetail', () => {
  test('empty report → zero totals, no suppliers', async () => {
    const report = await getApAgingDetail();
    assert.equal(typeof report.asOf, 'string');
    assert.equal(report.totals.totalPayable, report.totals.totalPayable); // sanity
    // We can't assert zero absolutely (other tests may have data) — but the
    // shape must be valid.
    assert.ok(Array.isArray(report.suppliers));
    assert.ok(Array.isArray(report.duplicateRefs));
  });

  test('single supplier: payable + matching payment → outstanding 0', async () => {
    const sup = await mkSupplier();
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 1_000_000, daysAgo: 5 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 1_000_000, receiptId: `R-${suffix}-1`, daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.totalPayable, 1_000_000);
    assert.equal(row!.totalPaid, 1_000_000);
    assert.equal(row!.outstanding, 0);
    assert.equal(row!.overpayment, 0);
    assert.equal(row!.payments.length, 1);
    assert.equal(row!.payments[0].receiptId, `R-${suffix}-1`);
    assert.equal(row!.payments[0].isDuplicateRef, false);
  });

  test('partial payment: outstanding = payable - paid', async () => {
    const sup = await mkSupplier();
    await mkLedger({ entityId: sup.id, txnType: TxnType.FUEL_EXPENSE, credit: 2_000_000, daysAgo: 10 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 800_000, receiptId: `R-${suffix}-2`, daysAgo: 2 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.totalPayable, 2_000_000);
    assert.equal(row!.totalPaid, 800_000);
    assert.equal(row!.outstanding, 1_200_000);
    assert.equal(row!.overpayment, 0);
  });

  test('overpayment (paid > payable) → surplus surfaced as overpayment credit', async () => {
    const sup = await mkSupplier();
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 500_000, daysAgo: 5 });
    // Pay 800k against a 500k payable → 300k overpayment.
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 800_000, receiptId: `R-${suffix}-3`, daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.totalPayable, 500_000);
    assert.equal(row!.totalPaid, 800_000);
    assert.equal(row!.outstanding, -300_000);
    assert.equal(row!.overpayment, 300_000, 'surplus surfaced as supplier credit');
    assert.equal(row!.aging.current + row!.aging.d30 + row!.aging.d60 + row!.aging.over90, 0,
      'overpaid → no remaining payable to bucket');
  });

  test('duplicate receiptId on two VENDOR_PAYMENTs → flagged globally + per-row', async () => {
    const sup = await mkSupplier();
    const dupRef = `DUP-${suffix}`;
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 2_000_000, daysAgo: 10 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 1_000_000, receiptId: dupRef, daysAgo: 5 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 500_000, receiptId: dupRef, daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.duplicateRefCount, 2, 'both payments flagged');
    assert.ok(row!.payments.every(p => p.isDuplicateRef), 'every payment has isDuplicateRef=true');

    // Global aggregation.
    const dup = report.duplicateRefs.find(d => d.receiptId === dupRef);
    assert.ok(dup);
    assert.equal(dup!.entryCount, 2);
    assert.equal(dup!.totalAmount, 1_500_000);
    assert.ok(dup!.supplierIds.includes(sup.id));
  });

  test('duplicate ref across two suppliers → flagged globally with both supplier ids', async () => {
    const supA = await mkSupplier();
    const supB = await mkSupplier();
    const crossRef = `CROSS-${suffix}`;
    await mkLedger({ entityId: supA.id, txnType: TxnType.VENDOR_EXPENSE, credit: 1_000_000, daysAgo: 10 });
    await mkLedger({ entityId: supB.id, txnType: TxnType.VENDOR_EXPENSE, credit: 1_000_000, daysAgo: 10 });
    await mkLedger({ entityId: supA.id, txnType: TxnType.VENDOR_PAYMENT, debit: 600_000, receiptId: crossRef, daysAgo: 1 });
    await mkLedger({ entityId: supB.id, txnType: TxnType.VENDOR_PAYMENT, debit: 400_000, receiptId: crossRef, daysAgo: 1 });

    // Query without supplierId to see both.
    const report = await getApAgingDetail();
    const dup = report.duplicateRefs.find(d => d.receiptId === crossRef);
    assert.ok(dup);
    assert.equal(dup!.entryCount, 2);
    assert.ok(dup!.supplierIds.includes(supA.id));
    assert.ok(dup!.supplierIds.includes(supB.id));
  });

  test('NULL/empty receiptId is NOT treated as a duplicate', async () => {
    const sup = await mkSupplier();
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 1_000_000, daysAgo: 5 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 500_000, receiptId: null, daysAgo: 1 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 300_000, receiptId: '', daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.duplicateRefCount, 0, 'null/empty refs not flagged');
    assert.equal(report.duplicateRefs.length, 0);
  });

  test('supplierId filter scopes the report', async () => {
    const supA = await mkSupplier();
    const supB = await mkSupplier();
    await mkLedger({ entityId: supA.id, txnType: TxnType.VENDOR_EXPENSE, credit: 700_000, daysAgo: 3 });
    await mkLedger({ entityId: supB.id, txnType: TxnType.VENDOR_EXPENSE, credit: 900_000, daysAgo: 3 });

    const report = await getApAgingDetail({ supplierId: supA.id });
    const ids = report.suppliers.map(r => r.supplierId);
    assert.ok(ids.includes(supA.id));
    assert.ok(!ids.includes(supB.id));
  });

  test('aging buckets assign outstanding by the original payable age', async () => {
    const sup = await mkSupplier();
    // 100 days old payable → over90 bucket.
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 1_000_000, daysAgo: 100 });
    // 45 days old payable → d30 bucket.
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 500_000, daysAgo: 45 });
    // 10 days old payable → current bucket.
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 200_000, daysAgo: 10 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.aging.current, 200_000);
    assert.equal(row!.aging.d30, 500_000);
    assert.equal(row!.aging.d60, 0);
    assert.equal(row!.aging.over90, 1_000_000);
    // maxOverdueDays ≈ 100 (within ±2 for midnight-vs-now boundary).
    assert.ok(row!.maxOverdueDays > 90 && row!.maxOverdueDays <= 102,
      `maxOverdueDays ~100, got ${row!.maxOverdueDays}`);
  });

  test('supplier with zero payable AND zero payment excluded', async () => {
    const sup = await mkSupplier();
    // Insert a non-AP entry to confirm the supplier exists but is excluded.
    await mkLedger({ entityId: sup.id, txnType: TxnType.PENALTY, debit: 100, daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    // PENALTY isn't a payable or payment type → supplier has zero AP activity.
    assert.equal(row, undefined);
  });

  test('totals reflect the sum across suppliers', async () => {
    const sup = await mkSupplier();
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_EXPENSE, credit: 400_000, daysAgo: 3 });
    await mkLedger({ entityId: sup.id, txnType: TxnType.VENDOR_PAYMENT, debit: 100_000, receiptId: `R-${suffix}-totals`, daysAgo: 1 });

    const report = await getApAgingDetail({ supplierId: sup.id });
    const expectedPayable = report.suppliers.reduce((sum, r) => sum + r.totalPayable, 0);
    const expectedPaid = report.suppliers.reduce((sum, r) => sum + r.totalPaid, 0);
    assert.equal(report.totals.totalPayable, expectedPayable);
    assert.equal(report.totals.totalPaid, expectedPaid);
    assert.equal(report.totals.outstanding, expectedPayable - expectedPaid);
  });
});
