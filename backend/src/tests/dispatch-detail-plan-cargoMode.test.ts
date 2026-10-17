/**
 * Card 171026154000 — cargoMode filter on /dispatch-detail-plan-rows.
 *
 * Pre-fix measurement (real API, in the card): with 50/page pagination all 44
 * LCL lots sat on pages 2–3 because page 1 filled with FCL first, and the
 * endpoint silently ignored every attempted filter name (cargoMode, mode,
 * cargoMode[]). The operator concluded group-assign for hàng lẻ was impossible
 * (FB-115's report).
 *
 * Pinned here:
 * - `cargoMode=LCL` returns ONLY LCL rows (every item cargoMode 'LCL') and
 *   puts them on page 1 — the operator-visible fix.
 * - `cargoMode=FCL` returns the FCL fulfillment rows AND the điều phối
 *   (fulfillment-less) branch, which is container-keyed and therefore
 *   inherently FCL.
 * - `cargoMode=LCL` empties the điều phối branch (LCL lots own no containers
 *   — decomposition guard in shipment-fulfillment.service.ts).
 * - Omitted param: unchanged union (the filter is optional; the default view
 *   must not move).
 * - assignmentStatusCounts recompute over the filtered set and still partition
 *   the filtered total (same shared builder as the rows).
 * - A bad value is a 400, not a silent no-filter.
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
  cargoMode?: string;
};
type PlanResponse = { items?: Row[]; total?: number; assignmentStatusCounts?: Counts; error?: string };

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `cm-${tag}-${suffix}-${createdUserIds.length}`,
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
    code: `SITECM-${suffix.slice(-6)}-${createdSiteIds.length}`.slice(0, 80),
    name: `Nhà máy cm ${suffix}-${createdSiteIds.length}`,
    siteType: 'FACTORY',
    address: `Địa chỉ ${createdSiteIds.length}`,
  }).returning();
  createdSiteIds.push(site.id);
  return site;
}

async function createContainerType(code: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code: `${code}-${suffix.slice(-6)}-${createdContainerTypeIds.length}`.slice(0, 20),
    name: `cm container ${code} ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

/** One lot on either branch and either cargo mode. `mode: 'FCL'` creates a
 *  container (optionally without a fulfillment → điều phối branch, via
 *  `decomposed: false`); `mode: 'LCL'` creates a shipment-level fulfillment
 *  and NO container (the decomposition guard's shape). `plate` splits the
 *  fulfillment branch's chips. */
async function mkLot(args: {
  label: string;
  customer: number;
  route: number;
  mode: 'FCL' | 'LCL';
  appointment: Date | null;
  expectedDeliveryDate?: string | null;
  plate?: string | null;
  decomposed?: boolean;
}) {
  const site = await mkSite(args.customer);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: args.customer,
    routeId: args.route,
    cargoMode: args.mode,
    shipmentCode: `cm-${args.label}-${suffix.slice(-8)}-${createdShipmentIds.length}`,
    bookingRef: `cmBOOK-${args.label}-${suffix.slice(-8)}`,
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: args.expectedDeliveryDate ?? '2026-08-10',
    closingAt: new Date('2026-08-20T08:00:00.000Z'),
    tradeDirection: 'EXPORT',
    operationalSiteId: site.id,
    createdBy: adminUserId,
  }).returning();
  createdShipmentIds.push(shipment.id);
  if (args.mode === 'LCL') {
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'LCL_SHIPMENT',
      cargoMode: 'LCL',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: { deliverySite: { id: site.id, name: site.name, address: site.address } },
      // DB check: an LCL_SHIPMENT row's only legal classification is 'LCL'.
      dispatchClassification: 'LCL',
      plannedCarrierType: args.plate ? 'OWN' : null,
      plannedVehiclePlateNumber: args.plate ?? null,
      createdBy: adminUserId,
    }).returning();
    return { shipment, container: null, fulfillmentId: fulfillment.id };
  }
  const containerType = await createContainerType(`CM0G${createdContainerTypeIds.length}`);
  const [pickupPort] = await db.insert(s.ports).values({ name: `cm pickup ${suffix}-${createdShipmentIds.length}` }).returning();
  const [dropoffPort] = await db.insert(s.ports).values({ name: `cm dropoff ${suffix}-${createdShipmentIds.length}` }).returning();
  createdPortIds.push(pickupPort.id, dropoffPort.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `CNTCM${String(700000 + shipment.id).slice(-6)}`,
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

describe('171026154000 — cargoMode filters both branches of the detail plan', () => {
  test('LCL scope returns only LCL rows on page 1; FCL keeps the điều phối branch; counts follow', async () => {
    const customer = await mkCustomer(`cm modes ${suffix}`);
    const route = await mkRoute('cm route modes');
    // Fulfillment branch: both modes, both chip halves.
    const fclPlain = await mkLot({ label: 'fcl-plain', customer: customer.id, route: route.id, mode: 'FCL', appointment: vnDay('2026-08-15') });
    const fclPlated = await mkLot({ label: 'fcl-plated', customer: customer.id, route: route.id, mode: 'FCL', appointment: vnDay('2026-08-15'), plate: '51A-77.77' });
    const lclPlain = await mkLot({ label: 'lcl-plain', customer: customer.id, route: route.id, mode: 'LCL', appointment: vnDay('2026-08-15') });
    const lclPlated = await mkLot({ label: 'lcl-plated', customer: customer.id, route: route.id, mode: 'LCL', appointment: vnDay('2026-08-15'), plate: '51B-88.88' });
    // Điều phối (fulfillment-less) branch: container-keyed, inherently FCL.
    const fclBranch = await mkLot({ label: 'fcl-branch', customer: customer.id, route: route.id, mode: 'FCL', appointment: vnDay('2026-08-15'), decomposed: false });

    // Baseline: no cargoMode — the union is unchanged (the param is optional).
    const all = await fetchRows(`?customerId=${customer.id}`);
    assert.equal(all.status, 200, JSON.stringify(all.data));
    assert.equal(all.data.total, 5, 'unfiltered union: 3 FCL (2 fulfillments + 1 branch) + 2 LCL');
    assert.deepEqual(all.data.assignmentStatusCounts, { UNASSIGNED: 3, ASSIGNED: 2 });

    // LCL scope: exactly the two LCL rows, nothing else on page 1.
    const lcl = await fetchRows(`?customerId=${customer.id}&cargoMode=LCL`);
    assert.equal(lcl.status, 200, JSON.stringify(lcl.data));
    assert.equal(lcl.data.total, 2);
    assert.deepEqual(
      (lcl.data.items ?? []).map((r) => r.fulfillmentId).sort(),
      [lclPlain.fulfillmentId, lclPlated.fulfillmentId].sort(),
      'cargoMode=LCL returns the LCL fulfillment rows only',
    );
    assert.ok((lcl.data.items ?? []).every((r) => r.cargoMode === 'LCL'),
      'every returned row reports cargoMode LCL');
    assert.ok(!(lcl.data.items ?? []).some((r) => r.shipmentContainerId === fclBranch.container!.id),
      'the điều phối branch (inherently FCL) is empty under LCL');
    assert.deepEqual(lcl.data.assignmentStatusCounts, { UNASSIGNED: 1, ASSIGNED: 1 },
      'chip counts recompute over the filtered set');
    assert.equal(lcl.data.assignmentStatusCounts!.UNASSIGNED + lcl.data.assignmentStatusCounts!.ASSIGNED, lcl.data.total,
      'chip counts partition the filtered total');
    const lclPage1 = await fetchRows(`?customerId=${customer.id}&cargoMode=LCL&limit=1&page=1`);
    assert.equal(lclPage1.status, 200, JSON.stringify(lclPage1.data));
    assert.equal(lclPage1.data.items?.[0]?.cargoMode, 'LCL',
      'the operator-visible fix: page 1 now opens on an LCL row');

    // Per-chip totals under the mode filter equal the chips (same builder).
    const lclUn = await fetchRows(`?customerId=${customer.id}&cargoMode=LCL&assignmentStatus=UNASSIGNED`);
    assert.equal(lclUn.data.total, 1);
    assert.deepEqual((lclUn.data.items ?? []).map((r) => r.fulfillmentId), [lclPlain.fulfillmentId]);
    const lclAs = await fetchRows(`?customerId=${customer.id}&cargoMode=LCL&assignmentStatus=ASSIGNED`);
    assert.equal(lclAs.data.total, lcl.data.assignmentStatusCounts!.ASSIGNED);
    assert.deepEqual((lclAs.data.items ?? []).map((r) => r.fulfillmentId), [lclPlated.fulfillmentId]);

    // FCL scope: the FCL fulfillment rows AND the branch row.
    const fcl = await fetchRows(`?customerId=${customer.id}&cargoMode=FCL`);
    assert.equal(fcl.status, 200, JSON.stringify(fcl.data));
    assert.equal(fcl.data.total, 3);
    assert.deepEqual(
      (fcl.data.items ?? []).map((r) => (r.fulfillmentId == null ? `b${r.shipmentContainerId}` : `f${r.fulfillmentId}`)).sort(),
      [`f${fclPlain.fulfillmentId}`, `f${fclPlated.fulfillmentId}`, `b${fclBranch.container!.id}`].sort(),
      'cargoMode=FCL keeps the fulfillment rows and the điều phối branch',
    );
    assert.ok((fcl.data.items ?? []).every((r) => r.cargoMode === 'FCL'));
    assert.deepEqual(fcl.data.assignmentStatusCounts, { UNASSIGNED: 2, ASSIGNED: 1 },
      'branch row counts under Chưa gán xe on the FCL side');
    assert.equal(fcl.data.assignmentStatusCounts!.UNASSIGNED + fcl.data.assignmentStatusCounts!.ASSIGNED, fcl.data.total);

    // The mode filter composes with the period filter on both branches.
    const fclRanged = await fetchRows(`?customerId=${customer.id}&cargoMode=FCL&dateFrom=2026-08-01&dateTo=2026-08-31`);
    assert.equal(fclRanged.status, 200, JSON.stringify(fclRanged.data));
    assert.equal(fclRanged.data.total, 3, 'all seeded FCL rows are in-period — mode and range compose');
    const lclOutOfPeriod = await fetchRows(`?customerId=${customer.id}&cargoMode=LCL&dateFrom=2026-07-01&dateTo=2026-07-31`);
    assert.equal(lclOutOfPeriod.data.total, 0, 'an out-of-period LCL scope is a real empty set');
  });

  test('an invalid cargoMode is a 400, not a silent no-filter', async () => {
    const bad = await fetchRows(`?cargoMode=XXL`);
    assert.equal(bad.status, 400);
    assert.match(bad.data.error ?? '', /cargoMode không hợp lệ/);
  });
});
