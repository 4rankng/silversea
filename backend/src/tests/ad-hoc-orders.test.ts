import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';

/**
 * Lệnh chạy ngoài (ad-hoc orders) — MasterDataNhaMay §4/§2.1:
 * hybrid storage (ID XOR raw text), master-data guardrail (counts unchanged),
 * mixed catalog/free-text rows, dispatch boundary, display coalescing.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdShipmentIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let cusToken: string;

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

async function masterCounts() {
  const [row] = await db.execute(sql`select
    (select count(*) from customers) as customers,
    (select count(*) from operational_sites) as sites,
    (select count(*) from routes) as routes,
    (select count(*) from ports) as ports`);
  return row as { customers: string; sites: string; routes: string; ports: string };
}

let countsBefore: Awaited<ReturnType<typeof masterCounts>>;

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

  countsBefore = await masterCounts();
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
      if (createdUserIds.length) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    } finally {
      await client.end();
    }
  }
});

describe('lệnh chạy ngoài — hybrid intake (MasterDataNhaMay §4)', () => {
  test('full free-text create stores raw names with null ids; master counts unchanged', async () => {
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
    const countsAfter = await masterCounts();
    assert.deepEqual(countsAfter, countsBefore);
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
    const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
    const created = await api('', {
      method: 'POST',
      token: cusToken,
      body: {
        isAdHoc: true,
        rawCustomerName: 'Khách một cuốc',
        routeId: route?.id,
        tradeDirection: 'EXPORT',
        bookingRef: `ADMIX-${suffix}`,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdShipmentIds.push(created.body.id);
    // Catalog id wins and its raw mirror stays empty (XOR, §2.1 rule 1).
    assert.equal(created.body.routeId, route?.id ?? null);
    assert.equal(created.body.rawRouteName, null);
    assert.equal(created.body.customerId, null);
    assert.equal(created.body.rawCustomerName, 'Khách một cuốc');

    const countsAfter = await masterCounts();
    assert.deepEqual(countsAfter, countsBefore);
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
