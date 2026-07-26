/**
 * Wave 3 M4.7 (slice 1) — no-invoice disbursement enforcement tests.
 *
 * Verifies the M04-07 rules for the requiresInvoice=false branch:
 *   - substituteEvidenceAllowed=false → blocked
 *   - allowed but note empty → blocked
 *   - allowed + note + amount ≤ threshold → succeeds
 *   - over threshold + ACCOUNTANT → blocked (needs director)
 *   - over threshold + MANAGER/ADMIN → succeeds
 *   - has-invoice path → bypass (M4.6 owns it)
 *   - rejections bypass
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionApproval } from '../services/approval.service';
import {
  assertNoInvoiceDisbursementAllowed,
  getNoInvoiceDisbursementReport,
  DIRECTOR_THRESHOLD,
} from '../services/no-invoice-disbursement.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdFetIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdAuditIds: number[] = [];

async function mkFet(opts: { requiresInvoice?: boolean; substituteEvidenceAllowed?: boolean; tag: string }) {
  const code = `M47-${opts.tag}-${suffix}-${createdFetIds.length}`;
  const [fet] = await db.insert(s.forwarderExpenseTypes).values({
    code,
    name: `M47 type ${opts.tag} ${suffix}`,
    requiresInvoice: opts.requiresInvoice ?? false,
    substituteEvidenceAllowed: opts.substituteEvidenceAllowed ?? true,
  }).returning();
  createdFetIds.push(fet.id);
  return fet;
}

async function mkTrip() {
  const [cust] = await db.insert(s.customers).values({ name: `M47 cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(cust.id);
  const [route] = await db.insert(s.routes).values({ name: `M47 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M47 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M47-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(opts: {
  tripId: number;
  expenseTypeCode: string;
  buyAmount?: string;
  invoiceNumber?: string | null;
  note?: string | null;
  approvalStatus?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    expenseType: opts.expenseTypeCode,
    buyAmount: opts.buyAmount ?? '500000',
    sellAmount: '0',
    supplierId: null,
    invoiceNumber: opts.invoiceNumber ?? null,
    invoiceDate: opts.invoiceNumber ? '2026-07-15' : null,
    note: opts.note ?? null,
    approvalStatus: opts.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

/** Run transitionApproval in a rollback-only tx so the guard fires but
 *  no PENDING row is left APPROVED. */
async function runApproveTx(expenseId: number, actorRole: 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' = 'ADMIN'): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await transitionApproval(tx, {
        table: 'trip_expenses', id: expenseId, toStatus: 'APPROVED',
        actorId: 1, actorRole,
      });
      throw new RollbackSentinel();
    });
  } catch (e) {
    if (e instanceof RollbackSentinel) return;
    throw e;
  }
}
class RollbackSentinel extends Error {}

after(async () => {
  const namePattern = `M47 %${suffix}%`;
  try {
    if (createdAuditIds.length > 0) await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdFetIds.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdFetIds));
  } catch (err) { console.warn('[m47] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M4.7 — assertNoInvoiceDisbursementAllowed (standalone)', () => {
  test('substituteEvidenceAllowed=false + no invoice → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'no-sub' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: 'has note' });
    await assert.rejects(
      () => assertNoInvoiceDisbursementAllowed(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /không cho phép chi hộ không hóa đơn/.test(err.message),
    );
  });

  test('allowed + note empty → blocked (substitute evidence required)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'no-note' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: null });
    await assert.rejects(
      () => assertNoInvoiceDisbursementAllowed(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /thiếu căn cứ thay thế/.test(err.message),
    );
  });

  test('allowed + note whitespace-only → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'ws-note' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: '   ' });
    await assert.rejects(
      () => assertNoInvoiceDisbursementAllowed(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });

  test('allowed + note present + amount ≤ threshold → no-op', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'ok' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '500000', note: 'biên nhận bốc xếp' });
    await assertNoInvoiceDisbursementAllowed(e.id, 'ACCOUNTANT');
  });

  test('amount > DIRECTOR_THRESHOLD + ACCOUNTANT → blocked (needs director)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'over-thr' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1), note: 'big no-invoice',
    });
    await assert.rejects(
      () => assertNoInvoiceDisbursementAllowed(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403 && /cần giám đốc/.test(err.message),
    );
  });

  test('amount > DIRECTOR_THRESHOLD + MANAGER → no-op (director can approve)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'mgr-ok' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1_000_000), note: 'big',
    });
    await assertNoInvoiceDisbursementAllowed(e.id, 'MANAGER');
  });

  test('has-invoice expense → bypass (M4.6 owns it)', async () => {
    const fet = await mkFet({ requiresInvoice: true, substituteEvidenceAllowed: false, tag: 'has-inv' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      invoiceNumber: 'INV-1', note: null,
    });
    // Should not throw — has-invoice path bypasses this guard.
    await assertNoInvoiceDisbursementAllowed(e.id, 'ACCOUNTANT');
  });

  test('unknown expense code → fail open', async () => {
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: `NOPE-${suffix}`, note: null });
    await assertNoInvoiceDisbursementAllowed(e.id, 'ACCOUNTANT');
  });

  test('missing expense → no-op (let downstream 404 fire)', async () => {
    await assertNoInvoiceDisbursementAllowed(99_999_999, 'ADMIN');
  });
});

describe('M4.7 — transitionApproval wiring', () => {
  test('APPROVE no-invoice expense with substituteEvidenceAllowed=false → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'wire-block' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: 'note' });
    await assert.rejects(
      () => runApproveTx(e.id, 'ADMIN'),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });

  test('APPROVE no-invoice expense with allowed + note + small amount → succeeds', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-ok' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '300000', note: 'biên nhận' });
    await runApproveTx(e.id, 'ACCOUNTANT');
  });

  test('APPROVE over-threshold no-invoice by ACCOUNTANT → blocked', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-over' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 500_000), note: 'big',
    });
    await assert.rejects(
      () => runApproveTx(e.id, 'ACCOUNTANT'),
      (err: Error & { statusCode?: number }) => err.statusCode === 403,
    );
  });

  test('APPROVE over-threshold no-invoice by MANAGER → succeeds', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'wire-mgr' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 500_000), note: 'big',
    });
    await runApproveTx(e.id, 'MANAGER');
  });

  test('REJECT bypasses the guard', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: false, tag: 'wire-reject' });
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, note: null });
    try {
      await db.transaction(async (tx) => {
        await transitionApproval(tx, {
          table: 'trip_expenses', id: e.id, toStatus: 'REJECTED',
          actorId: 1, actorRole: 'ACCOUNTANT',
        });
        throw new RollbackSentinel();
      });
    } catch (err) {
      if (!(err instanceof RollbackSentinel)) throw err;
    }
  });
});

// ─── Slice 2: no-invoice disbursement report ────────────────────────────────

describe('M4.7 slice 2 — getNoInvoiceDisbursementReport', () => {
  test('empty range → empty report', async () => {
    const report = await getNoInvoiceDisbursementReport({ from: '1970-01-01', to: '1970-01-02' });
    assert.equal(report.items.length, 0);
    assert.equal(report.totals.count, 0);
    assert.equal(report.totals.sumBuyAmount, 0);
  });

  test('lists APPROVED no-invoice expenses with type name + trip code', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-list' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '300000', note: 'biên nhận bốc xếp',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item, 'expense appears in report');
    assert.equal(item!.expenseTypeName, fet.name);
    assert.equal(item!.tripCode, trip.tripCode);
    assert.equal(item!.buyAmount, 300_000);
    assert.equal(item!.note, 'biên nhận bốc xếp');
    assert.equal(item!.overThreshold, false);
  });

  test('excludes expenses WITH an invoice number', async () => {
    const fet = await mkFet({ requiresInvoice: true, substituteEvidenceAllowed: true, tag: 'rpt-excl' });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      invoiceNumber: 'INV-RPT', buyAmount: '500000',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const hasInv = report.items.some(i => i.expenseTypeCode === fet.code);
    assert.equal(hasInv, false, 'invoiced expense excluded from no-invoice report');
  });

  test('excludes non-APPROVED expenses', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-pending' });
    const trip = await mkTrip();
    await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '100000', note: 'pending', approvalStatus: 'PENDING',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const hasPending = report.items.some(i => i.expenseTypeCode === fet.code);
    assert.equal(hasPending, false, 'PENDING expense excluded');
  });

  test('traces to approver via audit log', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-audit' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '200000', note: 'có biên nhận', approvalStatus: 'APPROVED',
    });
    // Insert a fake audit log entry simulating the approval.
    const [audit] = await db.insert(s.auditLogs).values({
      userId: 1,
      actorName: 'Admin Test',
      entityType: 'trip-expenses',
      entityId: e.id,
      message: 'Admin Test đã phê duyệt chi phí',
    }).returning();
    createdAuditIds.push(audit.id);

    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.approverId, 1);
    assert.equal(item!.approverName, 'Admin Test');
    assert.ok(item!.approvedAt);
  });

  test('expense without audit entry → approverId=null (legacy data)', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-no-audit' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '150000', note: 'no audit trail', approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.approverId, null);
    assert.equal(item!.approverName, null);
  });

  test('overThreshold flag set when buyAmount > DIRECTOR_THRESHOLD', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-over' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(DIRECTOR_THRESHOLD + 1_000_000), note: 'big',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.overThreshold, true);
    assert.equal(report.totals.overThresholdCount, 1);
    assert.equal(report.totals.overThresholdSum, DIRECTOR_THRESHOLD + 1_000_000);
  });

  test('approverId filter narrows to one approver', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-filter' });
    const trip = await mkTrip();
    const e1 = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '100000', note: 'a', approvalStatus: 'APPROVED',
    });
    const e2 = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: '200000', note: 'b', approvalStatus: 'APPROVED',
    });
    // Audit for e1 only → approverId=999.
    const [audit] = await db.insert(s.auditLogs).values({
      userId: 999, actorName: 'User 999',
      entityType: 'trip-expenses', entityId: e1.id,
      message: 'User 999 đã phê duyệt chi phí',
    }).returning();
    createdAuditIds.push(audit.id);

    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today, approverId: 999 });
    const ids = report.items.map(i => i.expenseId);
    assert.ok(ids.includes(e1.id));
    assert.ok(!ids.includes(e2.id), 'e2 (no audit by 999) excluded');
  });

  test('totals aggregate correctly', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-totals' });
    const trip = await mkTrip();
    await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '100000', note: 'x', approvalStatus: 'APPROVED' });
    await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, buyAmount: '200000', note: 'y', approvalStatus: 'APPROVED' });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const mine = report.items.filter(i => i.expenseTypeCode === fet.code);
    assert.equal(mine.length, 2);
    const mySum = mine.reduce((s, i) => s + i.buyAmount, 0);
    assert.equal(mySum, 300_000);
  });
});
