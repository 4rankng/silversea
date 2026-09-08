import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { FuelMode, LoadingType, Role, TripStatus, TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
import tripsRoutes from '../routes/trips';
import paymentsRoutes from '../routes/financial/payments.routes';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogMiddleware } from '../middleware/audit';
import { disconnectRedis } from '../lib/redis';
import { initAuditService } from '../services/audit.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { matchDeclaredMaterialWrite } from '../middleware/material-write';
import { updateTripFigures } from '../services/trip-mutations.service';
import {
  approveGovernanceActionWithAdapter,
  assertActiveApprovalApplication,
} from '../services/governance-transition.service';
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
const actionIds: number[] = [];
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

async function createInTransitTrip() {
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
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-07-28',
    revenue: '1200000',
    totalFuelCost: '300000',
    fuelSupplierId: supplier.id,
    fuelMode: FuelMode.AUTO,
    carrierType: 'OWN',
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    // O2C: the governed-close path requires POD recovery before completion.
    podRecoveredAt: new Date(),
    podRecoveredBy: driverUser.id,
  });
  // O2C: the photo-evidence gate fires on IN_TRANSIT → COMPLETED. Insert a
  // baseline photo so the governed close passes the ≥1-photo requirement.
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

async function waitForAuditEvent(userId: number, event: string, tripId: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(and(eq(s.auditLogs.userId, userId), eq(s.auditLogs.entityId, tripId)))
      .orderBy(desc(s.auditLogs.id));
    const match = rows.find((row) => (
      (row.payload as Record<string, unknown>).event === event
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
  app.use('/api', governanceActionsRoutes);
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
    await db.delete(s.governanceActions)
      .where(inArray(s.governanceActions.subjectId, tripIds));
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
    // createInTransitTrip inserts a trip_photos row per trip; trips.id has a
    // RESTRICT FK from trip_photos.trip_id, so these must be removed before the
    // `DELETE trips` below or the teardown fails with a FK violation.
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, tripIds));
    if (tripExpenseIds.length > 0) {
      await db.delete(s.governanceActions)
        .where(inArray(s.governanceActions.subjectId, tripExpenseIds));
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
  if (actionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, actionIds));
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
    const trip = await createInTransitTrip();
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
    assert.equal(requested.status, 202, JSON.stringify(requested.body));
    assert.equal(requested.body.actionKind, 'TRIP_EXPENSE_APPROVAL');
    actionIds.push(Number(requested.body.id));
    const replay = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${expense.id}/approve`,
      requestBody,
      0,
      requestKey,
    );
    assert.equal(replay.status, 202);
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

    const [pending] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id)).limit(1);
    assert.equal(pending.approvalStatus, 'PENDING');
    assert.equal(pending.version, expense.version);
    assert.equal((await ledgerRows(trip.id)).length, 0);

    const selfCheck = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/check`,
      { expectedVersion: requested.body.version },
      0,
      `q15-office-self-check-${suffix}`,
    );
    assert.equal(selfCheck.status, 403);
    const checked = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/check`,
      { expectedVersion: requested.body.version },
      1,
      `q15-office-check-${suffix}`,
    );
    assert.equal(checked.status, 200);
    const checkerApprove = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/approve`,
      { expectedVersion: checked.body.version },
      1,
      `q15-office-checker-approve-${suffix}`,
    );
    assert.equal(checkerApprove.status, 403);
    const approvals = await Promise.all([
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        2,
        `q15-office-approve-a-${suffix}`,
      ),
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        2,
        `q15-office-approve-b-${suffix}`,
      ),
    ]);
    assert.deepEqual(approvals.map(({ status }) => status).sort((a, b) => a - b), [200, 409]);
    const [approved] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id)).limit(1);
    assert.equal(approved.approvalStatus, 'APPROVED');
    assert.equal(approved.version, expense.version + 1);

    const staleExpense = await createOfficeTripExpense({ tripId: trip.id });
    await db.update(s.tripExpenses)
      .set({ version: sql`${s.tripExpenses.version} + 1` })
      .where(eq(s.tripExpenses.id, staleExpense.id));
    const stale = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${staleExpense.id}/approve`,
      { ...requestBody, expectedVersion: staleExpense.version },
      0,
      `q15-office-stale-${suffix}`,
    );
    assert.equal(stale.status, 409);

    const rejectedExpense = await createOfficeTripExpense({ tripId: trip.id });
    const rejection = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${rejectedExpense.id}/reject`,
      { ...requestBody, expectedVersion: rejectedExpense.version },
      0,
      `q15-office-reject-request-${suffix}`,
    );
    assert.equal(rejection.status, 202);
    actionIds.push(Number(rejection.body.id));
    const rejectedAction = await api(
      'POST',
      `/api/governance-actions/${rejection.body.id}/reject`,
      { expectedVersion: rejection.body.version, reason: 'Chưa đủ căn cứ ra quyết định' },
      2,
      `q15-office-reject-action-${suffix}`,
    );
    assert.equal(rejectedAction.status, 200);
    const [unchangedRejected] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, rejectedExpense.id)).limit(1);
    assert.equal(unchangedRejected.approvalStatus, 'PENDING');

    const finalRejectedExpense = await createOfficeTripExpense({ tripId: trip.id });
    const finalRejection = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${finalRejectedExpense.id}/reject`,
      { ...requestBody, expectedVersion: finalRejectedExpense.version },
      0,
      `q15-office-final-reject-request-${suffix}`,
    );
    actionIds.push(Number(finalRejection.body.id));
    const finalRejectionChecked = await api(
      'POST',
      `/api/governance-actions/${finalRejection.body.id}/check`,
      { expectedVersion: finalRejection.body.version },
      1,
      `q15-office-final-reject-check-${suffix}`,
    );
    const finalRejectionApproved = await api(
      'POST',
      `/api/governance-actions/${finalRejection.body.id}/approve`,
      { expectedVersion: finalRejectionChecked.body.version },
      2,
      `q15-office-final-reject-approve-${suffix}`,
    );
    assert.equal(finalRejectionApproved.status, 200);
    const [finallyRejected] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, finalRejectedExpense.id)).limit(1);
    assert.equal(finallyRejected.approvalStatus, 'REJECTED');

    const returnedExpense = await createOfficeTripExpense({ tripId: trip.id });
    const returnedRequest = await api(
      'POST',
      `/api/trips/${trip.id}/expenses/${returnedExpense.id}/approve`,
      { ...requestBody, expectedVersion: returnedExpense.version },
      0,
      `q15-office-return-request-${suffix}`,
    );
    actionIds.push(Number(returnedRequest.body.id));
    const returnedAction = await api(
      'POST',
      `/api/governance-actions/${returnedRequest.body.id}/return-for-evidence`,
      { expectedVersion: returnedRequest.body.version, reason: 'Bổ sung biên nhận' },
      1,
      `q15-office-return-action-${suffix}`,
    );
    assert.equal(returnedAction.status, 200);
    const [unchangedReturned] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, returnedExpense.id)).limit(1);
    assert.equal(unchangedReturned.approvalStatus, 'PENDING');

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
      `q15-office-incomplete-request-${suffix}`,
    );
    actionIds.push(Number(incompleteRequest.body.id));
    const incompleteChecked = await api(
      'POST',
      `/api/governance-actions/${incompleteRequest.body.id}/check`,
      { expectedVersion: incompleteRequest.body.version },
      1,
      `q15-office-incomplete-check-${suffix}`,
    );
    const incompleteApproved = await api(
      'POST',
      `/api/governance-actions/${incompleteRequest.body.id}/approve`,
      { expectedVersion: incompleteChecked.body.version },
      2,
      `q15-office-incomplete-approve-${suffix}`,
    );
    assert.equal(incompleteApproved.status, 200);
    assert.equal(
      (incompleteApproved.body.applicationResult as Record<string, unknown>).outcome,
      'RETURN_FOR_EVIDENCE',
    );
    const [returnedByFinalGuard] = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, incomplete.id)).limit(1);
    assert.equal(returnedByFinalGuard.approvalStatus, 'RETURN_FOR_EVIDENCE');
  });

  it('keeps close and completed-trip money edits pending until distinct checker and approver apply once', async () => {
    const trip = await createInTransitTrip();
    const closeKey = `q15-close-${suffix}`;
    const close = await api('POST', `/api/trips/${trip.id}/complete`, {
      expectedVersion: trip.version,
      reason: 'Hoàn thành vận chuyển và ghi nhận công nợ',
    }, 1, closeKey);
    assert.equal(close.status, 202);
    assert.equal(close.body.actionKind, 'TRIP_FINANCIAL_CLOSE');
    actionIds.push(Number(close.body.id));

    const closeReplay = await api('POST', `/api/trips/${trip.id}/complete`, {
      expectedVersion: trip.version,
      reason: 'Hoàn thành vận chuyển và ghi nhận công nợ',
    }, 1, closeKey);
    assert.equal(closeReplay.status, 202);
    assert.equal(closeReplay.body.id, close.body.id);
    assert.equal(closeReplay.body.replayed, true);

    const [stillInTransit] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(stillInTransit.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(trip.id)).length, 0);
    assert.ok(await waitForAuditEvent(
      actors[1]!.id,
      'TRIP_FINANCIAL_CLOSE_REQUESTED',
      trip.id,
    ));

    const selfCheck = await api('POST', `/api/governance-actions/${close.body.id}/check`, {
      expectedVersion: close.body.version,
    }, 1, `q15-close-self-check-${suffix}`);
    assert.equal(selfCheck.status, 403);

    const checked = await api('POST', `/api/governance-actions/${close.body.id}/check`, {
      expectedVersion: close.body.version,
    }, 0, `q15-close-check-${suffix}`);
    assert.equal(checked.status, 200);

    const checkerApprove = await api('POST', `/api/governance-actions/${close.body.id}/approve`, {
      expectedVersion: checked.body.version,
    }, 0, `q15-close-checker-approve-${suffix}`);
    assert.equal(checkerApprove.status, 403);

    const approveKeyA = `q15-close-approve-a-${suffix}`;
    const approveKeyB = `q15-close-approve-b-${suffix}`;
    const [firstApprove, concurrentApprove] = await Promise.all([
      api('POST', `/api/governance-actions/${close.body.id}/approve`, {
        expectedVersion: checked.body.version,
      }, 2, approveKeyA),
      api('POST', `/api/governance-actions/${close.body.id}/approve`, {
        expectedVersion: checked.body.version,
      }, 2, approveKeyB),
    ]);
    assert.deepEqual(
      [firstApprove.status, concurrentApprove.status].sort((a, b) => a - b),
      [200, 409],
    );

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
    const approveReplay = await api('POST', `/api/governance-actions/${close.body.id}/approve`, {
      expectedVersion: checked.body.version,
    }, 2, firstApprove.status === 200 ? approveKeyA : approveKeyB);
    assert.equal(approveReplay.status, 200);
    assert.equal(approveReplay.body.replayed, true);
    assert.equal((await ledgerRows(trip.id)).length, completedLedger.length);
    const notificationsAfterReplay = await db.select({
      id: s.notifications.id,
      userId: s.notifications.userId,
    }).from(s.notifications)
      .where(and(
        eq(s.notifications.type, 'TRIP_COMPLETED'),
        eq(s.notifications.relatedEntityType, 'trips'),
        eq(s.notifications.relatedEntityId, trip.id),
      ));
    assert.deepEqual(notificationsAfterReplay, notificationsBeforeReplay);
    assert.ok(await waitForAuditEvent(actors[2]!.id, 'TRIP_COMPLETED', trip.id));

    const viewer = await api('GET', `/api/governance-actions?subjectType=TRIP&subjectId=${trip.id}`, undefined, 3);
    assert.equal(viewer.status, 403);

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
    }, 0, `q15-change-${suffix}`);
    assert.equal(change.status, 202);
    assert.equal(change.body.actionKind, 'TRIP_FINANCIAL_CHANGE');
    actionIds.push(Number(change.body.id));
    assert.ok(await waitForAuditEvent(
      actors[0]!.id,
      'TRIP_FINANCIAL_CHANGE_REQUESTED',
      trip.id,
    ));

    const [beforeChangeApproval] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, trip.id)).limit(1);
    assert.equal(beforeChangeApproval.revenue, '1200000');
    assert.equal((await ledgerRows(trip.id)).length, completedLedger.length);

    const checkedChange = await api('POST', `/api/governance-actions/${change.body.id}/check`, {
      expectedVersion: change.body.version,
    }, 1, `q15-change-check-${suffix}`);
    assert.equal(checkedChange.status, 200);
    await assert.rejects(
      approveGovernanceActionWithAdapter({
        actionId: Number(change.body.id),
        approverId: actors[2]!.id,
        approverRole: actors[2]!.role,
        expectedVersion: Number(checkedChange.body.version),
        authorizeBeforeApply: () => true,
        apply: async (tx, action) => {
          const after = action.afterSnapshot as {
            figures: Parameters<typeof updateTripFigures>[1];
          };
          await updateTripFigures(
            trip.id,
            {
              ...after.figures,
              revenue: 1_900_000,
              expectedVersion: action.originalVersion,
              userId: actors[2]!.id,
              userRole: actors[2]!.role as Role,
            },
            tx,
            action.id,
          );
        },
      }),
      /không khớp với nội dung thay đổi chuyến đi đã được phê duyệt/,
    );
    const [afterDivergentAttempt] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, trip.id)).limit(1);
    assert.equal(afterDivergentAttempt.revenue, '1200000');
    assert.equal((await ledgerRows(trip.id)).length, completedLedger.length);
    const [stillCheckedChange] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(change.body.id))).limit(1);
    assert.equal(stillCheckedChange.status, 'PENDING_APPROVAL');
    assert.equal(stillCheckedChange.version, checkedChange.body.version);

    const approvedChange = await api('POST', `/api/governance-actions/${change.body.id}/approve`, {
      expectedVersion: checkedChange.body.version,
    }, 2, `q15-change-approve-${suffix}`);
    assert.equal(approvedChange.status, 200);

    const [changed] = await db.select().from(s.tripsComposite)
      .where(eq(s.tripsComposite.id, trip.id)).limit(1);
    assert.equal(changed.revenue, '1700000');
    const changedLedger = await ledgerRows(trip.id);
    assert.equal(changedLedger.filter((row) => row.txnType === TxnType.TRIP_REVENUE).length, 2);
    assert.ok(changedLedger.some((row) => row.txnType === TxnType.UNLOCK_REVERSAL));

    const cancelKey = `q15-completed-cancel-${suffix}`;
    const cancel = await api('POST', `/api/trips/${trip.id}/cancel`, {
      expectedVersion: changed.version,
      reason: 'Hủy chuyến đã hoàn thành và hoàn nhập công nợ',
    }, 0, cancelKey);
    assert.equal(cancel.status, 202);
    assert.equal(cancel.body.actionKind, 'TRIP_FINANCIAL_CHANGE');
    actionIds.push(Number(cancel.body.id));
    assert.ok(await waitForAuditEvent(
      actors[0]!.id,
      'TRIP_FINANCIAL_CANCEL_REQUESTED',
      trip.id,
    ));
    const cancelReplay = await api('POST', `/api/trips/${trip.id}/cancel`, {
      expectedVersion: changed.version,
      reason: 'Hủy chuyến đã hoàn thành và hoàn nhập công nợ',
    }, 0, cancelKey);
    assert.equal(cancelReplay.status, 202);
    assert.equal(cancelReplay.body.replayed, true);

    const [beforeCancelApproval] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id)).limit(1);
    assert.equal(beforeCancelApproval.status, TripStatus.COMPLETED);
    assert.equal((await ledgerRows(trip.id)).length, changedLedger.length);
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

    const checkedCancel = await api('POST', `/api/governance-actions/${cancel.body.id}/check`, {
      expectedVersion: cancel.body.version,
    }, 1, `q15-completed-cancel-check-${suffix}`);
    assert.equal(checkedCancel.status, 200);
    const cancelApprovalKey = `q15-completed-cancel-approve-${suffix}`;
    const approvedCancel = await api('POST', `/api/governance-actions/${cancel.body.id}/approve`, {
      expectedVersion: checkedCancel.body.version,
    }, 2, cancelApprovalKey);
    assert.equal(approvedCancel.status, 200);

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
    assert.ok(await waitForAuditEvent(actors[2]!.id, 'TRIP_CANCELED', trip.id));
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

    const cancelApprovalReplay = await api(
      'POST',
      `/api/governance-actions/${cancel.body.id}/approve`,
      { expectedVersion: checkedCancel.body.version },
      2,
      cancelApprovalKey,
    );
    assert.equal(cancelApprovalReplay.status, 200);
    assert.equal(cancelApprovalReplay.body.replayed, true);
    assert.equal((await ledgerRows(trip.id)).length, canceledLedger.length);
  });

  it('rejects direct service completion without an approved governance action', async () => {
    const trip = await createInTransitTrip();
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

  it('rejects forged or merely checked action identities at every completed-trip mutation boundary', async () => {
    const trip = await createInTransitTrip();
    const close = await api('POST', `/api/trips/${trip.id}/complete`, {
      expectedVersion: trip.version,
      reason: 'Kiểm thử ranh giới ủy quyền bền vững',
    }, 1, `q15-forged-close-${suffix}`);
    actionIds.push(Number(close.body.id));
    const checkedClose = await api('POST', `/api/governance-actions/${close.body.id}/check`, {
      expectedVersion: close.body.version,
    }, 0, `q15-forged-close-check-${suffix}`);
    assert.equal(checkedClose.status, 200);

    let retainedCallbackArgument: unknown;
    let retainedApprovalTx: Tx | undefined;
    let retainedApprovalActionId: number | undefined;
    await assert.rejects(
      approveGovernanceActionWithAdapter({
        actionId: Number(close.body.id),
        approverId: actors[2]!.id,
        approverRole: actors[2]!.role,
        expectedVersion: Number(checkedClose.body.version),
        authorizeBeforeApply: () => true,
        apply: async (...args: unknown[]) => {
          const approvalTx = args[0] as Tx;
          const approvalAction = args[1] as { id: number };
          retainedApprovalTx = approvalTx;
          retainedApprovalActionId = approvalAction.id;
          retainedCallbackArgument = args[2];
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
      retainedCallbackArgument,
      undefined,
      'the generic adapter callback must never receive retainable approval authority',
    );
    assert.ok(retainedApprovalTx);
    assert.ok(retainedApprovalActionId);
    assert.throws(
      () => assertActiveApprovalApplication(retainedApprovalTx!, retainedApprovalActionId),
      /phê duyệt quản trị/,
      'approval activity must be cleared after the adapter throws and the transaction rolls back',
    );

    const attemptForgedAuthorizedClose = async (overrides: Record<string, unknown>, actor = actors[2]!) => (
      db.transaction(async (tx) => {
        await tx.update(s.governanceActions).set({
          status: 'APPROVED',
          approverId: actors[2]!.id,
          approverRole: actors[2]!.role,
          approvedAt: new Date(),
          appliedAt: null,
          applicationResult: null,
          ...overrides,
        }).where(eq(s.governanceActions.id, Number(close.body.id)));
        return transitionTripStatus(
          trip.id,
          TripStatus.COMPLETED,
          actor.id,
          actor.role,
          false,
          false,
          {
            expectedVersion: trip.version,
            transaction: tx,
            governanceActionId: Number(close.body.id),
          },
        );
      })
    );
    let exactCloseForgeryApplied = false;
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.update(s.governanceActions).set({
          status: 'APPROVED',
          approverId: actors[2]!.id,
          approverRole: actors[2]!.role,
          approvedAt: new Date(),
          appliedAt: null,
          applicationResult: null,
        }).where(eq(s.governanceActions.id, Number(close.body.id)));
        try {
          await transitionTripStatus(
            trip.id,
            TripStatus.COMPLETED,
            actors[2]!.id,
            actors[2]!.role,
            false,
            false,
            {
              expectedVersion: trip.version,
              transaction: tx,
              governanceActionId: Number(close.body.id),
            },
          );
          exactCloseForgeryApplied = true;
        } finally {
          throw new Error('rollback exact forged close probe');
        }
      }),
      /rollback exact forged close probe/,
    );
    assert.equal(
      exactCloseForgeryApplied,
      false,
      'an exact persisted APPROVED row must not authorize close without the approval-engine capability',
    );
    await assert.rejects(
      attemptForgedAuthorizedClose({}, actors[1]!),
      /quản trị/,
    );
    await assert.rejects(
      attemptForgedAuthorizedClose({ approverRole: Role.ADMIN }, {
        id: actors[2]!.id,
        role: Role.MANAGER,
      }),
      /quản trị/,
    );
    const wrongSubject = await createInTransitTrip();
    await assert.rejects(
      attemptForgedAuthorizedClose({ subjectId: wrongSubject.id }),
      /quản trị/,
    );
    await assert.rejects(
      attemptForgedAuthorizedClose({ originalVersion: trip.version + 1 }),
      /quản trị/,
    );
    await assert.rejects(
      attemptForgedAuthorizedClose({ appliedAt: new Date() }),
      /quản trị/,
    );
    await assert.rejects(
      attemptForgedAuthorizedClose({ actionKind: 'TRIP_FINANCIAL_CHANGE' }),
      /quản trị/,
    );

    await assert.rejects(
      transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        actors[2]!.id,
        actors[2]!.role,
        false,
        false,
        { expectedVersion: trip.version, governanceActionId: Number(close.body.id) },
      ),
      /quản trị/,
    );
    await assert.rejects(
      transitionTripStatus(
        trip.id,
        TripStatus.COMPLETED,
        actors[2]!.id,
        actors[2]!.role,
        false,
        false,
        { expectedVersion: trip.version, governanceActionId: 2_000_000_000 },
      ),
      /quản trị/,
    );

    const approvedClose = await api('POST', `/api/governance-actions/${close.body.id}/approve`, {
      expectedVersion: checkedClose.body.version,
    }, 2, `q15-forged-close-approve-${suffix}`);
    assert.equal(approvedClose.status, 200);
    const [completed] = await db.select().from(s.trips)
      .where(eq(s.trips.id, trip.id)).limit(1);

    const edit = await api('PUT', `/api/trips/${trip.id}/actuals`, {
      legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 20, loadingType: LoadingType.HANG }],
      fuelMode: FuelMode.AUTO,
      revenue: 1_800_000,
      version: completed.version,
      governanceReason: 'Kiểm thử yêu cầu sửa chưa được duyệt',
    }, 0, `q15-forged-edit-${suffix}`);
    actionIds.push(Number(edit.body.id));
    const checkedEdit = await api('POST', `/api/governance-actions/${edit.body.id}/check`, {
      expectedVersion: edit.body.version,
    }, 1, `q15-forged-edit-check-${suffix}`);
    assert.equal(checkedEdit.status, 200);
    let exactEditForgeryApplied = false;
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.update(s.governanceActions).set({
          status: 'APPROVED',
          approverId: actors[2]!.id,
          approverRole: actors[2]!.role,
          approvedAt: new Date(),
          appliedAt: null,
          applicationResult: null,
        }).where(eq(s.governanceActions.id, Number(edit.body.id)));
        try {
          await updateTripFigures(
            trip.id,
            {
              legs: [{
                sequence: 1,
                origin: 'A',
                destination: 'B',
                km: 20,
                loadingType: LoadingType.HANG,
              }],
              fuelMode: FuelMode.AUTO,
              revenue: 1_800_000,
              expectedVersion: completed.version,
              userId: actors[2]!.id,
              userRole: actors[2]!.role as Role,
            },
            tx,
            Number(edit.body.id),
          );
          exactEditForgeryApplied = true;
        } finally {
          throw new Error('rollback exact forged edit probe');
        }
      }),
      /rollback exact forged edit probe/,
    );
    assert.equal(
      exactEditForgeryApplied,
      false,
      'an exact persisted APPROVED row must not authorize edit without the approval-engine capability',
    );
    await assert.rejects(
      updateTripFigures(
        trip.id,
        {
          legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 20, loadingType: LoadingType.HANG }],
          fuelMode: FuelMode.AUTO,
          revenue: 1_800_000,
          expectedVersion: completed.version,
          userId: actors[2]!.id,
          userRole: actors[2]!.role as Role,
        },
        undefined,
        Number(edit.body.id),
      ),
      /quản trị/,
    );

    const rejectedEdit = await api('POST', `/api/governance-actions/${edit.body.id}/reject`, {
      expectedVersion: checkedEdit.body.version,
      reason: 'Kết thúc yêu cầu thử nghiệm',
    }, 2, `q15-forged-edit-reject-${suffix}`);
    assert.equal(rejectedEdit.status, 200);
    const cancel = await api('POST', `/api/trips/${trip.id}/cancel`, {
      expectedVersion: completed.version,
      reason: 'Kiểm thử yêu cầu hủy chưa được duyệt',
    }, 0, `q15-forged-cancel-${suffix}`);
    actionIds.push(Number(cancel.body.id));
    const checkedCancel = await api('POST', `/api/governance-actions/${cancel.body.id}/check`, {
      expectedVersion: cancel.body.version,
    }, 1, `q15-forged-cancel-check-${suffix}`);
    assert.equal(checkedCancel.status, 200);
    let exactCancelForgeryApplied = false;
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.update(s.governanceActions).set({
          status: 'APPROVED',
          approverId: actors[2]!.id,
          approverRole: actors[2]!.role,
          approvedAt: new Date(),
          appliedAt: null,
          applicationResult: null,
        }).where(eq(s.governanceActions.id, Number(cancel.body.id)));
        try {
          await transitionTripStatus(
            trip.id,
            TripStatus.CANCELED,
            actors[2]!.id,
            actors[2]!.role,
            false,
            false,
            {
              expectedVersion: completed.version,
              transaction: tx,
              governanceActionId: Number(cancel.body.id),
            },
          );
          exactCancelForgeryApplied = true;
        } finally {
          throw new Error('rollback exact forged cancel probe');
        }
      }),
      /rollback exact forged cancel probe/,
    );
    assert.equal(
      exactCancelForgeryApplied,
      false,
      'an exact persisted APPROVED row must not authorize cancellation without the approval-engine capability',
    );
    await assert.rejects(
      transitionTripStatus(
        trip.id,
        TripStatus.CANCELED,
        actors[2]!.id,
        actors[2]!.role,
        false,
        false,
        { expectedVersion: completed.version, governanceActionId: Number(cancel.body.id) },
      ),
      /quản trị/,
    );
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

  it('routes completed bulk rows into pending governance while applying open rows', async () => {
    const completedSource = await createInTransitTrip();
    const close = await api('POST', `/api/trips/${completedSource.id}/complete`, {
      expectedVersion: completedSource.version,
      reason: 'Hoàn thành để kiểm thử cập nhật hàng loạt',
    }, 1, `q15-bulk-close-${suffix}`);
    actionIds.push(Number(close.body.id));
    const checked = await api('POST', `/api/governance-actions/${close.body.id}/check`, {
      expectedVersion: close.body.version,
    }, 0, `q15-bulk-close-check-${suffix}`);
    await api('POST', `/api/governance-actions/${close.body.id}/approve`, {
      expectedVersion: checked.body.version,
    }, 2, `q15-bulk-close-approve-${suffix}`);
    const [completed] = await db.select().from(s.trips)
      .where(eq(s.trips.id, completedSource.id)).limit(1);
    const open = await createInTransitTrip();

    const bulk = await api('POST', '/api/trips/bulk-figures', {
      updates: [
        {
          tripId: completed.id,
          governanceReason: 'Điều chỉnh hàng loạt theo biên bản đối soát',
          figures: {
            legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 20, loadingType: LoadingType.HANG }],
            fuelMode: FuelMode.AUTO,
            revenue: 2_000_000,
            version: completed.version,
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
      ],
    }, 0, `q15-bulk-${suffix}`);
    assert.equal(bulk.status, 200);
    assert.equal(bulk.body.updated, 1, JSON.stringify(bulk.body));
    assert.equal(bulk.body.pending, 1, JSON.stringify(bulk.body));
    assert.equal(bulk.body.failed, 0);
    const rows = bulk.body.results as Array<Record<string, unknown>>;
    assert.equal(rows.find((row) => row.tripId === completed.id)?.pendingApproval, true);
    const pendingAction = rows.find((row) => row.tripId === completed.id)?.governanceAction as Record<string, unknown>;
    actionIds.push(Number(pendingAction.id));
  });

  it('rejects or stales a close without changing trip or ledger state', async () => {
    const rejectedTrip = await createInTransitTrip();
    const rejected = await api('POST', `/api/trips/${rejectedTrip.id}/complete`, {
      expectedVersion: rejectedTrip.version,
      reason: 'Đề nghị hoàn thành',
    }, 1, `q15-close-reject-${suffix}`);
    actionIds.push(Number(rejected.body.id));
    const rejectedChecked = await api('POST', `/api/governance-actions/${rejected.body.id}/check`, {
      expectedVersion: rejected.body.version,
    }, 0, `q15-rejected-check-${suffix}`);
    const rejection = await api('POST', `/api/governance-actions/${rejected.body.id}/reject`, {
      expectedVersion: rejectedChecked.body.version,
      reason: 'Chưa đủ căn cứ hoàn thành',
    }, 2, `q15-rejected-decision-${suffix}`);
    assert.equal(rejection.status, 200);

    const [unchangedRejected] = await db.select().from(s.trips)
      .where(eq(s.trips.id, rejectedTrip.id)).limit(1);
    assert.equal(unchangedRejected.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(rejectedTrip.id)).length, 0);

    const staleTrip = await createInTransitTrip();
    const stale = await api('POST', `/api/trips/${staleTrip.id}/complete`, {
      expectedVersion: staleTrip.version,
      reason: 'Đề nghị hoàn thành',
    }, 1, `q15-close-stale-${suffix}`);
    actionIds.push(Number(stale.body.id));
    const staleChecked = await api('POST', `/api/governance-actions/${stale.body.id}/check`, {
      expectedVersion: stale.body.version,
    }, 0, `q15-stale-check-${suffix}`);
    await db.update(s.trips).set({ version: staleTrip.version + 1 })
      .where(eq(s.trips.id, staleTrip.id));
    const staleApproval = await api('POST', `/api/governance-actions/${stale.body.id}/approve`, {
      expectedVersion: staleChecked.body.version,
    }, 2, `q15-stale-approve-${suffix}`);
    assert.equal(staleApproval.status, 409);
    const [unchangedStale] = await db.select().from(s.trips)
      .where(eq(s.trips.id, staleTrip.id)).limit(1);
    assert.equal(unchangedStale.status, TripStatus.IN_TRANSIT);
    assert.equal((await ledgerRows(staleTrip.id)).length, 0);
  });
});
