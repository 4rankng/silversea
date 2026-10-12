import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';

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
let cusId = 0;

async function api(method: string, path: string, body?: Record<string, unknown>, idempotencyKey?: string) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey ?? `ac-${suffix}-${Math.random()}`,
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

async function mkContainer(shipmentId: number, number_: string, appointment?: Date) {
  const [row] = await db.insert(s.shipmentContainers).values({
    shipmentId, containerNumber: number_, ...(appointment ? { customerAppointmentAt: appointment } : {}),
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, row.id);
  return row.id;
}

/** A lot of N containers; `appointmentFor[i]` seeds container i with an
 *  appointment (undefined = still empty). */
async function mkLot(appointmentFor: Array<Date | undefined>) {
  const [cus] = await db.insert(s.users).values({
    username: `ac-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.CUS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, cus.id);
  if (cusId === 0) cusId = cus.id;
  const [customer] = await db.insert(s.customers).values({ name: `AC customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `AC route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id, version: s.shipments.version });
  track(s.shipments, shipment.id);
  const containerIds: number[] = [];
  for (const [index, appointment] of appointmentFor.entries()) {
    const id = await mkContainer(shipment.id, isoNumber(index + 1), appointment);
    containerIds.push(id);
    const [fid] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, shipmentContainerId: id,
      fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    }).returning({ id: s.shipmentFulfillments.id });
    track(s.shipmentFulfillments, fid.id);
  }
  return { shipment, containerIds };
}

async function appointmentsOf(...containerIds: number[]) {
  const rows = await db.select({
    id: s.shipmentContainers.id,
    appointment: s.shipmentContainers.customerAppointmentAt,
  }).from(s.shipmentContainers).where(inArray(s.shipmentContainers.id, containerIds));
  return rows;
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
  // The test user must exist for the audit/updatedBy columns.
  if (cusId === 0) {
    const [created] = await db.insert(s.users).values({
      username: `ac-owner-${suffix}`, passwordHash: 't', role: Role.CUS, status: 'ACTIVE',
    }).returning({ id: s.users.id });
    track(s.users, created.id);
    cusId = created.id;
  }
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

describe('bulk appointment copy — copy giờ hẹn xuống các cont chưa có lịch', () => {
  test('fills every empty line of the lot in ONE call, never the source, and moves the version once', async () => {
    const source = new Date('2026-10-15T09:30:00+07:00');
    const fx = await mkLot([source, undefined, undefined]);

    const res = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    });
    assert.equal(res.status, 200);
    const updated = res.body.updatedContainerIds as number[];
    assert.deepEqual(updated.sort(), [fx.containerIds[1]!, fx.containerIds[2]!].sort());

    const rows = await appointmentsOf(...fx.containerIds);
    const byId = new Map(rows.map((row) => [row.id, row.appointment]));
    // The source keeps its own value; both empty neighbours took it exactly.
    assert.equal(byId.get(fx.containerIds[0])!.getTime(), source.getTime());
    assert.equal(byId.get(fx.containerIds[1])!.getTime(), source.getTime());
    assert.equal(byId.get(fx.containerIds[2])!.getTime(), source.getTime());

    // One write = one version move, not one per row.
    const [fresh] = await db.select({ version: s.shipments.version, status: s.shipments.status })
      .from(s.shipments).where(eq(s.shipments.id, fx.shipment.id));
    assert.equal(fresh!.version, fx.shipment.version + 1);
    // Every FCL row is dated now, so the lot is dispatch-ready — the derived
    // date projection ran on the copied set.
    assert.equal(fresh!.status, 'READY_FOR_DISPATCH');
  });

  test('never overwrites a line that already has an appointment', async () => {
    const source = new Date('2026-10-16T08:00:00+07:00');
    const keepMe = new Date('2026-10-20T14:00:00+07:00');
    const fx = await mkLot([source, keepMe, undefined]);

    const res = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.updatedContainerIds, [fx.containerIds[2]]);

    const rows = await appointmentsOf(...fx.containerIds);
    const byId = new Map(rows.map((row) => [row.id, row.appointment]));
    assert.equal(byId.get(fx.containerIds[1])!.getTime(), keepMe.getTime());
  });

  test('another lot sharing the workboard is never touched', async () => {
    const source = new Date('2026-10-17T07:00:00+07:00');
    const mine = await mkLot([source, undefined]);
    const neighbour = await mkLot([undefined]);

    const res = await api('POST', `/api/shipments/cus-workspace/${mine.shipment.id}/containers/${mine.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: mine.shipment.version,
    });
    assert.equal(res.status, 200);

    const rows = await appointmentsOf(neighbour.containerIds[0]!);
    assert.equal(rows[0]!.appointment, null);
  });

  test('a source row without an appointment is rejected with a named reason', async () => {
    const fx = await mkLot([undefined, undefined]);
    const res = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error ?? ''), /chưa có lịch hẹn/);
  });

  test('a lot where every line is already scheduled reports there is nothing to copy', async () => {
    const fx = await mkLot([new Date('2026-10-18T09:00:00+07:00'), new Date('2026-10-19T09:00:00+07:00')]);
    const res = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    });
    assert.equal(res.status, 409);
    assert.match(String(res.body.error ?? ''), /đã có lịch hẹn/);
  });

  test('a stale version 409s instead of copying onto a lot that moved on', async () => {
    const fx = await mkLot([new Date('2026-10-21T09:00:00+07:00'), undefined]);
    const res = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version + 7,
    });
    assert.equal(res.status, 409);
    const rows = await appointmentsOf(fx.containerIds[1]!);
    assert.equal(rows[0]!.appointment, null);
  });

  test('an idempotency replay returns the first result and writes nothing twice', async () => {
    const source = new Date('2026-10-22T09:00:00+07:00');
    const fx = await mkLot([source, undefined]);
    const key = `ac-replay-${suffix}-${Math.random()}`;

    const first = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    }, key);
    const again = await api('POST', `/api/shipments/cus-workspace/${fx.shipment.id}/containers/${fx.containerIds[0]}/copy-appointment`, {
      expectedShipmentVersion: fx.shipment.version,
    }, key);
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body.updatedContainerIds, first.body.updatedContainerIds);

    const [fresh] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, fx.shipment.id));
    assert.equal(fresh!.version, fx.shipment.version + 1);
  });
});
