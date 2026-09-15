/** QA129: actual authenticated completion route, atomic failure and same-key retry. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { Role, TRIP_POD_REQUIRED_FILE_TYPES } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import driverRoutes from '../routes/driver';
import { toBusinessDateString } from '../services/trip-attendance-sync.service';

const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const created: Array<{ tripId: number; driverId: number; userId: number; shipmentId: number; fulfillmentId: number; podId: number }> = [];
let server: http.Server;
let base: string;
let customerId: number;
let routeId: number;
let triggerCreated = false;
const triggerName = `qa129_attendance_${suffix}`;

before(async () => {
  await initEnforcer();
  await initAuditService();
  const [customer] = await db.insert(s.customers).values({ name: `QA129 ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `QA129 ${suffix}` }).returning();
  customerId = customer.id; routeId = route.id;
  const app = express(); app.use(express.json());
  app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/driver/me`;
});

async function fixture(departureDate: string) {
  const tag = `${suffix}-${created.length}`;
  const [user] = await db.insert(s.users).values({ username: `qa129-${tag}`, role: Role.DRIVER, passwordHash: 'test-only', status: 'ACTIVE' }).returning();
  const [driver] = await db.insert(s.drivers).values({ name: `QA129 ${tag}`, userId: user.id, baseSalary: '10000000' }).returning();
  const [shipment] = await db.insert(s.shipments).values({ customerId, routeId, cargoMode: 'FCL', status: 'DISPATCHED', createdBy: user.id }).returning();
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({ shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', dispatchClassification: 'SINGLE', sourceShipmentVersion: shipment.version, createdBy: user.id }).returning();
  const [trip] = await db.insert(s.trips).values({ tripCode: `QA129-${tag}`, driverId: driver.id, customerId, routeId, departureDate, status: 'IN_TRANSIT', shipmentId: shipment.id, fulfillmentId: fulfillment.id }).returning();
  await db.insert(s.driverProgressEvents).values({ tripId: trip.id, driverId: driver.id, eventType: 'ORDER_RECEIVED', occurredAt: new Date(`${departureDate}T01:00:00Z`), recordedBy: user.id });
  const [pod] = await db.insert(s.tripPodSubmissions).values({ tripId: trip.id, fulfillmentId: fulfillment.id, submissionVersion: 1, sourceTripVersion: trip.version, status: 'SUBMITTED', submittedBy: user.id, submittedAt: new Date() }).returning();
  await db.insert(s.tripPodFiles).values(TRIP_POD_REQUIRED_FILE_TYPES.map(fileType => ({ submissionId: pod.id, fileType, storageKey: `qa129/${tag}/${fileType}.png`, originalFileName: `${fileType}.png`, mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64), uploadedBy: user.id })));
  const row = { tripId: trip.id, driverId: driver.id, userId: user.id, shipmentId: shipment.id, fulfillmentId: fulfillment.id, podId: pod.id };
  created.push(row);
  const token = jwt.sign({ userId: user.id, username: user.username, role: Role.DRIVER }, config.jwtSecret);
  const key = `qa129-${tag}`;
  return { ...row, version: trip.version, token, key, departureDate };
}

async function complete(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await fetch(`${base}/fulfillments/${f.fulfillmentId}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': f.key }, body: JSON.stringify({ expectedVersion: f.version }) });
  return { status: response.status, body: await response.json() };
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, f.tripId));
  const days = await db.select().from(s.driverWorkDays).where(eq(s.driverWorkDays.driverId, f.driverId)).orderBy(s.driverWorkDays.date);
  const postings = await db.select().from(s.tripFinancialPostings).where(eq(s.tripFinancialPostings.tripId, f.tripId));
  const events = await db.select().from(s.driverProgressEvents).where(eq(s.driverProgressEvents.tripId, f.tripId));
  return { trip, days, postings, events };
}
function expectedDates(start: string, end: string) {
  const dates = []; const date = new Date(`${start}T00:00:00Z`);
  while (date.toISOString().slice(0, 10) <= end) { dates.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1); }
  return dates;
}
async function removeTrigger() {
  if (!triggerCreated) return;
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON driver_work_days; DROP FUNCTION IF EXISTS ${triggerName}();`));
  triggerCreated = false;
}

test('driver route completion records the actual business-date range including Sunday exactly once', async () => {
  const end = toBusinessDateString(new Date())!;
  const saturday = new Date(`${end}T00:00:00Z`);
  saturday.setUTCDate(saturday.getUTCDate() - ((saturday.getUTCDay() + 1) % 7 || 7));
  const f = await fixture(saturday.toISOString().slice(0, 10));
  const first = await complete(f);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const saved = await state(f);
  assert.equal(saved.trip.status, 'COMPLETED');
  assert.deepEqual(saved.days.map(x => x.date), expectedDates(f.departureDate, toBusinessDateString(saved.trip.completedAt)!));
  assert.ok(saved.days.every(x => x.status === 'TRIP_DAY' && x.tripId === f.tripId));
  assert.ok(saved.days.some(x => new Date(`${x.date}T00:00:00Z`).getUTCDay() === 0));
  const replay = await complete(f);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(replay.body, first.body);
  const afterReplay = await state(f);
  assert.deepEqual(afterReplay.days, saved.days);
  assert.equal(afterReplay.postings.length, saved.postings.length);
  assert.equal(afterReplay.events.length, saved.events.length);
});

test('attendance failure rolls back completion and posting; retrying the same key converges', async () => {
  const f = await fixture(toBusinessDateString(new Date())!);
  const beforeState = await state(f);
  await db.execute(sql.raw(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.driver_id = ${f.driverId} THEN RAISE EXCEPTION 'QA129 injected attendance failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON driver_work_days FOR EACH ROW EXECUTE FUNCTION ${triggerName}();`));
  triggerCreated = true;
  try {
    const failed = await complete(f);
    assert.equal(failed.status, 500);
    const rolledBack = await state(f);
    assert.equal(rolledBack.trip.status, 'IN_TRANSIT');
    assert.equal(rolledBack.trip.completedAt, null);
    assert.equal(rolledBack.trip.version, beforeState.trip.version);
    assert.deepEqual(rolledBack.days, beforeState.days);
    assert.deepEqual(rolledBack.postings, beforeState.postings);
    assert.deepEqual(rolledBack.events, beforeState.events);
  } finally { await removeTrigger(); }
  const retried = await complete(f);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  const saved = await state(f);
  assert.equal(saved.trip.status, 'COMPLETED');
  assert.equal(saved.days.length, 1);
});

after(async () => {
  try {
    await removeTrigger();
    for (const f of created) {
      await db.delete(s.tripPodFiles).where(eq(s.tripPodFiles.submissionId, f.podId));
      await db.delete(s.tripPodSubmissions).where(eq(s.tripPodSubmissions.id, f.podId));
      await db.delete(s.driverProgressEvents).where(eq(s.driverProgressEvents.tripId, f.tripId));
      await db.delete(s.driverWorkDays).where(eq(s.driverWorkDays.driverId, f.driverId));
      await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, f.userId));
      await db.execute(sql`DELETE FROM ledger WHERE financial_posting_id IN (SELECT id FROM trip_financial_postings WHERE trip_id = ${f.tripId})`);
      await db.delete(s.tripFinancialPostings).where(eq(s.tripFinancialPostings.tripId, f.tripId));
      await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, f.userId));
      await db.delete(s.trips).where(eq(s.trips.id, f.tripId));
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, f.fulfillmentId));
      await db.delete(s.shipments).where(eq(s.shipments.id, f.shipmentId));
      await db.delete(s.drivers).where(eq(s.drivers.id, f.driverId));
      await db.delete(s.users).where(eq(s.users.id, f.userId));
    }
    if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
    if (routeId) await db.delete(s.routes).where(eq(s.routes.id, routeId));
  } finally {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await disconnectRedis(); await client.end();
  }
});
