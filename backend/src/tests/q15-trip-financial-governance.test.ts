import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { FuelMode, LoadingType, Role, TripStatus, TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
import tripsRoutes from '../routes/trips';
import paymentsRoutes from '../routes/financial/payments.routes';
import {
  applyGovernanceActionDirect,
  assertActiveApprovalApplication,
  buildGovernanceAction,
} from '../services/governance-action-core.service';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogMiddleware } from '../middleware/audit';
import { disconnectRedis } from '../lib/redis';
import { initAuditService } from '../services/audit.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { matchDeclaredMaterialWrite } from '../middleware/material-write';
import type { Tx } from '../services/trip-shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const supplierIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const driverIds: number[] = [];
const truckIds: number[] = [];
const tripExpenseIds: number[] = [];
const expenseTypeIds: number[] = [];
const idempotencyKeys: string[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];
let server: http.Server;
let baseUrl = '';

async function api(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown> | undefined,
  actorIndex: number,
  idempotencyKey?: string,
) {
  if (idempotencyKey && !idempotencyKeys.includes(idempotencyKey)) {
    idempotencyKeys.push(idempotencyKey);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Actor': String(actorIndex),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

/**
 * Governed-trip fixture. 2026-09-11 maker-checker removal: the governed close
 * applies in-request, so tests that need a COMPLETED trip seed the row
 * directly here instead of staging one through a check→approve sequence.
 */
async function createTripFixture(status: TripStatus) {
  const [customer] = await db.insert(s.customers).values({
    name: `Q15 trip customer ${suffix}-${customerIds.length}`,
  }).returning();
  customerIds.push(customer.id);
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q15 trip supplier ${suffix}-${supplierIds.length}`,
  }).returning();
  supplierIds.push(supplier.id);
  const [route] = await db.insert(s.routes).values({
    name: `Q15 trip route ${suffix}-${routeIds.length}`,
  }).returning();
  routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 trip cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q15${suffix}${truckIds.length}`.replace(/[^A-Za-z0-9]/g, '').slice(-20),
  }).returning();
  truckIds.push(truck.id);
  const [driverUser] = await db.insert(s.users).values({
    username: `q15-trip-driver-${suffix}-${driverIds.length}`,
    passwordHash: 'x',
    role: Role.DRIVER,
    status: 'ACTIVE',
  }).returning();
  userIds.push(driverUser.id);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `Q15 driver ${suffix}-${driverIds.length}`,
    assignedTruckId: truck.id,
  }).returning();
  driverIds.push(driver.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    status: 'IN_TRANSIT',
    cargoMode: 'LCL',
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  const trip = await insertTripComposite(db, {
    tripCode: `Q15-TRIP-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: customer.id,
    truckId: truck.id,
    driverId: driver.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status,
    departureDate: '2026-07-28',
    revenue: '1200000',
    totalFuelCost: '300000',
    fuelSupplierId: supplier.id,
    fuelMode: FuelMode.AUTO,
    carrierType: 'OWN',
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    ...(status === TripStatus.COMPLETED ? { completedAt: new Date() } : {}),
    // O2C: the governed-close path requires POD recovery before completion.
    podRecoveredAt: new Date(),
    podRecoveredBy: driverUser.id,
  });
  // O2C: the photo-evidence gate fires on IN_TRANSIT → COMPLETED. Insert a
  // baseline photo so a governed close passes the ≥1-photo requirement
  // (evidence-gate tests delete it explicitly).
  await db.insert(s.tripPhotos).values({
    tripId: trip.id,
    type: 'OTHER',
    storageKey: `q15-photo-${trip.id}.jpg`,
    uploadedBy: driverUser.id,
  });
  await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
    submittedBy: driverUser.id,
    submittedAt: new Date(),
    reviewedBy: actors[1]!.id,
    reviewedAt: new Date(),
  });
  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId: trip.id,
    tripContainerId: null,
    status: 'COMPLETED',
    completedBy: actors[0]!.id,
    completedAt: new Date(),
  });
  tripIds.push(trip.id);
  return trip;
}

async function ledgerRows(tripId: number) {
  return db.select().from(s.ledger)
    .where(eq(s.ledger.txnId, tripId))
    .orderBy(s.ledger.id);
}

async function createOfficeTripExpense(input: {
  tripId: number;
  requiresInvoice?: boolean;
  completeEvidence?: boolean;
}) {
  const [expenseType] = await db.insert(s.forwarderExpenseTypes).values({
    code: `Q15-OFFICE-${suffix}-${expenseTypeIds.length}`.slice(0, 50),
    name: `Q15 office expense ${suffix}-${expenseTypeIds.length}`,
    requiresInvoice: input.requiresInvoice ?? true,
    substituteEvidenceAllowed: input.requiresInvoice ? false : true,
    noInvoiceEvidenceTypes: ['RECEIPT'],
  }).returning();
  expenseTypeIds.push(expenseType.id);
  const completeEvidence = input.completeEvidence ?? true;
  const [expense] = await db.insert(s.tripExpenses).values({
    tripId: input.tripId,
    createdBy: actors[0]!.id,
    expenseType: expenseType.code,
    buyAmount: '450000',
    sellAmount: '0',
    settlementMethod: 'COMPANY_CASH',
    expenseDate: completeEvidence ? '2026-07-28' : null,
    payeeName: completeEvidence ? `Q15 payee ${suffix}` : null,
    invoiceNumber: input.requiresInvoice === false ? null : `Q15-INV-${suffix}`.slice(0, 50),
    invoiceDate: input.requiresInvoice === false ? null : '2026-07-28',
    note: completeEvidence ? 'Đã đối chiếu chứng từ chi phí chuyến' : 'Thiếu căn cứ',
    noInvoiceEvidenceTypes: input.requiresInvoice === false && completeEvidence ? ['RECEIPT'] : [],
    approvalStatus: 'PENDING',
  }).returning();
  tripExpenseIds.push(expense.id);
  return expense;
}

async function waitForAuditEvent(userId: number, event: string | string[], tripId: number) {
  const events = Array.isArray(event) ? event : [event];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(and(eq(s.auditLogs.userId, userId), eq(s.auditLogs.entityId, tripId)))
      .orderBy(desc(s.auditLogs.id));
    const match = rows.find((row) => (
      events.includes((row.payload as Record<string, unknown>).event as string)
    ));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

before(async () => {
  await initAuditService();
  actors = await db.insert(s.users).values([
    { username: `q15-trip-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `q15-trip-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `q15-trip-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
    { username: `q15-trip-viewer-${suffix}`, passwordHash: 'x', role: Role.DRIVER, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  userIds.push(...actors.map((actor) => actor.id));

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actor = actors[Number(req.header('X-Test-Actor') ?? 0)] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-trip-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api/trips', tripsRoutes);
  app.use('/api', paymentsRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (tripIds.length > 0) {
    await db.delete(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'trips'),
      inArray(s.notifications.relatedEntityId, tripIds),
    ));
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.tripId, tripIds));
    await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, tripIds));
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, tripIds));
    await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.tripId, tripIds));
    const milestones = await db.select({ id: s.shipmentMilestones.id })
      .from(s.shipmentMilestones)
      .where(inArray(s.shipmentMilestones.tripId, tripIds));
    if (milestones.length > 0) {
      await db.delete(s.customerVisibleEvents)
        .where(inArray(s.customerVisibleEvents.milestoneId, milestones.map((row) => row.id)));
    }
    await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.tripId, tripIds));
    await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, tripIds));
    // The fixture inserts a trip_photos row per trip; trips.id has a RESTRICT
    // FK from trip_photos.trip_id, so these must be removed before the
    // `DELETE trips` below or the teardown fails with a FK violation.
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, tripIds));
    if (tripExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, tripExpenseIds));
    }
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (fulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (cargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (supplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, supplierIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (expenseTypeIds.length > 0) {
    await db.delete(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.id, expenseTypeIds));
  }
  if (driverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  }
  if (truckIds.length > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
  }
  if (userIds.length > 0) {
    // Notifications can be emitted asynchronously after the trip-scoped
    // cleanup above. Remove every row owned by this test's principals before
    // deleting those principals so the suite is isolated from delivery timing
    // and from IDs reused after a local database reset.
    await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
    await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, userIds));
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q15 trip financial governance', () => {
  it('governs office trip-expense approval/rejection and preserves final evidence guards', async () => {
    const trip = await createTripFixture(TripStatus.IN_TRANSIT);
    const expense = await createOfficeTripExpense({ tripId: trip.id });
    const requestBody = {
      expectedVersion: expense.version,
      reason: 'Đề nghị duyệt chi phí văn phòng cho chuyến',
      evidence: {
        reviewNote: 'Đã đối chiếu hóa đơn và số tiền',
        attachmentRefs: ['INV-Q15'],
      },
    };
    const viewer = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${expense.id}/approve`,
      requestBody,
      3,
      `q15-office-viewer-${suffix}`,
    );
    assert.equal(viewer.status, 403);

    const requestKey = `q15-office-request-${suffix}`;
    const requested = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${expense.id}/approve`,
      requestBody,
      0,
      requestKey,
    );
    assert.equal(requested.status, 200, JSON.stringify(requested.body));
    assert.equal(requested.body.actionKind, 'TRIP_EXPENSE_APPROVAL');
    // 2026-09-11 maker-checker removed: the create response IS the applied
    // record — no staged pending window remains.
    assert.equal(requested.body.status, 'APPROVED');
    assert.ok(requested.body.applicationResult);
    const replay = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${expense.id}/approve`,
      requestBody,
      0,
      requestKey,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, requested.body.id);
    assert.equal(replay.body.replayed, true);
    const drift = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${expense.id}/approve`,
      { ...requestBody, reason: 'Nội dung khác' },
      0,
      requestKey,
    );
    assert.equal(drift.status, 409);

    // The decision applied in-request — the expense is final, and trip-expense
    // decisions mutate the expense row only (ledger posting happens at trip
    // close, not at expense decision time).
    const [applied] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id)).limit(1);
    assert.equal(applied.approvalStatus, 'APPROVED');
    assert.equal(applied.version, expense.version + 1);
    assert.equal((await ledgerRows(trip.id)).length, 0);

    // The reject route applies REJECTED in-request the same way.
    const rejectExpense = await createOfficeTripExpense({ tripId: trip.id });
    const rejection = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${rejectExpense.id}/reject`,
      { ...requestBody, expectedVersion: rejectExpense.version },
      0,
      `q15-office-reject-${suffix}`,
    );
    assert.equal(rejection.status, 200, JSON.stringify(rejection.body));
    assert.equal(rejection.body.status, 'APPROVED');
    assert.ok(rejection.body.applicationResult);
    const [rejectedRow] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, rejectExpense.id)).limit(1);
    assert.equal(rejectedRow.approvalStatus, 'REJECTED');

    // The missing-evidence guard still applies in-request: an
    // invoice-required expense without receipts returns for evidence.
    const incomplete = await createOfficeTripExpense({
      tripId: trip.id,
      requiresInvoice: false,
      completeEvidence: false,
    });
    const incompleteRequest = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${incomplete.id}/approve`,
      { ...requestBody, expectedVersion: incomplete.version },
      0,
      `q15-office-incomplete-${suffix}`,
    );
    assert.equal(incompleteRequest.status, 200);
    assert.equal(
      (incompleteRequest.body.applicationResult as Record<string, unknown>).outcome,
      'RETURN_FOR_EVIDENCE',
    );
    const [returnedByFinalGuard] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, incomplete.id)).limit(1);
    assert.equal(returnedByFinalGuard.approvalStatus, 'RETURN_FOR_EVIDENCE');
  });

  it('applies governed close, completed-trip change, and cancellation in-request', async () => {
    const trip = await createTripFixture(TripStatus.IN_TRANSIT);
    const closeKey = `q15-close-${suffix}`;
    const closeBody = {
      expectedVersion: trip.version,
      reason: 'Hoàn thành vận chuyển và ghi nhận công nợ',
    };
    const close = await api('POST', `/api/trips/${trip.id}/complete`, closeBody, 2, closeKey);
    assert.equal(close.status, 200, JSON.stringify(close.body));
    assert.equal(close.body.actionKind, 'TRIP_FINANCIAL_CLOSE');
    assert.equal(close.body.status, 'APPROVED');
    assert.ok(close.body.applicationResult);

    const closeReplay = await api('POST', `/api/trips/${trip.id}/complete`, closeBody, 2, closeKey);
    assert.equal(closeReplay.status, 200);
    assert.equal(closeReplay.body.id, close.body.id);
    assert.equal(closeReplay.body.replayed, true);

    // A duplicate close after apply is refused: the trip is no longer
    // IN_TRANSIT, so a second governed close cannot be requested.
    const duplicateClose = await api(
      'POST',
      `/api/trips/${trip.id}/complete`,
      closeBody,
      2,
      `q15-close-dup-${suffix}`,
    );
    assert.equal(duplicateClose.status, 409, JSON.stringify(duplicateClose.body));

    const [completed] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(completed.status, TripStatus.COMPLETED);
    const completedLedger = await ledgerRows(trip.id);
    assert.equal(completedLedger.filter((row) => row.txnType === TxnType.TRIP_REVENUE).length, 1);
    assert.equal(completedLedger.filter((row) => row.txnType === TxnType.FUEL_EXPENSE).length, 1);
    const attendance = await db.select().from(s.driverWorkDays)
      .where(eq(s.driverWorkDays.tripId, trip.id));
    assert.equal(attendance.length, 1);
    const [tripDriver] = await db.select({
      userId: s.drivers.userId,
    }).from(s.drivers)
      .where(eq(s.drivers.id, trip.driverId!))
      .limit(1);
    assert.ok(tripDriver?.userId);
    const notificationsBeforeReplay = await db.select({
      id: s.notifications.id,
      userId: s.notifications.userId,
    }).from(s.notifications)
      .where(and(
        eq(s.notifications.type, 'TRIP_COMPLETED'),
        eq(s.notifications.relatedEntityType, 'trips'),
        eq(s.notifications.relatedEntityId, trip.id),
      ));
    assert.deepEqual(
      notificationsBeforeReplay.map((row) => row.userId),
      [tripDriver.userId],
    );
    assert.ok(await waitForAuditEvent(
      actors[2]!.id,
      ['TRIP_FINANCIAL_CLOSE_REQUESTED', 'TRIP_COMPLETED'],
      trip.id,
    ));

    // Completed-trip money edits still apply through a governed change, now
    // in-request: the response record carries the applied effects.
    const change = await api('PUT', `/api/trips/${trip.id}/actuals`, {
      legs: [{
        sequence: 1,
        origin: 'Cảng A',
        destination: 'Kho B',
        km: 20,
        loadingType: LoadingType.HANG,
      }],
      fuelMode: FuelMode.AUTO,
      revenue: 1_700_000,
      version: completed.version,
      governanceReason: 'Điều chỉnh doanh thu theo biên bản đối soát',
    }, 2, `q15-change-${suffix}`);
    assert.equal(change.status, 200, JSON.stringify(change.body));
    // Status-removal tail: the actuals write applies directly — no governance
    // envelope on the response; the readback + audit trail carry the proof.
    assert.ok(await waitForAuditEvent(
      actors[2]!.id,
      ['TRIP_FINANCIAL_CHANGE_REQUESTED', 'TRIP_UPDATED_ACTUALS'],
      trip.id,
    ));

    const [changed] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, trip.id)).limit(1);
    assert.equal(changed.revenue, '1700000');
    const changedLedger = await ledgerRows(trip.id);
    assert.equal(changedLedger.filter((row) => row.txnType === TxnType.TRIP_REVENUE).length, 2);
    assert.ok(changedLedger.some((row) => row.txnType === TxnType.UNLOCK_REVERSAL));

    // Cancellation of a completed trip also applies in-request.
    await applyTripPatch(db, trip.id, {
      fuelLitersOverride: '1',
      fuelSupplementLiters: '2',
      tollsDiscount: '3',
      tollsAddition: '4',
      tollsStations: 5,
      hasReturnCargo: true,
      fuelPriceApplied: '6',
      fuelActualUnitPrice: '7',
      roadAllowanceBaseApplied: '8',
      fuelLoadedNormApplied: '9',
      fuelEmptyNormApplied: '10',
      fuelFixedAllowanceApplied: '11',
      fuelSupplementNormApplied: '12',
      tollPerStationApplied: '13',
      returnCargoBonusApplied: '14',
      tollCost: '15',
      roadAllowanceOverride: '16',
      revenueEmptyReturn: '17',
      revenueCombine: '18',
      twoPointDeliveryBonus: '19',
      vehicleShiftAllowance: '20',
      revenueOriginal: '21',
      customerCommission: '22',
      tripWageDays: 23,
      vatRate: '0.08',
      externalFreightCost: '24',
    });

    const cancelKey = `q15-completed-cancel-${suffix}`;
    const cancelBody = {
      expectedVersion: changed.version,
      reason: 'Hủy chuyến đã hoàn thành và hoàn nhập công nợ',
    };
    const cancel = await api('POST', `/api/trips/${trip.id}/cancel`, cancelBody, 2, cancelKey);
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.actionKind, 'TRIP_FINANCIAL_CHANGE');
    assert.equal(cancel.body.status, 'APPROVED');
    assert.ok(cancel.body.applicationResult);
    assert.ok(await waitForAuditEvent(
      actors[2]!.id,
      ['TRIP_FINANCIAL_CANCEL_REQUESTED', 'TRIP_CANCELED'],
      trip.id,
    ));
    const cancelReplay = await api('POST', `/api/trips/${trip.id}/cancel`, cancelBody, 2, cancelKey);
    assert.equal(cancelReplay.status, 200);
    assert.equal(cancelReplay.body.replayed, true);

    // A duplicate cancel after apply is refused: the trip is already CANCELED.
    const duplicateCancel = await api(
      'POST',
      `/api/trips/${trip.id}/cancel`,
      cancelBody,
      2,
      `q15-completed-cancel-dup-${suffix}`,
    );
    assert.equal(duplicateCancel.status, 409, JSON.stringify(duplicateCancel.body));

    const [canceled] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, trip.id)).limit(1);
    assert.equal(canceled.status, TripStatus.CANCELED);
    for (const value of [
      canceled.fuelLitersOverride,
      canceled.fuelSupplementLiters,
      canceled.tollsDiscount,
      canceled.tollsAddition,
      canceled.tollsStations,
      canceled.fuelPriceApplied,
      canceled.fuelActualUnitPrice,
      canceled.roadAllowanceBaseApplied,
      canceled.fuelLoadedNormApplied,
      canceled.fuelEmptyNormApplied,
      canceled.fuelFixedAllowanceApplied,
      canceled.fuelSupplementNormApplied,
      canceled.tollPerStationApplied,
      canceled.returnCargoBonusApplied,
      canceled.fuelLiters,
      canceled.totalFuelCost,
      canceled.totalRoadAllowance,
      canceled.tollCost,
      canceled.roadAllowanceOverride,
      canceled.totalCost,
      canceled.revenue,
      canceled.revenueEmptyReturn,
      canceled.revenueCombine,
      canceled.twoPointDeliveryBonus,
      canceled.vehicleShiftAllowance,
      canceled.grossProfit,
      canceled.revenueOriginal,
      canceled.customerCommission,
      canceled.tripWageDays,
      canceled.vatRate,
      canceled.externalFreightCost,
      canceled.driverSalary,
    ]) {
      assert.equal(Number(value), 0);
    }
    assert.equal(canceled.hasReturnCargo, false);
    assert.equal(
      (await db.select().from(s.driverWorkDays)
        .where(eq(s.driverWorkDays.tripId, trip.id))).length,
      0,
    );
    const canceledLedger = await ledgerRows(trip.id);
    assert.equal(
      canceledLedger.filter((row) => row.txnType === TxnType.UNLOCK_REVERSAL).length,
      changedLedger.filter((row) => row.txnType !== TxnType.UNLOCK_REVERSAL).length,
    );
    // The idempotent replay applied nothing extra.
    assert.equal((await ledgerRows(trip.id)).length, canceledLedger.length);
  });

  it('rejects direct service completion without an approved governance action', async () => {
    const trip = await createTripFixture(TripStatus.IN_TRANSIT);
    await assert.rejects(
      transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        actors[0]!.id,
        actors[0]!.role,
      ),
      /phê duyệt quản trị/,
    );
    const [unchanged] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(unchanged.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(trip.id)).length, 0);
  });

  it('binds apply authority to the in-flight governed application', async () => {
    const trip = await createTripFixture(TripStatus.IN_TRANSIT);

    // A hostile adapter proves the apply authority is real inside the governed
    // application, cannot be reused for another action or transaction, and is
    // cleared once the adapter throws and the transaction rolls back.
    let retainedTx: Tx | undefined;
    let retainedActionId: number | undefined;
    let adapterArgCount = 0;
    await assert.rejects(
      applyGovernanceActionDirect({
        action: buildGovernanceAction({
          actionKind: 'TRIP_FINANCIAL_CLOSE',
          subjectType: 'TRIP',
          subjectId: trip.id,
          originalVersion: trip.version,
          makerId: actors[0]!.id,
          makerRole: Role.MANAGER,
        }),
        actorId: actors[2]!.id,
        actorRole: Role.ADMIN,
        apply: async (...args: unknown[]) => {
          const approvalTx = args[0] as Tx;
          const approvalAction = args[1] as { id: number };
          retainedTx = approvalTx;
          retainedActionId = approvalAction.id;
          adapterArgCount = args.length;
          assert.doesNotThrow(() => {
            assertActiveApprovalApplication(approvalTx, approvalAction.id);
          });
          assert.throws(
            () => assertActiveApprovalApplication(approvalTx, approvalAction.id + 1),
            /phê duyệt quản trị/,
          );
          await db.transaction(async (differentTx) => {
            assert.throws(
              () => assertActiveApprovalApplication(differentTx, approvalAction.id),
              /phê duyệt quản trị/,
            );
          });
          throw new Error('hostile adapter forced rollback');
        },
      }),
      /hostile adapter forced rollback/,
    );
    assert.equal(
      adapterArgCount,
      2,
      'the adapter must receive only the transaction and the action — no retainable authority argument',
    );
    assert.ok(retainedTx);
    assert.ok(retainedActionId);
    assert.throws(
      () => assertActiveApprovalApplication(retainedTx!, retainedActionId!),
      /phê duyệt quản trị/,
      'apply authority must be cleared after the adapter throws and the transaction rolls back',
    );

    // A compliant adapter runs the whole lifecycle in one request: policy
    // stages pass, the adapter holds real authority, and the returned record
    // is final (APPROVED + appliedAt + applicationResult).
    let benignAuthorityInside = false;
    const applied = await applyGovernanceActionDirect({
      action: buildGovernanceAction({
        actionKind: 'TRIP_FINANCIAL_CLOSE',
        subjectType: 'TRIP',
        subjectId: trip.id,
        originalVersion: trip.version,
        makerId: actors[0]!.id,
        makerRole: Role.MANAGER,
      }),
      actorId: actors[2]!.id,
      actorRole: Role.ADMIN,
      apply: async (tx, action) => {
        assert.doesNotThrow(() => assertActiveApprovalApplication(tx, action.id));
        benignAuthorityInside = true;
        return { applicationResult: { probe: 'applied' } };
      },
    });
    assert.equal(benignAuthorityInside, true);
    assert.equal(applied.action.status, 'APPROVED');
    assert.ok(applied.action.appliedAt instanceof Date);
    assert.deepEqual(applied.action.applicationResult, { probe: 'applied' });

    // Completed-trip mutation boundaries stay closed at create time: a
    // governed change and a completed-trip cancellation each require a reason.
    const completedFixture = await createTripFixture(TripStatus.COMPLETED);
    const editWithoutReason = await api('PUT', `/api/trips/${completedFixture.id}/actuals`, {
      legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 20, loadingType: LoadingType.HANG }],
      fuelMode: FuelMode.AUTO,
      revenue: 1_800_000,
      version: completedFixture.version,
    }, 2, `q15-boundary-edit-${suffix}`);
    assert.equal(editWithoutReason.status, 400);

    const cancelWithoutReason = await api('POST', `/api/trips/${completedFixture.id}/cancel`, {
      expectedVersion: completedFixture.version,
    }, 2, `q15-boundary-cancel-${suffix}`);
    assert.equal(cancelWithoutReason.status, 400);
  });

  it('declares close and completed cancellation as material writes', () => {
    assert.equal(
      matchDeclaredMaterialWrite('POST', '/api/trips/123/complete')?.endpoint,
      'trips.financial-close',
    );
    assert.equal(
      matchDeclaredMaterialWrite('POST', '/api/trips/123/cancel')?.endpoint,
      'trips.completed-cancel',
    );
  });

  it('applies bulk figure rows in-request, including completed trips', async () => {
    const completedSource = await createTripFixture(TripStatus.COMPLETED);
    const open = await createTripFixture(TripStatus.IN_TRANSIT);
    const noReasonTrip = await createTripFixture(TripStatus.COMPLETED);

    const bulk = await api('POST', '/api/trips/bulk-figures', {
      updates: [
        {
          tripId: completedSource.id,
          governanceReason: 'Điều chỉnh hàng loạt theo biên bản đối soát',
          figures: {
            legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 20, loadingType: LoadingType.HANG }],
            fuelMode: FuelMode.AUTO,
            revenue: 2_000_000,
            version: completedSource.version,
          },
        },
        {
          tripId: open.id,
          figures: {
            legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 10, loadingType: LoadingType.HANG }],
            fuelMode: FuelMode.AUTO,
            revenue: 1_300_000,
            version: open.version,
          },
        },
        {
          // A completed trip without a governance reason is a per-row failure.
          tripId: noReasonTrip.id,
          figures: {
            legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 12, loadingType: LoadingType.HANG }],
            fuelMode: FuelMode.AUTO,
            revenue: 1_400_000,
            version: noReasonTrip.version,
          },
        },
      ],
    }, 2, `q15-bulk-${suffix}`);
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
    assert.equal(bulk.body.failed, 1, JSON.stringify(bulk.body));
    const rows = bulk.body.results as Array<Record<string, unknown>>;
    assert.equal(rows.find((row) => row.tripId === completedSource.id)?.ok, true);
    assert.equal(rows.find((row) => row.tripId === open.id)?.ok, true);
    assert.equal(rows.find((row) => row.tripId === noReasonTrip.id)?.ok, false);

    // Direct apply: the completed-trip figures changed in-request, the open
    // trip applied as before, and the refused row left its trip untouched.
    const [appliedCompleted] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, completedSource.id)).limit(1);
    assert.equal(appliedCompleted.revenue, '2000000');
    const [appliedOpen] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, open.id)).limit(1);
    assert.equal(appliedOpen.revenue, '1300000');
    const [refusedRow] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, noReasonTrip.id)).limit(1);
    assert.equal(refusedRow.revenue, '1200000');
  });

  it('rejects role-, stale-, and evidence-gated close requests without changing trip or ledger state', async () => {
    // Role gate at create time: a driver cannot request a governed close.
    const roleTrip = await createTripFixture(TripStatus.IN_TRANSIT);
    const forbidden = await api('POST', `/api/trips/${roleTrip.id}/complete`, {
      expectedVersion: roleTrip.version,
      reason: 'Tài xế không được đề nghị hoàn thành',
    }, 3, `q15-close-role-${suffix}`);
    assert.equal(forbidden.status, 403);
    const [unchangedRoleTrip] = await db.select().from(s.trips)
      .where(eq(s.trips.id, roleTrip.id)).limit(1);
    assert.equal(unchangedRoleTrip.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(roleTrip.id)).length, 0);

    // Photo-evidence gate at create time: completion without a photo is 422.
    const photoTrip = await createTripFixture(TripStatus.IN_TRANSIT);
    await db.delete(s.tripPhotos).where(eq(s.tripPhotos.tripId, photoTrip.id));
    const noPhoto = await api('POST', `/api/trips/${photoTrip.id}/complete`, {
      expectedVersion: photoTrip.version,
      reason: 'Hoàn thành khi chưa có ảnh bằng chứng',
    }, 1, `q15-close-photo-${suffix}`);
    assert.equal(noPhoto.status, 422, JSON.stringify(noPhoto.body));
    const [unchangedPhotoTrip] = await db.select().from(s.trips)
      .where(eq(s.trips.id, photoTrip.id)).limit(1);
    assert.equal(unchangedPhotoTrip.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(photoTrip.id)).length, 0);

    // Stale version at create time: the request is refused and changes nothing.
    const staleTrip = await createTripFixture(TripStatus.IN_TRANSIT);
    await db.update(s.trips).set({ version: staleTrip.version + 1 })
      .where(eq(s.trips.id, staleTrip.id));
    const stale = await api('POST', `/api/trips/${staleTrip.id}/complete`, {
      expectedVersion: staleTrip.version,
      reason: 'Đề nghị hoàn thành với phiên bản cũ',
    }, 1, `q15-close-stale-${suffix}`);
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    const [unchangedStale] = await db.select().from(s.trips)
      .where(eq(s.trips.id, staleTrip.id)).limit(1);
    assert.equal(unchangedStale.status, TripStatus.IN_TRANSIT);
    assert.equal(unchangedStale.version, staleTrip.version + 1);
    assert.equal((await ledgerRows(staleTrip.id)).length, 0);
  });
});
