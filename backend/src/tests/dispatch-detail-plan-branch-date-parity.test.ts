/**
 * Card 20261008_7 — branch date parity: the topbar period (dateFrom/dateTo)
 * must filter BOTH branches of the detail-plan union — the fulfillment branch
 * AND the điều phối (fulfillment-less) branch — with rows and
 * assignmentStatusCounts staying consistent (same builder for both).
 *
 * Date-column semantics pinned here (documented in the card):
 * - BOTH branches filter on the SAME expression —
 *   coalesce(date(shipment_containers.customer_appointment_at AT TIME ZONE
 *   'Asia/Ho_Chi_Minh'), shipments.expected_delivery_date): the container's
 *   customer appointment date in the business timezone, falling back to the
 *   lot's expected delivery date when no appointment exists.
 * - The range is inclusive at both edges (>= dateFrom, <= dateTo).
 * - When an appointment exists it WINS over expected_delivery_date — a row
 *   whose appointment is out of period stays out even if the lot fallback
 *   date is inside.
 *
 * Consistency property: the chip counts ride the same
 * buildFulfillmentLessConditions / filter builders as the rows, so
 * assignmentStatusCounts must equal each chip's filtered total AND partition
 * the union total — under the period filter too.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPortIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdSiteIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let dispatcherToken = '';

type Counts = { UNASSIGNED: number; ASSIGNED: number };
type Row = {
  fulfillmentId: number | null;
  shipmentContainerId: number | null;
};
type PlanResponse = { items?: Row[]; total?: number; assignmentStatusCounts?: Counts };

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `p7-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: null,
    customerIds: [] as number[],
  }, config.jwtSecret);
}

async function fetchRows(query: string) {
  const response = await fetch(`${baseUrl}/api/shipments/dispatch-detail-plan-rows${query}`, {
    headers: { Authorization: `Bearer ${dispatcherToken}` },
  });
  const data = await response.json().catch(() => ({})) as PlanResponse;
  return { status: response.status, data };
}

async function mkCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({
    name,
    isCarrier: true,
    status: 'ACTIVE',
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute(label: string) {
  const [route] = await db.insert(s.routes).values({ name: `${label} ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkSite(customerId: number) {
  const [site] = await db.insert(s.operationalSites).values({
    customerId,
    code: `SITE7-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `Nhà máy 7 ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
    name: `7 container ${code} ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

/** One lot on either branch of the union. `appointment` is the row's
 *  transport-date column (Asia/Ho_Chi_Minh calendar date of the container's
 *  customer appointment); null omits the appointment so the date falls back
 *  to `expectedDeliveryDate`. `decomposed: false` leaves the container
 *  WITHOUT a fulfillment (điều phối branch); `plate` splits the fulfillment
 *  branch's chips. */
async function mkLot(args: {
  label: string;
  customer: number;
  route: number;
  appointment: Date | null;
  expectedDeliveryDate?: string | null;
  plate?: string | null;
  decomposed?: boolean;
}) {
  const site = await mkSite(args.customer);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customer,
    routeId: args.route,
    cargoMode: 'FCL',
    shipmentCode: `7-${args.label}-${suffix.slice(-8)}-${createdShipmentIds.length}`,
    bookingRef: `7BOOK-${args.label}-${suffix.slice(-8)}`,
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: args.expectedDeliveryDate ?? '2026-08-10',
    closingAt: new Date('2026-08-20T08:00:00.000Z'),
    tradeDirection: 'EXPORT',
    operationalSiteId: site.id,
    createdBy: adminUserId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const containerType = await createContainerType(`70G${createdContainerTypeIds.length}`);
  const [pickupPort] = await db.insert(s.ports).values({ name: `7 pickup ${suffix}-${createdShipmentIds.length}` }).returning();
  const [dropoffPort] = await db.insert(s.ports).values({ name: `7 dropoff ${suffix}-${createdShipmentIds.length}` }).returning();
  createdPortIds.push(pickupPort.id, dropoffPort.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `CNT7${String(700000 + shipment.id).slice(-6)}`,
    routeId: args.route,
    pickupPortId: pickupPort.id,
    dropoffPortId: dropoffPort.id,
    cargoWeightKg: '1000',
    customerAppointmentAt: args.appointment,
    createdBy: adminUserId,
  }).returning();
  let fulfillmentId: number | null = null;
  if (args.decomposed !== false) {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId: container.id,
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      plannedCarrierType: args.plate ? 'OWN' : null,
      plannedVehiclePlateNumber: args.plate ?? null,
      createdBy: adminUserId,
    }).returning();
    fulfillmentId = fulfillment.id;
  }
  return { shipment, container, fulfillmentId };
}

/** 11:00 Asia/Ho_Chi_Minh on the given calendar date — unambiguously that
 *  VN business date for the date(AT TIME ZONE 'Asia/Ho_Chi_Minh') filter. */
function vnDay(date: string): Date {
  return new Date(`${date}T04:00:00.000Z`);
}

before(async () => {
  await initAuditService();
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  const admin = await mkUser(Role.ADMIN, 'admin');
  const dispatcher = await mkUser(Role.DISPATCHER, 'dv');
  adminUserId = admin.id;
  dispatcherToken = signToken(dispatcher);
});

after(async () => {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  try {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdSiteIds.length > 0) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, createdSiteIds));
    if (createdContainerTypeIds.length > 0) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    if (createdPortIds.length > 0) await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await client.end();
  }
});

describe('20261008_7 — dateFrom/dateTo parity across both union branches', () => {
  test('the period moves BOTH branches together — rows and chip counts stay consistent', async () => {
    const customer = await mkCustomer(`7 parity ${suffix}`);
    const route = await mkRoute('7 route parity');
    // Fulfillment branch: one plated row per side of the period split.
    const augPlated = await mkLot({ label: 'aug-plated', customer: customer.id, route: route.id, appointment: vnDay('2026-08-15'), plate: '51A-77.77' });
    const julPlated = await mkLot({ label: 'jul-plated', customer: customer.id, route: route.id, appointment: vnDay('2026-07-15'), plate: '51B-88.88' });
    // Điều phối (fulfillment-less) branch: one row per side too.
    const augBranch = await mkLot({ label: 'aug-branch', customer: customer.id, route: route.id, appointment: vnDay('2026-08-15'), decomposed: false });
    const julBranch = await mkLot({ label: 'jul-branch', customer: customer.id, route: route.id, appointment: vnDay('2026-07-20'), decomposed: false });

    // August window: BOTH branches must shrink to their August rows.
    const aug = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-01&dateTo=2026-08-31`);
    assert.equal(aug.status, 200, JSON.stringify(aug.data));
    assert.deepEqual(
      (aug.data.items ?? []).map((r) => (r.fulfillmentId == null ? `b${r.shipmentContainerId}` : `f${r.fulfillmentId}`)).sort(),
      [`b${augBranch.container.id}`, `f${augPlated.fulfillmentId}`].sort(),
      'August rows = August fulfillment row + August điều phối row (both branches respect the range)',
    );
    assert.equal(aug.data.total, 2);
    assert.deepEqual(aug.data.assignmentStatusCounts, { UNASSIGNED: 1, ASSIGNED: 1 },
      'chip counts respect the range: điều phối row under Chưa gán xe, plated row under Đã gán xe');

    // Per-chip totals under the same range equal the chip counts (rows and
    // counts come from the same builders — the property this card preserves).
    const augUn = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-01&dateTo=2026-08-31&assignmentStatus=UNASSIGNED`);
    assert.equal(augUn.data.total, 1);
    assert.deepEqual((augUn.data.items ?? []).map((r) => r.shipmentContainerId), [augBranch.container.id],
      'Chưa gán xe in-period = only the August điều phối row; the July branch row must not leak');
    const augAs = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-01&dateTo=2026-08-31&assignmentStatus=ASSIGNED`);
    assert.equal(augAs.data.total, 1);
    assert.deepEqual((augAs.data.items ?? []).map((r) => r.fulfillmentId), [augPlated.fulfillmentId],
      'Đã gán xe in-period = only the August plated row; the July plated row must not leak');
    assert.equal((aug.data.assignmentStatusCounts!.UNASSIGNED + aug.data.assignmentStatusCounts!.ASSIGNED), aug.data.total,
      'chip counts partition the ranged total');

    // July window: the complementary set — changing the period re-filters
    // BOTH branches, rows and counts together.
    const jul = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-07-01&dateTo=2026-07-31`);
    assert.equal(jul.status, 200, JSON.stringify(jul.data));
    assert.deepEqual(
      (jul.data.items ?? []).map((r) => (r.fulfillmentId == null ? `b${r.shipmentContainerId}` : `f${r.fulfillmentId}`)).sort(),
      [`b${julBranch.container.id}`, `f${julPlated.fulfillmentId}`].sort(),
      'July rows = July fulfillment row + July điều phối row',
    );
    assert.deepEqual(jul.data.assignmentStatusCounts, { UNASSIGNED: 1, ASSIGNED: 1 });
    assert.equal((jul.data.assignmentStatusCounts!.UNASSIGNED + jul.data.assignmentStatusCounts!.ASSIGNED), jul.data.total);

    // Empty period ⇒ empty union, real zeroes on both chips.
    const none = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-09-01&dateTo=2026-09-30`);
    assert.equal(none.status, 200, JSON.stringify(none.data));
    assert.equal(none.data.total, 0);
    assert.deepEqual(none.data.assignmentStatusCounts, { UNASSIGNED: 0, ASSIGNED: 0 });
  });

  test('range is inclusive at both edges and each branch filters on its documented date column', async () => {
    const customer = await mkCustomer(`7 edges ${suffix}`);
    const route = await mkRoute('7 route edges');
    // Boundary rows AT each edge — both branches exercise an edge.
    const edgeStart = await mkLot({ label: 'edge-start', customer: customer.id, route: route.id, appointment: vnDay('2026-08-01') });
    const edgeEnd = await mkLot({ label: 'edge-end', customer: customer.id, route: route.id, appointment: vnDay('2026-08-31'), decomposed: false });
    // Just OUTSIDE each edge — must be excluded (inclusive, not overshooting).
    const before = await mkLot({ label: 'before', customer: customer.id, route: route.id, appointment: vnDay('2026-07-31'), decomposed: false });
    const after = await mkLot({ label: 'after', customer: customer.id, route: route.id, appointment: vnDay('2026-09-01') });
    // No appointment ⇒ the documented fallback column (lot expected delivery
    // date) carries the row's date — inside the window here.
    const fallback = await mkLot({ label: 'fallback', customer: customer.id, route: route.id, appointment: null, expectedDeliveryDate: '2026-08-15', decomposed: false });
    // Appointment present ⇒ it WINS over the fallback column: out of window
    // by appointment even though expectedDeliveryDate is inside.
    const appointmentWins = await mkLot({ label: 'appt-wins', customer: customer.id, route: route.id, appointment: vnDay('2026-07-15'), expectedDeliveryDate: '2026-08-10', decomposed: false });

    const res = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-01&dateTo=2026-08-31`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(
      (res.data.items ?? []).map((r) => (r.fulfillmentId == null ? `b${r.shipmentContainerId}` : `f${r.fulfillmentId}`)).sort(),
      [`f${edgeStart.fulfillmentId}`, `b${edgeEnd.container.id}`, `b${fallback.container.id}`].sort(),
      'in-period = fulfillment row dated exactly dateFrom + điều phối row dated exactly dateTo + the fallback-date row',
    );
    const ids = new Set((res.data.items ?? []).map((r) => r.shipmentContainerId));
    assert.ok(!ids.has(before.container.id), 'row dated one day before dateFrom is out');
    assert.ok(!ids.has(after.container.id), 'row dated one day after dateTo is out');
    assert.ok(!ids.has(appointmentWins.container.id),
      'documented column: the appointment date wins over expected_delivery_date');
    // All three rows are chip-UNASSIGNED; counts follow the ranged rows.
    assert.equal(res.data.total, 3);
    assert.deepEqual(res.data.assignmentStatusCounts, { UNASSIGNED: 3, ASSIGNED: 0 });
    const un = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-01&dateTo=2026-08-31&assignmentStatus=UNASSIGNED`);
    assert.equal(un.data.total, res.data.assignmentStatusCounts!.UNASSIGNED,
      'Chưa gán xe count = its ranged row total (same builder)');

    // A single-day range at the dateTo edge returns exactly the edge row —
    // the boundary is a real date boundary, not an exclusive cutoff.
    const single = await fetchRows(`?customerId=${customer.id}&dateFrom=2026-08-31&dateTo=2026-08-31`);
    assert.equal(single.status, 200, JSON.stringify(single.data));
    assert.deepEqual((single.data.items ?? []).map((r) => r.shipmentContainerId), [edgeEnd.container.id],
      'a one-day window on the last edge date keeps exactly that boundary row');
  });
});
