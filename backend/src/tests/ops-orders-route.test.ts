// listOpsOrders route-display matrix — CUS semantics on the ops/orders list:
// distinct container routes first (the common FCL case), shipment route as
// the LCL/legacy fallback, and no empty tokens from NULL container routes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { listOpsOrders } from '../services/ops-orders.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const shipmentIds: number[] = [];


before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `OpsR khách ${suffix}`, status: 'ACTIVE' }).returning();
  customerIds.push(customer.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `OpsR cargo ${suffix}` }).returning();
  cargoTypeIds.push(cargoType.id);
});

async function mkLot(args: { code: string; shipmentRouteId?: number | null; containers: Array<{ routeId?: number | null }> }) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customerIds[0],
    routeId: args.shipmentRouteId ?? null,
    cargoTypeId: cargoTypeIds[0],
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    shipmentCode: args.code,
    expectedDeliveryDate: '2026-09-14',
  }).returning();
  shipmentIds.push(shipment.id);
  for (const container of args.containers) {
    await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      routeId: container.routeId ?? null,
      containerNumber: `OPSR${String(900000 + shipment.id).slice(-6)}-${args.containers.indexOf(container)}`,
    });
  }
  return shipment;
}

async function mkRoute(name: string) {
  const [route] = await db.insert(s.routes).values({ name }).returning();
  routeIds.push(route.id);
  return route;
}

describe('listOpsOrders — route display semantics', () => {
  test('container-routed FCL lot shows the container route, not the shipment dash', async () => {
    const containerRoute = await mkRoute(`OpsR tuyến cont ${suffix}`);
    const lot = await mkLot({ code: `OPSR-C-${suffix}`, containers: [{ routeId: containerRoute.id }] });

    const orders = await listOpsOrders(1, '2026-09-14', lot.shipmentCode!);
    const row = orders.find((item) => item.id === lot.id);
    assert.ok(row);
    assert.equal(row.routeName, containerRoute.name);
  });

  test('distinct container routes join with " · "; NULL container routes contribute nothing', async () => {
    const routeA = await mkRoute(`OpsR tuyến A ${suffix}`);
    const routeB = await mkRoute(`OpsR tuyến B ${suffix}`);
    const shipmentRoute = await mkRoute(`OpsR tuyến lô ${suffix}`);
    const lot = await mkLot({
      code: `OPSR-M-${suffix}`,
      shipmentRouteId: shipmentRoute.id,
      containers: [{ routeId: routeA.id }, { routeId: routeB.id }, { routeId: null }],
    });

    const orders = await listOpsOrders(1, '2026-09-14', lot.shipmentCode!);
    const row = orders.find((item) => item.id === lot.id);
    assert.ok(row);
    assert.equal(row.routeName, `${routeA.name} · ${routeB.name}`);
  });

  test('route-less containers fall back to the shipment route; all-null stays null', async () => {
    const shipmentRoute = await mkRoute(`OpsR tuyến fallback ${suffix}`);
    const fallbackLot = await mkLot({ code: `OPSR-F-${suffix}`, shipmentRouteId: shipmentRoute.id, containers: [{ routeId: null }] });
    const nullLot = await mkLot({ code: `OPSR-N-${suffix}`, containers: [{ routeId: null }] });

    const fallbackOrders = await listOpsOrders(1, '2026-09-14', fallbackLot.shipmentCode!);
    const nullOrders = await listOpsOrders(1, '2026-09-14', nullLot.shipmentCode!);
    const fallbackRow = fallbackOrders.find((item) => item.id === fallbackLot.id);
    const nullRow = nullOrders.find((item) => item.id === nullLot.id);
    assert.equal(fallbackRow?.routeName, shipmentRoute.name);
    assert.equal(nullRow?.routeName, null);
  });
});

after(async () => {
  try {
    if (shipmentIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
    if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    if (cargoTypeIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  } catch (err) {
    console.warn('[ops-orders-route.test] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
