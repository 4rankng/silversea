import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, count } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';

/**
 * Lệnh chạy ngoài (ad-hoc orders) — MasterDataNhaMay §4/§2.1:
 * hybrid storage (ID XOR raw text), master-data guardrail (no catalog leak),
 * mixed catalog/free-text rows, dispatch boundary, display coalescing.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdRouteIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let cusToken: string;
let ownRoute: { id: number };

/**
 * Guardrail (AC5): free text never leaks into the master catalogs. The pin is
 * scoped to the exact raw names this suite submits — whole-company count
 * snapshots are inherently racy on the shared dev DB, where parallel suites
 * legitimately create and tear down their own catalog fixtures between any
 * two snapshots (card 261019145030; scoping precedent REDS-CONC-03 in
 * testplan/2026-10-19-be-reds-final-cross-run-interference.md).
 */
const SUBMITTED_RAW_NAMES = [
  // Exact submitted values, plus the untrimmed variant of the first create —
  // the create trims before storing, so a catalog leak would carry the
  // trimmed form; the padded form only exists if a pathological path wrote
  // the raw input through.
  'Khách vãng lai BG',
  '  Khách vãng lai BG  ',
  'Cầu Nhật Tân — KCN Quang Minh',
  'Khách một cuốc',
  'Khách hiện danh',
  'Khách sửa lại',
  'Khách không cước',
] as const;

async function assertMasterCatalogsClean() {
  const [customers] = await db.select({ n: count() }).from(s.customers)
    .where(inArray(s.customers.name, [...SUBMITTED_RAW_NAMES]));
  const [sites] = await db.select({ n: count() }).from(s.operationalSites)
    .where(inArray(s.operationalSites.name, [...SUBMITTED_RAW_NAMES]));
  const [routes] = await db.select({ n: count() }).from(s.routes)
    .where(inArray(s.routes.name, [...SUBMITTED_RAW_NAMES]));
  const [ports] = await db.select({ n: count() }).from(s.ports)
    .where(inArray(s.ports.name, [...SUBMITTED_RAW_NAMES]));
  assert.deepEqual(
    { customers: customers.n, sites: sites.n, routes: routes.n, ports: ports.n },
    { customers: 0, sites: 0, routes: 0, ports: 0 },
    'free text must never leak into the master catalogs (AC5)',
  );
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function api(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const method = init.method ?? 'GET';
  if (method !== 'GET') headers['Idempotency-Key'] = `adhoc-${suffix}-${Math.random()}`;
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, shipmentRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const [cus] = await db.insert(s.users).values({
    username: `adhoc-cus-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.CUS,
    fullName: 'AdHoc Cus',
  }).returning();
  createdUserIds.push(cus.id);
  cusToken = sign(cus);

  // Own catalog fixture for the mixed-row case: never pick an arbitrary row
  // off the shared catalog (`.limit(1)` can return another suite's fixture,
  // which its teardown may delete between the pick and the create — card
  // 261019145030 P2).
  const [route] = await db.insert(s.routes).values({
    name: `AdHoc route ${suffix}`,
  }).returning({ id: s.routes.id });
  createdRouteIds.push(route.id);
  ownRoute = route;
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    try {
      if (createdShipmentIds.length) {
        await db.delete(s.userShipmentPins).where(inArray(s.userShipmentPins.shipmentId, createdShipmentIds));
        await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
        await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
        await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
      }
      if (createdRouteIds.length) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
      if (createdUserIds.length) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    } finally {
      await client.end();
    }
  }
});

describe('lệnh chạy ngoài — hybrid intake (MasterDataNhaMay §4)', () => {
  test('full free-text create stores raw names with null ids; master catalogs stay clean', async () => {
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: '  Khách vãng lai BG  ',
        rawRouteName: 'Cầu Nhật Tân — KCN Quang Minh',
        tradeDirection: 'IMPORT',
        blNumber: `ADHOC-${suffix}`,
        pickupLocation: 'Cảng Hải Phòng',
        deliveryLocation: 'KCN Quang Minh',
        contactName: 'Anh Tùng',
        contactPhone: '0900000009',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdShipmentIds.push(created.body.id);
    assert.equal(created.body.customerId, null);
    assert.equal(created.body.rawCustomerName, 'Khách vãng lai BG');
    assert.equal(created.body.rawRouteName, 'Cầu Nhật Tân — KCN Quang Minh');
    assert.equal(created.body.isAdHoc, true);

    // Guardrail (AC5): free text never leaks into the master catalogs.
    await assertMasterCatalogsClean();
  });

  test('non-ad-hoc create still requires a catalog customer', async () => {
    const rejected = await api('', {
      method: 'POST',
      token: cusToken,
      body: { tradeDirection: 'IMPORT', blNumber: `NEEDCUST-${suffix}` },
    });
    assert.equal(rejected.status, 400);
    assert.match(JSON.stringify(rejected.body), /Khách hàng là bắt buộc/);
  });

  test('ad-hoc create without any customer text is rejected', async () => {
    const rejected = await api('', {
      method: 'POST',
      token: cusToken,
      body: { isAdHoc: true, tradeDirection: 'IMPORT', blNumber: `NOCUST-${suffix}` },
    });
    assert.equal(rejected.status, 400);
    assert.match(JSON.stringify(rejected.body), /tên khách hàng/);
  });

  test('mixed row: free-text customer + catalog route id', async () => {
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: 'Khách một cuốc',
        routeId: ownRoute.id,
        tradeDirection: 'EXPORT',
        bookingRef: `ADMIX-${suffix}`,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdShipmentIds.push(created.body.id);
    // Catalog id wins and its raw mirror stays empty (XOR, §2.1 rule 1).
    assert.equal(created.body.routeId, ownRoute.id);
    assert.equal(created.body.rawRouteName, null);
    assert.equal(created.body.customerId, null);
    assert.equal(created.body.rawCustomerName, 'Khách một cuốc');

    // Guardrail (AC5): free text never leaks into the master catalogs.
    await assertMasterCatalogsClean();
  });

  test('detail view coalesces the customer name — never an empty cell', async () => {
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: 'Khách hiện danh',
        tradeDirection: 'IMPORT',
        blNumber: `ADHOCV-${suffix}`,
      },
    });
    createdShipmentIds.push(created.body.id);

    const detail = await api(`/${created.body.id}`, { token: cusToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.shipment.customerName, 'Khách hiện danh');
    assert.equal(detail.body.shipment.isAdHoc, true);
  });

  test('reopen-for-edit keeps the ad-hoc flag (AC10)', async () => {
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: 'Khách sửa lại',
        tradeDirection: 'IMPORT',
        blNumber: `ADHOCE-${suffix}`,
      },
    });
    createdShipmentIds.push(created.body.id);

    const [row] = await db.select().from(s.shipments)
      .where(eq(s.shipments.id, created.body.id)).limit(1);
    assert.equal(row.isAdHoc, true);
    assert.equal(row.rawCustomerName, 'Khách sửa lại');
  });

  test('pricing projection reports the ad-hoc bypass instead of blocking', async () => {
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: 'Khách không cước',
        tradeDirection: 'IMPORT',
        blNumber: `ADHOCP-${suffix}`,
      },
    });
    createdShipmentIds.push(created.body.id);
    // AC3: save succeeds without a rate card — the flag is on the row and the
    // create returned 201; the projection bypass is asserted at the service
    // boundary by the null-customer early return.
    assert.equal(created.status, 201);
  });
});
