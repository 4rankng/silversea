/**
 * Card 20261008_3 — 'Chưa gán xe' / 'Đã gán xe' chip counts on /dispatch-detail.
 *
 * The chips' counts must equal what clicking each chip shows: the FULL-SET
 * row total of the same union the grid pages (fulfillment branch + điều
 * phối / fulfillment-less branch), with every other filter held.
 *
 * Counting formula pinned here:
 * - Đã gán xe (ASSIGNED): fulfillment rows whose plannedVehiclePlateNumber is
 *   set (OWN plate / carrier-vehicle plate / typed plate). The điều phối
 *   branch contributes 0 — it is inherently unassigned.
 * - Chưa gán xe (UNASSIGNED): fulfillment rows with no planned plate + every
 *   điều phối (fulfillment-less) row.
 * - Counts are full-set (not paged) and ride the grid response itself
 *   (`assignmentStatusCounts`), so they equal the API `total` returned when
 *   each chip's assignmentStatus filter is applied.
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
  dispatch?: { assignedPlate?: string | null };
};
type PlanResponse = { items?: Row[]; total?: number; assignmentStatusCounts?: Counts };

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `cnt3-${tag}-${suffix}-${createdUserIds.length}`,
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
    code: `SITE3-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `Nhà máy 3 ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
    name: `3 container ${code} ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

/** One lot on the union's two branches: `decomposed: false` leaves the
 *  container WITHOUT a fulfillment (điều phối branch); `plate` decides the
 *  fulfillment branch's 'gán xe' side of the split. */
async function mkLot(args: {
  label: string;
  customer: number;
  route: number;
  plate?: string | null;
  decomposed?: boolean;
}) {
  const site = await mkSite(args.customer);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customer,
    routeId: args.route,
    cargoMode: 'FCL',
    shipmentCode: `3-${args.label}-${suffix.slice(-8)}-${createdShipmentIds.length}`,
    bookingRef: `3BOOK-${args.label}-${suffix.slice(-8)}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: new Date('2026-08-20T08:00:00.000Z'),
    tradeDirection: 'EXPORT',
    operationalSiteId: site.id,
    createdBy: adminUserId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  const containerType = await createContainerType(`30G${createdContainerTypeIds.length}`);
  const [pickupPort] = await db.insert(s.ports).values({ name: `3 pickup ${suffix}-${createdShipmentIds.length}` }).returning();
  const [dropoffPort] = await db.insert(s.ports).values({ name: `3 dropoff ${suffix}-${createdShipmentIds.length}` }).returning();
  createdPortIds.push(pickupPort.id, dropoffPort.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `CNT3${String(300000 + shipment.id).slice(-6)}`,
    routeId: args.route,
    pickupPortId: pickupPort.id,
    dropoffPortId: dropoffPort.id,
    cargoWeightKg: '1000',
    customerAppointmentAt: new Date('2026-08-20T08:00:00.000Z'),
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

describe('20261008_3 — assignment chip counts (union semantics, full-set)', () => {
  test('chip counts equal the API row totals per chip, both branches of the union', async () => {
    const customer = await mkCustomer(`3 count union ${suffix}`);
    const route = await mkRoute('3 route union');
    const plated = await mkLot({ label: 'union-plated', customer: customer.id, route: route.id, plate: '51A-01.01' });
    const unplated = await mkLot({ label: 'union-unplated', customer: customer.id, route: route.id });
    const undecomposed = await mkLot({ label: 'union-branch', customer: customer.id, route: route.id, decomposed: false });

    const all = await fetchRows(`?customerId=${customer.id}`);
    assert.equal(all.status, 200, JSON.stringify(all.data));
    // The grid response carries BOTH chips' counts (full-set) …
    const counts = all.data.assignmentStatusCounts;
    assert.ok(counts, 'assignmentStatusCounts present on the grid response');
    assert.deepEqual(counts, { UNASSIGNED: 2, ASSIGNED: 1 },
      'UNASSIGNED = unplated fulfillment + điều phối branch; ASSIGNED = plated fulfillment');
    // … and the split is a partition of the union's total.
    assert.equal(all.data.total, 3);
    assert.equal((counts!.UNASSIGNED + counts!.ASSIGNED), all.data.total);

    // AC1: clicking 'Chưa gán xe' shows exactly the UNASSIGNED count — the
    // same number the API returns as that view's total.
    const un = await fetchRows(`?customerId=${customer.id}&assignmentStatus=UNASSIGNED`);
    assert.equal(un.status, 200);
    assert.equal(un.data.total, counts!.UNASSIGNED, 'Chưa gán xe count = filtered row total when clicked');
    assert.equal((un.data.items ?? []).length, 2, 'full-set rows behind the count');
    // Union semantics: the điều phối (fulfillment-less) row rides UNASSIGNED.
    assert.ok((un.data.items ?? []).some((r) => r.fulfillmentId === null && r.shipmentContainerId === undecomposed.container.id),
      'điều phối branch row counted under Chưa gán xe');
    assert.ok((un.data.items ?? []).some((r) => r.fulfillmentId === unplated.fulfillmentId),
      'unplated fulfillment row counted under Chưa gán xe');

    // AC1: clicking 'Đã gán xe' shows exactly the ASSIGNED count, and the
    // inherently-unassigned branch is not in it.
    const as = await fetchRows(`?customerId=${customer.id}&assignmentStatus=ASSIGNED`);
    assert.equal(as.status, 200);
    assert.equal(as.data.total, counts!.ASSIGNED, 'Đã gán xe count = filtered row total when clicked');
    assert.deepEqual((as.data.items ?? []).map((r) => r.fulfillmentId), [plated.fulfillmentId],
      'only the plated fulfillment under Đã gán xe');
  });

  test('counts stay consistent when another filter narrows the set', async () => {
    const customer = await mkCustomer(`3 count scoped ${suffix}`);
    const route = await mkRoute('3 route scoped');
    await mkLot({ label: 'scoped-plated', customer: customer.id, route: route.id, plate: '51B-02.02' });
    const branch = await mkLot({ label: 'scoped-branch', customer: customer.id, route: route.id, decomposed: false });

    // Another active filter (quick-search q on the branch container number)
    // must move BOTH chips' counts — and stay equal to each chip's total.
    const branchNumber = branch.container.containerNumber;
    assert.ok(branchNumber, 'fixture container number present');
    const scoped = await fetchRows(`?customerId=${customer.id}&q=${encodeURIComponent(branchNumber)}`);
    assert.equal(scoped.status, 200, JSON.stringify(scoped.data));
    const counts = scoped.data.assignmentStatusCounts;
    assert.ok(counts, 'assignmentStatusCounts present under an extra filter');
    assert.deepEqual(counts, { UNASSIGNED: 1, ASSIGNED: 0 }, 'narrowed set: only the branch container row');

    const un = await fetchRows(`?customerId=${customer.id}&q=${encodeURIComponent(branchNumber)}&assignmentStatus=UNASSIGNED`);
    assert.equal(un.data.total, counts!.UNASSIGNED, 'Chưa gán xe count tracks the extra filter');
    const as = await fetchRows(`?customerId=${customer.id}&q=${encodeURIComponent(branchNumber)}&assignmentStatus=ASSIGNED`);
    assert.equal(as.data.total, counts!.ASSIGNED, 'Đã gán xe count tracks the extra filter');
  });

  test('an empty row set shows 0 on both chips, never blank', async () => {
    const res = await fetchRows(`?q=NO-SUCH-LOT-${suffix}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.total, 0);
    assert.deepEqual(res.data.assignmentStatusCounts, { UNASSIGNED: 0, ASSIGNED: 0 },
      '0 counts are real zeroes on the response');
  });
});
