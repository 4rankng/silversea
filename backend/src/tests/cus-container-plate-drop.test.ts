// Card 20260916_4 — a plate update on a carrier-less container used to be
// silently dropped: the write lived inside carrierType-gated branches, and a
// null plannedCarrierType fell through every branch while the route still
// returned 200 with a version bump. The plate must never read as saved when
// nothing was saved.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { cusWorkspaceRoutes } from '../routes/shipments/cus-workspace.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-platedrop`;
const ids = { customer: 0, shipment: 0, containerType: 0, container: 0, fulfillment: 0, user: 0 };
let server: http.Server;
let baseUrl: string;

async function request(method: 'POST', path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${suffix}-${Math.random().toString(36).slice(2, 8)}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({
    name: `Plate drop customer ${suffix}`,
    shortName: `PD ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  ids.customer = customer.id;

  const [containerType] = await db.insert(s.containerTypes).values({
    name: `PD type ${suffix}`,
    code: `PD${suffix.slice(-6)}`,
  }).returning();
  ids.containerType = containerType.id;

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    cargoMode: 'FCL',
    shipmentCode: `PD-${suffix}`,
    status: 'PENDING_DATE',
    createdBy: 1,
    version: 1,
  }).returning();
  ids.shipment = shipment.id;

  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: `PD${suffix.slice(-6)}1`,
    createdBy: 1,
  }).returning();
  ids.container = container.id;

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: 1,
    siteSnapshot: {},
    plannedCarrierType: null,
    createdBy: 1,
    version: 1,
  }).returning();
  ids.fulfillment = fulfillment.id;

  const [user] = await db.insert(s.users).values({
    username: `plate-drop-${suffix}`,
    passwordHash: 'x',
    role: Role.CUS,
  }).returning();
  ids.user = user.id;

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', (req, _res, next) => {
    req.user = {
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: Role.CUS,
    };
    next();
  }, cusWorkspaceRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close((error) => error ? reject(error) : resolve());
    function reject(error: unknown) { throw error; }
  });
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, ids.fulfillment));
  await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, ids.container));
  await db.delete(s.shipments).where(eq(s.shipments.id, ids.shipment));
  await db.delete(s.containerTypes).where(eq(s.containerTypes.id, ids.containerType));
  await db.delete(s.customers).where(eq(s.customers.id, ids.customer));
  await db.delete(s.users).where(eq(s.users.id, ids.user));
  await disconnectRedis();
  await client.end();
});

describe('card 20260916_4 — plate updates on carrier-less containers', () => {
  test('plate update without a carrier type is rejected, never silently dropped', async () => {
    const res = await request('POST', `/api/shipments/cus-workspace/${ids.shipment}/containers/${ids.container}`, {
      expectedShipmentVersion: 1,
      plateNumber: '24H-777.01',
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /nhà xe/u);
    const [fulfillment] = await db.select().from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.id, ids.fulfillment));
    assert.equal(fulfillment.plannedVehiclePlateNumber, null);
  });
});
