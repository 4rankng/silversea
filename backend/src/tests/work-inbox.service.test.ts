import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { adminHealth, customerWorkInbox, financialWorkInbox, managerDecisionInbox, operationsWorkInbox, pageWorkInboxItems } from '../services/work-inbox.service';
import { type ManagerWorkInboxItem, type WorkInboxItemBase } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const tripIds: number[] = [];
const podIds: number[] = [];
const snapshotIds: number[] = [];
const eventIds: number[] = [];
const attemptIds: number[] = [];
const responseIds: number[] = [];

let readyTripId = 0;
let readyTripCode = '';
let preTripShipmentId = 0;
let inboxCustomerId = 0;
const operationsUserId = 990_000_001;

function item(overrides: Partial<WorkInboxItemBase> & Pick<WorkInboxItemBase, 'id' | 'title'>): WorkInboxItemBase {
  return {
    entityType: 'trip',
    entityId: overrides.id,
    subtitle: null,
    state: 'ACTION',
    priority: 1,
    dueAt: null,
    freshnessAt: '2026-08-22T00:00:00.000Z',
    blockers: [],
    advisories: [],
    nextAction: null,
    targetRoute: '/accounting',
    ...overrides,
  };
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Inbox customer ${suffix}` }).returning();
  inboxCustomerId = customer.id;
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Inbox route ${suffix}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `INBOX-${suffix}`.slice(0, 50),
    status: 'COMPLETED',
    cargoMode: 'LCL',
  }).returning();
  shipmentIds.push(shipment.id);
  const [preTripShipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `PRETRIP-${suffix}`.slice(0, 50),
    status: 'READY_FOR_DISPATCH',
    cargoMode: 'LCL',
    expectedDeliveryDate: '2026-08-23',
  }).returning();
  preTripShipmentId = preTripShipment.id;
  shipmentIds.push(preTripShipment.id);
  await db.insert(s.userShipmentLinks).values({ userId: operationsUserId, shipmentId: preTripShipment.id });
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  readyTripCode = `READY-${suffix}`.slice(0, 50);
  const trip = await insertTripComposite(db, {
    tripCode: readyTripCode,
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    status: 'COMPLETED',
    departureDate: '2026-08-22',
    podRecoveredAt: new Date('2026-08-22T08:00:00.000Z'),
    arSnapshotDirty: false,
  });
  readyTripId = trip.id;
  tripIds.push(trip.id);
  const [pod] = await db.insert(s.tripPodSubmissions).values({
    tripId: trip.id,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: trip.version,
    status: 'ACCEPTED',
  }).returning();
  podIds.push(pod.id);
  const [snapshot] = await db.insert(s.profitabilitySnapshots).values({
    financialPostingId: 900_000_000 + trip.id,
    tripId: trip.id,
    shipmentId: shipment.id,
    completedBusinessDate: '2026-08-22',
    revenue: '100',
    directCost: '80',
    profit: '20',
    attributionStatus: 'ATTRIBUTED',
  }).returning();
  snapshotIds.push(snapshot.id);
  const [event] = await db.insert(s.customerVisibleEvents).values({
    shipmentId: shipment.id,
    customerId: customer.id,
    eventKey: `work-inbox-delivery-${suffix}`,
    contentVersion: 1,
    eventType: 'MILESTONE',
    classification: 'CUSTOMER_VISIBLE',
    contentSnapshot: { title: 'Tài xế báo đã giao hàng', message: 'Chờ phản hồi', occurredAt: '2026-08-22T08:00:00.000Z' },
    createdBy: customer.id,
    occurredAt: new Date('2026-08-22T08:00:00.000Z'),
  }).returning();
  eventIds.push(event.id);
  const [attempt] = await db.insert(s.deliveryAttempts).values({
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    tripId: trip.id,
    driverProgressEventId: 910_000_000 + trip.id,
    customerVisibleEventId: event.id,
    result: 'DELIVERED',
    occurredAt: event.occurredAt,
    recordedBy: customer.id,
  }).returning();
  attemptIds.push(attempt.id);
  const [response] = await db.insert(s.customerDeliveryResponses).values({
    deliveryAttemptId: attempt.id,
    customerVisibleEventId: event.id,
    eventVersion: 1,
    customerId: customer.id,
    decision: 'DISPUTED',
    reason: 'Sai thời gian giao',
    respondedBy: customer.id,
    idempotencyKey: `work-inbox-dispute-${suffix}`,
  }).returning();
  responseIds.push(response.id);
});

describe('work inbox projection', () => {
  test('sorts priority, due date and stable id before filtering and paging', () => {
    const result = pageWorkInboxItems([
      item({ id: 'b', title: 'Beta', priority: 50, dueAt: '2026-08-24T00:00:00.000Z' }),
      item({ id: 'c', title: 'Gamma', priority: 100, dueAt: null }),
      item({ id: 'a', title: 'Alpha', priority: 50, dueAt: '2026-08-23T00:00:00.000Z' }),
    ], { view: 'ACTION', search: 'a', page: 1, limit: 2 });
    assert.deepEqual(result.items.map((row) => row.id), ['c', 'a']);
    assert.equal(result.total, 3);
    assert.equal(result.totalPages, 2);
    assert.deepEqual(result.counts, { action: 3, waiting: 0, done: 0 });
  });

  test('explicit sortBy orders the lane before paging with the default chain as tiebreaker', () => {
    const rows = [
      item({ id: 'c', title: 'Gamma', priority: 90, freshnessAt: '2026-08-21T00:00:00.000Z', blockers: [{ code: 'POD', label: 'Thiếu POD', ownerRole: 'OPS', ownerLabel: 'Vận hành' }] }),
      item({ id: 'a', title: 'Alpha', priority: 50, freshnessAt: '2026-08-23T00:00:00.000Z' }),
      item({ id: 'b', title: 'Beta', priority: 70, freshnessAt: '2026-08-22T00:00:00.000Z', blockers: [{ code: 'POD', label: 'Thiếu POD', ownerRole: 'OPS', ownerLabel: 'Vận hành' }, { code: 'SETTLEMENT', label: 'Chưa quyết toán', ownerRole: 'OPS', ownerLabel: 'Vận hành' }] }),
    ];

    // title asc/desc
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'title', sortDir: 'asc' }).items.map((row) => row.id),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'title', sortDir: 'desc' }).items.map((row) => row.id),
      ['c', 'b', 'a'],
    );

    // freshness (newest last on asc, first on desc)
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'freshness', sortDir: 'asc' }).items.map((row) => row.id),
      ['c', 'b', 'a'],
    );
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'freshness', sortDir: 'desc' }).items.map((row) => row.id),
      ['a', 'b', 'c'],
    );

    // readiness = blocker count (a=0, c=1, b=2; fewest blockers first on asc)
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'readiness', sortDir: 'asc' }).items.map((row) => row.id),
      ['a', 'c', 'b'],
    );
    assert.deepEqual(
      pageWorkInboxItems(rows, { view: 'ACTION', page: 1, limit: 10, sortBy: 'readiness', sortDir: 'desc' }).items.map((row) => row.id),
      ['b', 'c', 'a'],
    );

    // The explicit sort follows the sliced page: page 2 under title asc.
    const paged = pageWorkInboxItems(rows, { view: 'ACTION', page: 2, limit: 2, sortBy: 'title', sortDir: 'asc' });
    assert.deepEqual(paged.items.map((row) => row.id), ['c']);
  });

  test('manager-lane keys sort by owner label, age, and impact with absent values last', () => {
    const managerRows: ManagerWorkInboxItem[] = [
      {
        ...item({ id: 'm3', title: 'Quá hạn bàn giao', priority: 96 }),
        owner: { code: 'OPS', label: 'Bàn giao lệnh gốc', ownerRole: 'OPS', ownerLabel: 'Vận hành' },
        ageHours: 30,
        impact: 'Tài xế có thể không đủ chứng từ.',
      },
      {
        ...item({ id: 'm1', title: 'Tranh chấp giao hàng', priority: 100 }),
        owner: { code: 'MANAGER', label: 'Cần quyết định', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' },
        ageHours: 10,
        impact: 'Ảnh hưởng quan hệ khách hàng.',
      },
      {
        ...item({ id: 'm2', title: 'Quá hạn cut-off', priority: 94 }),
        owner: { code: 'DISPATCHER', label: 'Xử lý ngoại lệ SLA', ownerRole: 'DISPATCHER', ownerLabel: 'Điều vận' },
        ageHours: 20,
        impact: 'Nguy cơ lưu bãi.',
      },
    ];
    // A non-manager item mixed into the same sort: no owner/age/impact fields.
    const plain = item({ id: 'plain', title: 'Plain lane row', priority: 1 });

    // ageHours asc: 10 < 20 < 30, then the field-less row last (both dirs).
    assert.deepEqual(
      pageWorkInboxItems([...managerRows, plain], { view: 'ACTION', page: 1, limit: 10, sortBy: 'ageHours', sortDir: 'asc' }).items.map((row) => row.id),
      ['m1', 'm2', 'm3', 'plain'],
    );
    assert.deepEqual(
      pageWorkInboxItems([...managerRows, plain], { view: 'ACTION', page: 1, limit: 10, sortBy: 'ageHours', sortDir: 'desc' }).items.map((row) => row.id),
      ['m3', 'm2', 'm1', 'plain'],
    );

    // ownerLabel asc by code unit: 'Quản lý' (Q=81) < 'Vận hành' (V=86) <
    // 'Điều vận' (Đ=U+0110), field-less row last.
    assert.deepEqual(
      pageWorkInboxItems([...managerRows, plain], { view: 'ACTION', page: 1, limit: 10, sortBy: 'ownerLabel', sortDir: 'asc' }).items.map((row) => row.id),
      ['m1', 'm3', 'm2', 'plain'],
    );

    // impact asc/desc are exact mirrors with the field-less row last.
    const impactAsc = pageWorkInboxItems([...managerRows, plain], { view: 'ACTION', page: 1, limit: 10, sortBy: 'impact', sortDir: 'asc' }).items.map((row) => row.id);
    assert.deepEqual(impactAsc.slice(3), ['plain']);
    assert.deepEqual(
      pageWorkInboxItems([...managerRows, plain], { view: 'ACTION', page: 1, limit: 10, sortBy: 'impact', sortDir: 'desc' }).items.map((row) => row.id),
      [...impactAsc.slice(0, 3).reverse(), 'plain'],
    );
  });

  test('customer dispute stays advisory and does not block financially ready work', async () => {
    const result = await financialWorkInbox({ search: readyTripCode, page: 1, limit: 25 });
    const row = result.items.find((candidate) => candidate.tripId === readyTripId);
    assert.ok(row);
    assert.equal(row.state, 'ACTION');
    assert.deepEqual(row.blockers, []);
    assert.equal(row.advisories[0]?.code, 'CUSTOMER_DISPUTE');
    assert.match(row.advisories[0]?.label ?? '', /không chặn tài chính/i);
  });

  test('Operations inbox retains pre-trip exchange work with versioned direct action authority', async () => {
    const result = await operationsWorkInbox(operationsUserId, { view: 'ACTION', page: 1, limit: 100 });
    const row = result.items.find((candidate) => candidate.shipmentId === preTripShipmentId);
    assert.ok(row);
    assert.equal(row.tripId, null);
    assert.equal(row.entityType, 'shipment_order_exchange');
    assert.equal(row.orderExchangeState, 'PENDING');
    assert.equal(row.nextAction?.label, 'Bắt đầu đổi lệnh');
    assert.equal(row.shipmentVersion, 1);
  });

  test('Customer delivery truth follows the latest POD submission instead of any historical acceptance', async () => {
    const [rejected] = await db.insert(s.tripPodSubmissions).values({
      tripId: readyTripId,
      fulfillmentId: fulfillmentIds[0],
      submissionVersion: 2,
      sourceTripVersion: 1,
      status: 'REJECTED',
      rejectionReason: 'Ảnh không rõ',
    }).returning();
    podIds.push(rejected.id);
    const result = await customerWorkInbox(inboxCustomerId, { page: 1, limit: 100 });
    const row = result.items.find((candidate) => candidate.shipmentId === shipmentIds[0]);
    assert.ok(row);
    assert.equal(row.deliveryTruth, 'DRIVER_REPORTED');
    await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, [rejected.id]));
    podIds.splice(podIds.indexOf(rejected.id), 1);
  });

  test('Manager decision items identify the owner, age, impact, and direct route', async () => {
    const result = await managerDecisionInbox(900_000_000, { page: 1, limit: 100 });
    const row = result.items.find((candidate) => candidate.entityId === responseIds[0]);
    assert.ok(row);
    assert.equal(row.owner?.ownerRole, 'MANAGER');
    assert.ok(row.ageHours >= 0);
    assert.match(row.impact, /không chặn đóng tài chính/i);
    assert.equal(row.targetRoute, `/dashboard?disputeId=${responseIds[0]}`);
  });

  test('Admin health reports each real source and does not call an empty audit source unavailable', async () => {
    const first = await adminHealth({ page: 1, limit: 100 });
    const pages = await Promise.all(Array.from(
      { length: Math.max(0, first.totalPages - 1) },
      (_, index) => adminHealth({ page: index + 2, limit: 100 }),
    ));
    const items = [first, ...pages].flatMap((result) => result.items);
    const sources = new Set(items.map((candidate) => candidate.source));
    for (const source of ['database', 'setup', 'users_permissions', 'configuration', 'audit', 'durable_effect_jobs', 'customer_email_logs']) {
      assert.ok(sources.has(source), source);
    }
    assert.equal(items.filter((candidate) => candidate.source === 'durable_effect_jobs').length, 1);
    assert.equal(items.filter((candidate) => candidate.source === 'customer_email_logs').length, 1);
    const audit = items.find((candidate) => candidate.source === 'audit');
    assert.equal(audit?.healthState, 'HEALTHY');
  });
});

after(async () => {
  if (responseIds.length) await db.delete(s.customerDeliveryResponses).where(inArray(s.customerDeliveryResponses.id, responseIds));
  if (attemptIds.length) await db.delete(s.deliveryAttempts).where(inArray(s.deliveryAttempts.id, attemptIds));
  if (eventIds.length) await db.delete(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.id, eventIds));
  if (snapshotIds.length) await db.delete(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.id, snapshotIds));
  if (podIds.length) await db.delete(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.id, podIds));
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  if (shipmentIds.length) await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.shipmentId, shipmentIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  try { await client.end(); } catch { /* ignore */ }
});
