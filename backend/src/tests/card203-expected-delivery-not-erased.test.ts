// Card 20260929_203 — adding a container must not ERASE the shipment's
// expected delivery date.
//
// The column is a projection of the earliest per-container appointment (see
// shipment-containers.service.ts), so the write path recomputes it on every
// container change. Before the fix, that recompute also wrote `null` when no
// container had an appointment yet — silently destroying the date the create
// call had just written, and emptying /ops/orders (which filters on exactly
// this column) for every newly created shipment.
//
// RED-first: at HEAD this test fails on the "date survived" assertion.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createShipment } from '../services/shipment.service';
import { reconcileShipmentContainersInTx } from '../services/shipment-containers.service';
import { runInTx } from '../lib/tx';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const containerTypeIds: number[] = [];

async function makeCustomer() {
  const [row] = await db.insert(s.customers).values({ name: `Card203 khách ${suffix}` }).returning({ id: s.customers.id });
  customerIds.push(row.id);
  return row;
}

async function makeContainerType() {
  // container_types.code is varchar(20), so the code carries a short token and
  // the name carries the full unique suffix.
  const [row] = await db.insert(s.containerTypes)
    .values({ code: `C203-${suffix.slice(-6)}`, name: `Card203 ${suffix}` })
    .returning({ id: s.containerTypes.id });
  containerTypeIds.push(row.id);
  return row;
}

async function expectedDateOf(shipmentId: number): Promise<string | null> {
  const [row] = await db.select({ value: s.shipments.expectedDeliveryDate })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId));
  return row?.value ?? null;
}

before(async () => {
  await makeCustomer();
  await makeContainerType();
});

after(async () => {
  if (shipmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (containerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
});

describe('card 20260929_203 — a container write never erases the expected delivery date', () => {
  test('adding a container with no appointment leaves the stored date alone', async () => {
    const customer = customerIds[0];
    const shipment = await createShipment({ customerId: customer, cargoMode: 'FCL', expectedDeliveryDate: '2026-09-29' } as never);
    shipmentIds.push(shipment.id);

    assert.equal(await expectedDateOf(shipment.id), '2026-09-29', 'create writes the date');

    // The container has NO customerAppointmentAt, so the projection has nothing
    // to say — and must not say "null".
    await runInTx(undefined, (tx) => reconcileShipmentContainersInTx(tx, shipment.id, null, [{
      containerTypeId: containerTypeIds[0],
      containerNumber: `C203${suffix}`.slice(0, 12).toUpperCase(),
    }]));

    assert.equal(
      await expectedDateOf(shipment.id),
      '2026-09-29',
      'the date the create call wrote survived a container that carries no appointment',
    );
  });

  test('the projection still UPDATES the date when a container does have an appointment', async () => {
    const shipment = await createShipment({ customerId: customerIds[0], cargoMode: 'FCL', expectedDeliveryDate: '2026-09-29' } as never);
    shipmentIds.push(shipment.id);

    await runInTx(undefined, (tx) => reconcileShipmentContainersInTx(tx, shipment.id, null, [{
      containerTypeId: containerTypeIds[0],
      containerNumber: `C203B${suffix}`.slice(0, 12).toUpperCase(),
      customerAppointmentAt: '2026-10-05T03:00:00.000Z',
    }]));

    const after = await expectedDateOf(shipment.id);
    assert.ok(after, 'a dated container still gives the shipment a date');
    assert.match(after as string, /^2026-10-05$/, 'the projection still wins when it knows a date');
  });
});
