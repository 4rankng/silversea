import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';
import express from 'express';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';
import {
  buildAccountingTransportFilterFingerprint,
  listAccountingTransportRows,
} from '../services/accounting-transport-register.service';

const customerIds: number[] = [];
const shipmentIds: number[] = [];
const shipmentContainerIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const postingIds: number[] = [];
const snapshotIds: number[] = [];
const podSubmissionIds: number[] = [];
const tripContainerIds: number[] = [];
const ledgerIds: number[] = [];
let routeId = 0;
let cargoTypeId = 0;
let containerTypeId = 0;
let truckId = 0;
let actorId = 0;
let readyTripId = 0;
let missingSnapshotTripId = 0;
let blockedTripId = 0;
let carrierId = 0;
let server: http.Server;
let baseUrl = '';

async function createLockedTrip(input: {
  suffix: string;
  customerId: number;
  completedAt: Date;
  carrierType: 'OWN' | 'EXTERNAL';
  withSnapshot: boolean;
  /** false seeds a REJECTED submission — the trip lists as MISSING_ACCEPTED_POD. */
  acceptedPod?: boolean;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `ATR-SHP-${input.suffix}`.slice(0, 50),
    customerId: input.customerId,
    routeId,
    cargoTypeId,
    cargoMode: 'FCL',
    factoryName: `Nhà máy ${input.suffix}`,
    status: 'DISPATCHED',
  }).returning();
  shipmentIds.push(shipment.id);

  const [shipmentContainer] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId,
    containerNumber: `MSKU${input.suffix.replace(/\D/g, '').padStart(7, '0').slice(-7)}`,
    createdBy: actorId,
  }).returning();
  shipmentContainerIds.push(shipmentContainer.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: shipmentContainer.id,
    sourceShipmentVersion: shipment.version,
    createdBy: actorId,
  }).returning();
  fulfillmentIds.push(fulfillment.id);

  const trip = await insertTripComposite(db, {
    tripCode: `ATR-TRIP-${input.suffix}`.slice(0, 50),
    customerId: input.customerId,
    routeId,
    cargoTypeId,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    sourceShipmentVersion: shipment.version,
    truckId: input.carrierType === 'OWN' ? truckId : null,
    carrierType: input.carrierType,
    externalEntityId: input.carrierType === 'EXTERNAL' ? carrierId : null,
    externalEntityType: input.carrierType === 'EXTERNAL' ? 'CUSTOMER' : null,
    externalPlateNumber: input.carrierType === 'EXTERNAL' ? '15H-123.45' : null,
    externalFreightCost: input.carrierType === 'EXTERNAL' ? '430000' : null,
    status: 'COMPLETED',
    departureDate: '2042-01-18',
    completedAt: input.completedAt,
    revenue: '1000000',
    totalCost: '400000',
    grossProfit: '600000',
  });
  tripIds.push(trip.id);

  const [tripContainer] = await db.insert(s.tripContainers).values({
    tripId: trip.id,
    sourceShipmentId: shipment.id,
    sourceShipmentContainerId: shipmentContainer.id,
    sourceShipmentVersion: shipment.version,
    containerTypeId,
    containerNumber: shipmentContainer.containerNumber,
    createdBy: actorId,
  }).returning();
  tripContainerIds.push(tripContainer.id);

  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: input.carrierType === 'EXTERNAL' ? 3 : 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: input.completedAt,
  }).returning();
  postingIds.push(posting.id);

  const [pod] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: input.acceptedPod === false ? 'REJECTED' : 'ACCEPTED',
    submittedBy: actorId,
    submittedAt: new Date(input.completedAt.getTime() - 60_000),
    reviewedBy: actorId,
    reviewedAt: input.completedAt,
  }).returning();
  podSubmissionIds.push(pod.id);

  if (input.withSnapshot) {
    const [snapshot] = await db.insert(s.profitabilitySnapshots).values({
      financialPostingId: posting.id,
      tripId: trip.id,
      shipmentId: shipment.id,
      completedBusinessDate: '2042-01-20',
      revenue: '925926',
      directCost: '430000',
      sharedOverhead: '0',
      profit: '495926',
      attributionStatus: 'COMPLETE',
    }).returning();
    snapshotIds.push(snapshot.id);
  }

  if (input.carrierType === 'EXTERNAL') {
    const [entry] = await db.insert(s.ledger).values({
      txnType: 'EXTERNAL_CARRIER_COST',
      txnId: trip.id,
      entityType: 'CARRIER',
      entityId: carrierId,
      debit: '0',
      credit: '430000',
      balance: '-430000',
      financialPostingId: posting.id,
    }).returning();
    ledgerIds.push(entry.id);
  }

  return trip;
}

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [actor] = await db.insert(s.users).values({
    username: `atr-${suffix}`.slice(0, 50),
    passwordHash: 'not-used',
    role: 'ACCOUNTANT',
  }).returning();
  actorId = actor.id;

  const [route] = await db.insert(s.routes).values({ name: `ATR route ${suffix}` }).returning();
  routeId = route.id;
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `ATR cargo ${suffix}` }).returning();
  cargoTypeId = cargo.id;
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `AT${Date.now().toString().slice(-6)}`,
    name: `40HC ${suffix}`,
  }).returning();
  containerTypeId = containerType.id;
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `ATR-${Date.now().toString().slice(-7)}`.slice(0, 20),
  }).returning();
  truckId = truck.id;

  const customers = await db.insert(s.customers).values([
    { name: `ATR customer ${suffix}` },
    { name: `ATR carrier ${suffix}`, isCarrier: true },
  ]).returning();
  customerIds.push(...customers.map((customer) => customer.id));
  carrierId = customers[1].id;

  const readyTrip = await createLockedTrip({
    suffix: `${Date.now()}20`,
    customerId: customers[0].id,
    completedAt: new Date('2042-01-20T08:00:00.000Z'),
    carrierType: 'EXTERNAL',
    withSnapshot: true,
  });
  readyTripId = readyTrip.id;
  const missingSnapshotTrip = await createLockedTrip({
    suffix: `${Date.now()}19`,
    customerId: customers[0].id,
    completedAt: new Date('2042-01-19T08:00:00.000Z'),
    carrierType: 'OWN',
    withSnapshot: false,
  });
  missingSnapshotTripId = missingSnapshotTrip.id;
  const blockedTrip = await createLockedTrip({
    suffix: `${Date.now()}18`,
    customerId: customers[0].id,
    completedAt: new Date('2042-01-18T08:00:00.000Z'),
    carrierType: 'OWN',
    withSnapshot: true, // snapshot present — the POD gate is the only blocker
    acceptedPod: false,
  });
  blockedTripId = blockedTrip.id;

  const app = express();
  app.use('/api', (req, _res, next) => {
    req.user = {
      userId: actorId,
      username: 'accounting-transport-test',
      email: null,
      fullName: null,
      role: String(req.header('X-Test-Role') ?? Role.ACCOUNTANT) as Role,
    };
    next();
  });
  app.use('/api', billingDocumentsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    if (podSubmissionIds.length) await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
    if (snapshotIds.length) await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.id, snapshotIds));
    if (postingIds.length) await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, postingIds));
    if (tripContainerIds.length) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, tripContainerIds));
    if (tripIds.length) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    if (tripIds.length) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
    if (shipmentContainerIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, shipmentContainerIds));
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (truckId) await db.delete(s.trucks).where(inArray(s.trucks.id, [truckId]));
    if (containerTypeId) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, [containerTypeId]));
    if (cargoTypeId) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, [cargoTypeId]));
    if (routeId) await db.delete(s.routes).where(inArray(s.routes.id, [routeId]));
    if (actorId) await db.delete(s.users).where(inArray(s.users.id, [actorId]));
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('accounting transport register service', () => {
  test('returns completed trips in deterministic completion/id order with posting provenance', async () => {
    const result = await listAccountingTransportRows({
      from: '2042-01-01',
      to: '2042-01-31',
      page: 1,
      limit: 25,
    });
    // Blocked trips (no accepted e-POD) belong in the reconciliation list —
    // hiding them dead-ended the work-queue's own resolution links.
    assert.deepEqual(result.items.map((item) => item.tripId), [readyTripId, missingSnapshotTripId, blockedTripId]);
    const ready = result.items[0];
    assert.equal(ready.financialPostingVersion, 3);
    assert.notEqual(ready.financialPostingVersion, 1, 'financial provenance must not be copied from trip.version');
    assert.equal(ready.carrierId, carrierId);
    assert.equal(ready.carrierPayable, '430000');
    assert.equal(ready.revenue, '925926');
    assert.equal(ready.directCost, '430000');
    assert.equal(ready.profit, '495926');
    assert.equal(ready.readiness.status, 'READY');
    assert.deepEqual(ready.readiness.evidence, [
      'ACTIVE_FINANCIAL_POSTING',
      'COMPLETED_TRIP',
      'ACCEPTED_EPOD',
      'PROFITABILITY_SNAPSHOT',
    ]);
    assert.equal(result.items[1].readiness.status, 'MISSING_PROFITABILITY_SNAPSHOT');
  });

  test('a POD-blocked trip lists with MISSING_ACCEPTED_POD and null acceptance provenance', async () => {
    const result = await listAccountingTransportRows({
      from: '2042-01-01',
      to: '2042-01-31',
      page: 1,
      limit: 25,
    });
    const blocked = result.items.find((item) => item.tripId === blockedTripId);
    assert.ok(blocked, 'the POD-blocked trip must appear in the register');
    assert.equal(blocked.readiness.status, 'MISSING_ACCEPTED_POD');
    assert.equal(blocked.readiness.acceptedPodSubmissionId, null);
    assert.equal(blocked.readiness.acceptedPodVersion, null);
    assert.equal(blocked.readiness.acceptedPodAt, null);
    assert.deepEqual(blocked.readiness.evidence, [
      'ACTIVE_FINANCIAL_POSTING',
      'COMPLETED_TRIP',
    ]);
  });

  test('the MISSING_ACCEPTED_POD facet selects only blocked trips and counts agree', async () => {
    const facet = await listAccountingTransportRows({
      from: '2042-01-01',
      to: '2042-01-31',
      readiness: 'MISSING_ACCEPTED_POD',
      page: 1,
      limit: 100,
    });
    assert.deepEqual(facet.items.map((item) => item.tripId), [blockedTripId]);
    assert.equal(facet.total, 1);
    // READY keeps excluding the blocked trip.
    const ready = await listAccountingTransportRows({
      from: '2042-01-01',
      to: '2042-01-31',
      readiness: 'READY',
      page: 1,
      limit: 100,
    });
    assert.equal(ready.items.some((item) => item.tripId === blockedTripId), false);
  });

  test('supports readiness, carrier, ownership, and search filters without changing money', async () => {
    const ready = await listAccountingTransportRows({
      from: '2042-01-01', to: '2042-01-31', readiness: 'READY',
      carrierId, ownership: 'EXTERNAL', search: 'ATR-TRIP', page: 1, limit: 100,
    });
    assert.deepEqual(ready.items.map((item) => item.tripId), [readyTripId]);
    const missing = await listAccountingTransportRows({
      from: '2042-01-01', to: '2042-01-31', readiness: 'MISSING_PROFITABILITY_SNAPSHOT',
      page: 1, limit: 100,
    });
    assert.deepEqual(missing.items.map((item) => item.tripId), [missingSnapshotTripId]);
    assert.equal(missing.items[0].revenue, null);
    assert.equal(missing.items[0].carrierPayable, '0');
  });

  test('fingerprint is independent of pagination but changes with financial filters', () => {
    const base = { from: '2042-01-01', to: '2042-01-31', page: 1, limit: 25 } as const;
    const sameFilterNextPage = { ...base, page: 2, limit: 100 };
    const narrowed = { ...base, readiness: 'READY' as const };
    assert.equal(
      buildAccountingTransportFilterFingerprint(base),
      buildAccountingTransportFilterFingerprint(sameFilterNextPage),
    );
    assert.notEqual(
      buildAccountingTransportFilterFingerprint(base),
      buildAccountingTransportFilterFingerprint(narrowed),
    );
  });

  test('route admits only ADMIN, MANAGER, and ACCOUNTANT and validates query strictly', async () => {
    const path = '/api/finance/billing-documents/transport-register?from=2042-01-01&to=2042-01-31&limit=1';
    for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { 'X-Test-Role': role } });
      assert.equal(response.status, 200, `${role} must have read access`);
    }
    const denied = await fetch(`${baseUrl}${path}`, { headers: { 'X-Test-Role': Role.DRIVER } });
    assert.equal(denied.status, 403);

    const hostile = await fetch(`${baseUrl}${path}&amount=999999999`, {
      headers: { 'X-Test-Role': Role.ACCOUNTANT },
    });
    assert.equal(hostile.status, 400);

    const badSort = await fetch(`${baseUrl}${path}&sortBy=revenue;drop`, {
      headers: { 'X-Test-Role': Role.ACCOUNTANT },
    });
    assert.equal(badSort.status, 400, 'sort keys outside the whitelist must 400');
  });

  test('explicit sorts order rows server-side with NULLs last; absent params keep the default order', async () => {
    const base = { from: '2042-01-01', to: '2042-01-31', page: 1, limit: 25 } as const;

    // Default order stays completionDate desc (no sort params) — the ready trip
    // completed Jan 20, the missing-snapshot trip Jan 19, the POD-blocked trip Jan 18.
    const unsorted = await listAccountingTransportRows(base);
    assert.deepEqual(unsorted.items.map((item) => item.tripId), [readyTripId, missingSnapshotTripId, blockedTripId]);

    // Revenue: READY and POD-blocked rows carry snapshot values (the blocked
    // fixture has a snapshot — POD is its only blocker); the missing-snapshot
    // row has none, so NULLs land last in BOTH directions.
    const revenueAsc = await listAccountingTransportRows({ ...base, sortBy: 'revenue', sortDir: 'asc' });
    assert.deepEqual(revenueAsc.items.map((item) => item.tripId), [readyTripId, blockedTripId, missingSnapshotTripId]);
    const revenueDesc = await listAccountingTransportRows({ ...base, sortBy: 'revenue', sortDir: 'desc' });
    assert.deepEqual(revenueDesc.items.map((item) => item.tripId), [readyTripId, blockedTripId, missingSnapshotTripId]);

    // Readiness ranks via case-rank (READY = 0, MISSING_SNAPSHOT = 1, MISSING_POD = 2).
    const readinessAsc = await listAccountingTransportRows({ ...base, sortBy: 'readiness', sortDir: 'asc' });
    assert.deepEqual(readinessAsc.items.map((item) => item.tripId), [readyTripId, missingSnapshotTripId, blockedTripId]);
    const readinessDesc = await listAccountingTransportRows({ ...base, sortBy: 'readiness', sortDir: 'desc' });
    assert.deepEqual(readinessDesc.items.map((item) => item.tripId), [blockedTripId, missingSnapshotTripId, readyTripId]);

    // tripCode asc/desc are exact mirrors of each other.
    const codeAsc = await listAccountingTransportRows({ ...base, sortBy: 'tripCode', sortDir: 'asc' });
    const codeDesc = await listAccountingTransportRows({ ...base, sortBy: 'tripCode', sortDir: 'desc' });
    const ascIds = codeAsc.items.map((item) => item.tripId);
    assert.deepEqual(codeDesc.items.map((item) => item.tripId), [...ascIds].reverse());
  });
});
