/**
 * Wave 3 M4.7 — no-invoice disbursement policy tests.
 *
 * Covers the no-invoice policy boundary after the approval-workflow removal:
 *   - only allowed categories can proceed without invoice (create boundary)
 *   - the policy snapshot carries evidence and limit configuration
 *   - trip expenses record directly while substitute evidence stays required
 *   - the report recognizes recorded costs and preserves historical approval audit
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { createTripExpense } from '../services/forwarder.service';
import { disconnectRedis } from '../lib/redis';
import {
  buildNoInvoicePolicySnapshotForExpenseInput,
  getNoInvoiceDisbursementReport,
  PER_ITEM_THRESHOLD,
} from '../services/no-invoice-disbursement.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdFetIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdPhotoIds: number[] = [];
const createdAuditIds: number[] = [];
const createdUserIds: number[] = [];
let makerId: number;

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `m47-maker-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT' },
  ]).returning({ id: s.users.id });
  [makerId] = users.map(user => user.id);
  createdUserIds.push(...users.map(user => user.id));
});

async function mkFet(opts: {
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  noInvoiceEvidenceTypes?: string[];
  noInvoicePerItemLimit?: string;
  noInvoicePerDayLimit?: string;
  tag: string;
}) {
  const code = `M47-${createdFetIds.length}-${opts.tag}-${suffix}`.slice(0, 50);
  const [fet] = await db.insert(s.forwarderExpenseTypes).values({
    code,
    name: `M47 type ${opts.tag} ${suffix}`,
    requiresInvoice: opts.requiresInvoice ?? false,
    substituteEvidenceAllowed: opts.substituteEvidenceAllowed ?? true,
    noInvoiceEvidenceTypes: opts.noInvoiceEvidenceTypes ?? ['RECEIPT', 'BANK_TRANSFER', 'SIGNED_CONFIRMATION'],
    noInvoicePerItemLimit: opts.noInvoicePerItemLimit,
    noInvoicePerDayLimit: opts.noInvoicePerDayLimit,
  }).returning();
  createdFetIds.push(fet.id);
  return fet;
}

async function mkTrip(opts: { withShipment?: boolean } = {}) {
  const [cust] = await db.insert(s.customers).values({ name: `M47 cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(cust.id);
  const [route] = await db.insert(s.routes).values({ name: `M47 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M47 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  let shipmentId: number | null = null;
  if (opts.withShipment) {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: cust.id,
      shipmentCode: `M47-SHP-${suffix}-${createdShipmentIds.length}`.slice(0, 50),
      createdBy: makerId,
      updatedBy: makerId,
    }).returning({ id: s.shipments.id });
    shipmentId = shipment.id;
    createdShipmentIds.push(shipment.id);
  }
  const trip = await insertTripComposite(db, {
    tripCode: `M47-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    shipmentId,
    status: 'IN_TRANSIT', departureDate: '2026-07-15', carrierType: 'OWN',
  });
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(opts: {
  tripId: number;
  expenseTypeCode: string;
  buyAmount?: string;
  expenseDate?: string | null;
  payeeName?: string | null;
  invoiceNumber?: string | null;
  note?: string | null;
  noInvoiceEvidenceTypes?: string[];
  approvalStatus?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    createdBy: makerId,
    expenseType: opts.expenseTypeCode,
    buyAmount: opts.buyAmount ?? '500000',
    sellAmount: '0',
    supplierId: null,
    expenseDate: 'expenseDate' in opts ? (opts.expenseDate ?? null) : '2026-07-15',
    payeeName: 'payeeName' in opts ? (opts.payeeName ?? null) : 'Nguyen Van A',
    invoiceNumber: opts.invoiceNumber ?? null,
    invoiceDate: opts.invoiceNumber ? '2026-07-15' : null,
    note: opts.note ?? null,
    noInvoiceEvidenceTypes: opts.noInvoiceEvidenceTypes ?? ['RECEIPT'],
    approvalStatus: opts.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

after(async () => {
  const namePattern = `M47 %${suffix}%`;
  try {
    if (createdAuditIds.length > 0) await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditIds));
    if (createdPhotoIds.length > 0) {
      await db.delete(s.photoGeotags).where(and(
        eq(s.photoGeotags.entityType, 'trip_expense_photo'),
        inArray(s.photoGeotags.entityId, createdPhotoIds),
      ));
    }
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.tripExpenseId, createdExpenseIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdFetIds.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdFetIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) { console.warn('[m47] cleanup:', (err as Error).message); }
  await disconnectRedis();
  await client.end();
});

describe('M4.7 — no-invoice policy snapshot (create boundary)', () => {
  test('requiresInvoice=true + missing invoice is rejected at create trust boundary', async () => {
    const fet = await mkFet({ requiresInvoice: true, tag: 'req-inv-create' });
    await assert.rejects(
      () => buildNoInvoicePolicySnapshotForExpenseInput(db, {
        expenseType: fet.code,
        invoiceNumber: null,
      }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /bắt buộc phải có hóa đơn/.test(err.message),
    );
  });

  test('policy snapshot exposes accepted default aliases, explicit scope, and exception governance metadata', async () => {
    const fet = await mkFet({ tag: 'snapshot-aliases' });
    const snapshot = await buildNoInvoicePolicySnapshotForExpenseInput(db, {
      expenseType: fet.code,
      invoiceNumber: null,
    });
    assert.ok(snapshot);
    assert.deepEqual(snapshot.allowedEvidenceTypes, ['RECEIPT', 'BANK_TRANSFER', 'SIGNED_CONFIRMATION']);
    assert.deepEqual(snapshot.defaultCategoryAliases, [fet.name], 'custom categories fall back to the configured name');
    assert.equal(snapshot.requiredScope, 'TRIP_OR_SHIPMENT');
    assert.equal(snapshot.exceptionReasonRequiredWhenThresholdExceeded, true);
  });
});

describe('M4.7 — direct no-invoice recording', () => {
  test('valid substitute evidence records immediately with no approver', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'direct-valid' });
    const trip = await mkTrip();
    const row = await createTripExpense(db, {
      tripId: trip.id, forwarderId: null, createdBy: makerId, expenseType: fet.code,
      buyAmount: '300000', sellAmount: '0', settlementMethod: 'COMPANY_DIRECT',
      expenseDate: '2026-07-15', payeeName: 'Warehouse recipient',
      note: 'Receipt for unloading', noInvoiceEvidenceTypes: ['RECEIPT'],
    });
    createdExpenseIds.push(row.id);
    assert.equal(row.approvalStatus, 'RECORDED');
    assert.equal(row.approvedBy, null);
    assert.equal(row.approvedAt, null);
    assert.deepEqual(row.noInvoiceEvidenceTypes, ['RECEIPT']);
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today, categoryCode: fet.code });
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].expenseId, row.id);
    assert.equal(report.totals.sumBuyAmount, 300000);
    assert.equal(report.items[0].approverId, null, 'new costs do not fabricate a legacy approval');
  });

  test('missing substitute evidence still rejects before recording', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'direct-missing' });
    const trip = await mkTrip();
    await assert.rejects(createTripExpense(db, {
      tripId: trip.id, forwarderId: null, createdBy: makerId, expenseType: fet.code,
      buyAmount: '300000', expenseDate: '2026-07-15', payeeName: 'Warehouse recipient',
      note: 'Missing evidence', noInvoiceEvidenceTypes: [],
    }), (error: Error & { statusCode?: number }) => error.statusCode === 400 && /chứng cứ/.test(error.message));
    assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id))).length, 0);
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

  test('report preserves shipment linkage for shipment-rooted no-invoice expenses', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-shipment-link' });
    const trip = await mkTrip({ withShipment: true });
    const e = await mkExpense({
      tripId: trip.id,
      expenseTypeCode: fet.code,
      buyAmount: '300000',
      note: 'Biên nhận chi cho lô hàng gắn chuyến',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.tripId, trip.id);
    assert.equal(item!.shipmentId, trip.shipmentId);
    assert.ok(item!.shipmentId, 'shipment linkage is exposed on the returned boundary');
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

  test('excludes historical pending expenses', async () => {
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

  test('preserves historical approver audit without creating a new workflow', async () => {
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

  test('overThreshold flag set when buyAmount > per-item limit', async () => {
    const fet = await mkFet({ substituteEvidenceAllowed: true, tag: 'rpt-over' });
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      buyAmount: String(PER_ITEM_THRESHOLD + 1_000_000), note: 'big',
      approvalStatus: 'APPROVED',
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await getNoInvoiceDisbursementReport({ from: today, to: today });
    const item = report.items.find(i => i.expenseId === e.id);
    assert.ok(item);
    assert.equal(item!.overThreshold, true);
    const matchingItems = report.items.filter(i => i.expenseTypeCode === fet.code);
    assert.equal(matchingItems.length, 1);
    assert.equal(matchingItems[0]!.buyAmount, PER_ITEM_THRESHOLD + 1_000_000);
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
