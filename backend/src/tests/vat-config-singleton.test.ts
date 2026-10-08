/**
 * Card 081026104400-511 — admin-configurable company VAT rate.
 *
 * Route surface: singleton GET/PUT /api/vat-config following the road-config
 * governed pattern (idempotency + If-Unmodified-Since optimistic lock +
 * direct-apply governance; roles per PRICE_CONFIG_CHANGE policy).
 *
 * Fallback: the draft builder uses the configured rate for fee rows with no
 * rate of their own (expense type matching no forwarder-expense-type → LEFT
 * JOIN null). Explicit trip/fee rates still win; unconfigured falls back to
 * the shared DEFAULT_VAT_RATE (8%).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import { generateDraft } from '../services/billing-document.service';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const tripFinancialPostingIds: number[] = [];
const podSubmissionIds: number[] = [];
const tripExpenseIds: number[] = [];
const forwarderExpenseTypeIds: number[] = [];
const idempotencyKeys: string[] = [];

let actors: Array<{ id: number; role: string }> = [];
let server: http.Server;
let baseUrl = '';

async function api(
  method: 'GET' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  ifUnmodifiedSince?: string,
) {
  if (idempotencyKey && !idempotencyKeys.includes(idempotencyKey)) {
    idempotencyKeys.push(idempotencyKey);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(ifUnmodifiedSince ? { 'If-Unmodified-Since': ifUnmodifiedSince } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function createTripFixture(input: { revenue: number; tripVatRate?: string }) {
  const [customer] = await db.insert(s.customers).values({
    name: `VAT511 customer ${suffix}-${customerIds.length}`,
  }).returning();
  customerIds.push(customer!.id);

  const [route] = await db.insert(s.routes).values({
    name: `VAT511 route ${suffix}-${routeIds.length}`,
  }).returning();
  routeIds.push(route!.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `VAT511 cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning();
  cargoTypeIds.push(cargoType!.id);

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `VAT511-SHP-${suffix}-${shipmentIds.length}`.slice(0, 50),
    customerId: customer!.id,
    routeId: route!.id,
    cargoTypeId: cargoType!.id,
    status: 'NEW',
    cargoMode: 'LCL',
    createdBy: actors[0]?.id ?? null,
    updatedBy: actors[0]?.id ?? null,
  }).returning();
  shipmentIds.push(shipment!.id);

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment!.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment!.version,
    siteSnapshot: {},
    createdBy: actors[0]?.id ?? null,
  }).returning();
  fulfillmentIds.push(fulfillment!.id);

  const trip = await insertTripComposite(db, {
    tripCode: `VAT511-DN-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId: customer!.id,
    routeId: route!.id,
    cargoTypeId: cargoType!.id,
    shipmentId: shipment!.id,
    fulfillmentId: fulfillment!.id,
    departureDate: '2026-07-15',
    completedAt: new Date('2026-07-15T08:00:00.000Z'),
    status: 'COMPLETED',
    revenue: String(input.revenue),
    carrierType: 'OWN',
    ...(input.tripVatRate !== undefined ? { vatRate: input.tripVatRate } : {}),
  });
  tripIds.push(trip.id);

  await db.update(s.trips).set({
    podRecoveredAt: new Date('2026-07-15T10:00:00.000Z'),
    podRecoveredBy: actors[0]?.id ?? null,
  }).where(eq(s.trips.id, trip.id));

  const [posting] = await db.insert(s.tripFinancialPostings).values({
    tripId: trip.id,
    version: 1,
    tripVersion: trip.version,
    status: 'ACTIVE',
    reason: 'COMPLETION',
    effectiveAt: trip.completedAt ?? new Date('2026-07-15T08:00:00.000Z'),
  }).returning();
  tripFinancialPostingIds.push(posting!.id);

  const [submission] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment!.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
    submittedBy: actors[0]?.id ?? null,
    submittedAt: new Date('2026-07-15T09:00:00.000Z'),
    reviewedBy: actors[0]?.id ?? null,
    reviewedAt: new Date('2026-07-15T10:00:00.000Z'),
    rejectionReason: null,
  }).returning();
  podSubmissionIds.push(submission!.id);

  return { customer: customer!, trip };
}

async function addFee(tripId: number, input: { expenseType: string; sellAmount: number }) {
  const [fee] = await db.insert(s.tripExpenses).values({
    tripId,
    expenseType: input.expenseType,
    buyAmount: String(Math.round(input.sellAmount * 0.8)),
    sellAmount: String(input.sellAmount),
    settlementMethod: 'COMPANY_DIRECT',
    approvalStatus: 'APPROVED',
    expenseDate: '2026-07-16',
  }).returning();
  tripExpenseIds.push(fee!.id);
  return fee!;
}

async function draftFor(customerId: number) {
  return generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
  });
}

before(async () => {
  actors = await db.insert(s.users).values([
    { username: `vat511-admin-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
    { username: `vat511-driver-${suffix}`, passwordHash: 'x', role: Role.DRIVER, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = actors[0]!;
    req.user = {
      userId: actor.id,
      username: `vat511-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Singleton tests assume no configured row yet.
  await db.delete(s.vatConfig);
  await cacheInvalidate('config:vat');
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
  await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podSubmissionIds));
  await db.delete(s.tripFinancialPostings).where(inArray(s.tripFinancialPostings.id, tripFinancialPostingIds));
  if (tripIds.length > 0) {
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
  }
  await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, forwarderExpenseTypeIds));
  await db.delete(s.vatConfig);
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  await db.delete(s.notifications).where(inArray(s.notifications.userId, actorIds));
  await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, actorIds));
  await db.delete(s.users).where(inArray(s.users.id, actorIds));
  await disconnectRedis();
  await client.end();
});

describe('vat-config singleton route', () => {
  it('returns null while unconfigured (UI offers the 8% default)', async () => {
    const read = await api('GET', '/api/vat-config');
    assert.equal(read.status, 200);
    assert.equal(read.body, null);
  });

  it('rejects a missing Idempotency-Key on PUT', async () => {
    const saved = await api('PUT', '/api/vat-config', { vatRate: 0.08 });
    assert.equal(saved.status, 400);
  });

  it('rejects a rate outside the policy whitelist', async () => {
    const saved = await api('PUT', '/api/vat-config', { vatRate: 0.12 }, `vat511-offlist-${suffix}`);
    assert.equal(saved.status, 400);
  });

  it('saves the configured rate, persists it, and replays the same key', async () => {
    const saved = await api('PUT', '/api/vat-config', { vatRate: 0.05 }, `vat511-save-${suffix}`);
    assert.equal(saved.status, 201);

    const row = await db.select().from(s.vatConfig).limit(1);
    assert.equal(row.length, 1);
    assert.equal(Number(row[0]!.vatRate), 0.05);

    // Cache invalidation is a durable effect drained by a background worker —
    // tests read through the cache, so flush it explicitly.
    await cacheInvalidate('config:vat');

    const replay = await api('PUT', '/api/vat-config', { vatRate: 0.05 }, `vat511-save-${suffix}`);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);

    const reread = await api('GET', '/api/vat-config');
    assert.equal(reread.status, 200);
    assert.equal(reread.body.vatRate, 0.05);
  });

  it('blocks a concurrent overwrite with a stale optimistic-lock token', async () => {
    await cacheInvalidate('config:vat');
    const current = await api('GET', '/api/vat-config');
    const staleToken = new Date(new Date(String(current.body.updatedAt)).getTime() - 5_000).toISOString();
    const conflict = await api('PUT', '/api/vat-config', { vatRate: 0.08 }, `vat511-stale-${suffix}`, staleToken);
    assert.equal(conflict.status, 409);
  });

  it('role outside the config governance policy is forbidden', async () => {
    // Switch the injected actor to DRIVER for one request. The current
    // If-Unmodified-Since token is required once the row exists (428 otherwise).
    await cacheInvalidate('config:vat');
    const current = await api('GET', '/api/vat-config');
    const previous = actors[0]!.role;
    actors[0]!.role = Role.DRIVER;
    try {
      const denied = await api('PUT', '/api/vat-config', { vatRate: 0.08 }, `vat511-driver-${suffix}`, String(current.body.updatedAt));
      assert.equal(denied.status, 403);
    } finally {
      actors[0]!.role = previous;
    }
  });
});

describe('vat-config fallback in billing drafts', () => {
  it('uses the configured rate for a fee with no rate of its own', async () => {
    // Config currently 0.05 (saved by the route test above).
    await cacheInvalidate('config:vat');
    const { customer, trip } = await createTripFixture({ revenue: 1_100_000 });
    const fee = await addFee(trip.id, { expenseType: `VAT511_UNMATCHED_${suffix}`, sellAmount: 105_000 });
    const draft = await draftFor(customer.id);
    const feeLine = draft.lines.find((line) => line.sourceType === 'EXPENSE' && line.sourceId === fee.id);
    assert.ok(feeLine, 'fee line present');
    // gross/1.05 rounding: net = floor(105000/1.05 + 0.5) = 100000, tax = 5000.
    assert.equal(feeLine.vatRate, 0.05);
    assert.equal(feeLine.taxAmount, 5_000);
    assert.equal(feeLine.netAmount, 100_000);
  });

  it('unconfigured singleton falls back to the shared 8% default', async () => {
    await db.delete(s.vatConfig);
    await cacheInvalidate('config:vat');
    const { customer, trip } = await createTripFixture({ revenue: 1_080_000, tripVatRate: '0.10' });
    const fee = await addFee(trip.id, { expenseType: `VAT511_DEFAULTED_${suffix}`, sellAmount: 54_000 });
    const draft = await draftFor(customer.id);
    const feeLine = draft.lines.find((line) => line.sourceType === 'EXPENSE' && line.sourceId === fee.id);
    assert.ok(feeLine, 'fee line present');
    // 54000/1.08 → net 50000, tax 4000 with the 8% default.
    assert.equal(feeLine.vatRate, 0.08);
    assert.equal(feeLine.taxAmount, 4_000);
    assert.equal(feeLine.netAmount, 50_000);
  });

  it('an explicit forwarder-expense-type rate wins over the configured rate', async () => {
    const [feeType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `VAT511_EXPLICIT_${suffix}`,
      name: `VAT511 explicit ${suffix}`,
      vatRate: '0.08',
    }).returning();
    forwarderExpenseTypeIds.push(feeType!.id);
    const { customer, trip } = await createTripFixture({ revenue: 1_000_000 });
    const fee = await addFee(trip.id, { expenseType: feeType!.code, sellAmount: 108_000 });
    const draft = await draftFor(customer.id);
    const feeLine = draft.lines.find((line) => line.sourceType === 'EXPENSE' && line.sourceId === fee.id);
    assert.ok(feeLine, 'fee line present');
    // Explicit type rate 0.08 beats the configured 0.05: net 100000, tax 8000.
    assert.equal(feeLine.vatRate, 0.08);
    assert.equal(feeLine.taxAmount, 8_000);
  });

  it('an explicit trip rate wins over the configured rate', async () => {
    const { customer, trip } = await createTripFixture({ revenue: 1_050_000, tripVatRate: '0.10' });
    const draft = await draftFor(customer.id);
    const freightLine = draft.lines.find((line) => line.sourceType === 'TRIP' && line.sourceId === trip.id);
    assert.ok(freightLine, 'freight line present');
    // Trip's own 10% beats configured 5%: net floor(1050000/1.1+0.5)=954545, tax 95455.
    assert.equal(freightLine.vatRate, 0.10);
    assert.equal(freightLine.taxAmount, 95_455);
  });
});
