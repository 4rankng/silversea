import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Valid ISO 6346 number: 4 letters + 6 digits + computed check digit. */
function isoNumber(seed: number): string {
  const base = `CSQ${String.fromCharCode(85 + (seed % 3))}${String(100000 + seed + cleanup.length).slice(0, 6)}`;
  const letterValue = (ch: string) => {
    // ISO 6346 letter values run 10..38 skipping multiples of 11.
    let v = 10;
    for (let c = 65; c < ch.charCodeAt(0); c++) {
      v += 1;
      if (v % 11 === 0) v += 1;
    }
    return v;
  };
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const ch = base[i]!;
    sum += (/[A-Z]/.test(ch) ? letterValue(ch) : Number(ch)) * 2 ** i;
  }
  const check = sum % 11 === 10 ? 0 : sum % 11;
  return base + String(check);
}
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

let server: http.Server;
let baseUrl = '';
let cusId = 0;

async function api(method: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `c2-${suffix}-${Math.random()}`,
      'X-Test-User-Id': String(cusId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function mkLotWithContainers(opts: { tripped?: boolean } = {}) {
  const [cus] = await db.insert(s.users).values({
    username: `c2-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.CUS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, cus.id);
  if (cusId === 0) cusId = cus.id;
  const [customer] = await db.insert(s.customers).values({ name: `C2 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C2 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id, version: s.shipments.version });
  track(s.shipments, shipment.id);
  const freeNumber = isoNumber(1);
  const freeId = await mkContainer(shipment.id, freeNumber);
  const tripNumber = isoNumber(2);
  const tripContainerId = opts.tripped ? await mkContainer(shipment.id, tripNumber) : null;
  const freeFid = await mkFulfillment(shipment.id, freeId);
  const tripFid = tripContainerId != null ? await mkFulfillment(shipment.id, tripContainerId) : null;
  if (tripFid != null) {
    const [trip] = await db.insert(s.trips).values({
      fulfillmentId: tripFid, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
      tripCode: `TRP-C2-${suffix}`,
      departureDate: '2026-10-01', status: 'CREATED',
    }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
    track(s.trips, trip.id);
    return { shipment, freeId, freeNumber, tripContainerId, freeFid, tripFid, tripCode: trip.tripCode };
  }
  return { shipment, freeId, freeNumber, tripContainerId, freeFid, tripFid, tripCode: null };
}

async function mkContainer(shipmentId: number, number_: string) {
  const [row] = await db.insert(s.shipmentContainers).values({
    shipmentId, containerNumber: number_,
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, row.id);
  return row.id;
}

async function mkFulfillment(shipmentId: number, containerId: number) {
  const [row] = await db.insert(s.shipmentFulfillments).values({
    shipmentId, shipmentContainerId: containerId,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, row.id);
  return row.id;
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test', role: Role.CUS,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(eq(table.id, id));
    }
  } catch {
    // red-phase tolerance
  }
  await disconnectRedis();
});

describe('card 20260921_2 — CUS add/remove container rows after intake', () => {
  test('free container removes; tripped container 409s per-row; neighbors untouched', async () => {
    const fx = await mkLotWithContainers({ tripped: true });

    const blocked = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.tripContainerId}/remove`, { expectedShipmentVersion: fx.shipment.version });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body.error ?? ''), /đã gắn chuyến xe/);
    assert.match(String(blocked.body.error ?? ''), new RegExp(fx.tripCode!));

    // The free row still removes on the same lot — the block never widens.
    const removed = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.freeId}/remove`, { expectedShipmentVersion: fx.shipment.version });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removedId, fx.freeId);

    // AC4: the tripped row's fulfillment stays alive and its container row
    // still exists after the neighbor's removal.
    const [stillThere] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.id, fx.tripContainerId!));
    assert.ok(stillThere);
    const [fid] = await db.select({ canceledAt: s.shipmentFulfillments.canceledAt })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, fx.tripFid!));
    assert.equal(fid!.canceledAt, null);
  });

  test('version conflict on remove still 409s with the reload message', async () => {
    const fx = await mkLotWithContainers();
    const remove = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.freeId}/remove`, { expectedShipmentVersion: fx.shipment.version + 5 });
    assert.equal(remove.status, 409);
    assert.match(String(remove.body.error ?? ''), /vừa thay đổi/);
  });
});

describe('card 20260921_2 — add row', () => {
  test('add appends a container, bumps the version, decomposes a fulfillment', async () => {
    const fx = await mkLotWithContainers();
    const add = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers`, {
      expectedShipmentVersion: fx.shipment.version,
      containerNumber: isoNumber(4),
    });
    assert.equal(add.status, 201);
    assert.ok(add.body.line && (add.body.line as { id: number }).id > 0);

    const [shipment] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, fx.shipment.id));
    assert.equal(shipment!.version, fx.shipment.version + 1);
  });

  test('add with appointment carries it and validates duplicates and format', async () => {
    const fx = await mkLotWithContainers();
    const dup = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers`, {
      expectedShipmentVersion: fx.shipment.version,
      containerNumber: fx.freeNumber,
    });
    assert.equal(dup.status, 400);

    const bad = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers`, {
      expectedShipmentVersion: fx.shipment.version,
      containerNumber: 'NOT-ISO-6346!!!',
    });
    assert.equal(bad.status, 400);

    const ok = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers`, {
      expectedShipmentVersion: fx.shipment.version,
      containerNumber: isoNumber(3),
      customerAppointmentAt: '2026-10-05T08:30:00+07:00',
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });
});
