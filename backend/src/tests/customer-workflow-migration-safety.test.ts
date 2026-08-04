import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  customers: [] as number[],
  routes: [] as number[],
  cargoTypes: [] as number[],
  shipments: [] as number[],
  trips: [] as number[],
  milestones: [] as number[],
};

after(async () => {
  if (ids.milestones.length > 0) {
    await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.id, ids.milestones));
  }
  if (ids.trips.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
  }
  if (ids.shipments.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
  }
  if (ids.cargoTypes.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
  }
  if (ids.routes.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
  }
  if (ids.customers.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  }
  await client.end();
});

describe('customer workflow migration safety', () => {
  it('enforces the current shipment milestone uniqueness fence only for trip-derived rows', async () => {
    const indexRows = await client<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'shipment_milestones'
        and indexname = 'shipment_milestones_trip_type_uniq'
    `;
    assert.equal(indexRows.length, 1, 'expected the canonical shipment milestone uniqueness index');
    assert.match(indexRows[0]!.indexdef, /unique index .*shipment_milestones_trip_type_uniq/i);
    assert.match(indexRows[0]!.indexdef, /where .*trip_id.*is not null/i);

    const [customer] = await db.insert(s.customers)
      .values({ name: `Migration safety customer ${suffix}` })
      .returning({ id: s.customers.id });
    ids.customers.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `Migration safety route ${suffix}` })
      .returning({ id: s.routes.id });
    ids.routes.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes)
      .values({ name: `Migration safety cargo ${suffix}` })
      .returning({ id: s.cargoTypes.id });
    ids.cargoTypes.push(cargoType.id);
    const [shipment] = await db.insert(s.shipments)
      .values({
        shipmentCode: `MILESTONE-${suffix}`,
        customerId: customer.id,
        routeId: route.id,
        cargoTypeId: cargoType.id,
      })
      .returning({ id: s.shipments.id });
    ids.shipments.push(shipment.id);
    const [trip] = await db.insert(s.trips)
      .values({
        tripCode: `MILESTONE-TRIP-${suffix}`,
        shipmentId: shipment.id,
        customerId: customer.id,
        routeId: route.id,
        cargoTypeId: cargoType.id,
        departureDate: '2026-08-02',
      })
      .returning({ id: s.trips.id });
    ids.trips.push(trip.id);

    const [derived] = await db.insert(s.shipmentMilestones)
      .values({
        shipmentId: shipment.id,
        tripId: trip.id,
        type: 'DISPATCHED',
        occurredAt: new Date('2026-08-02T06:00:00.000Z'),
      })
      .returning({ id: s.shipmentMilestones.id });
    ids.milestones.push(derived.id);

    await assert.rejects(
      () => db.insert(s.shipmentMilestones).values({
        shipmentId: shipment.id,
        tripId: trip.id,
        type: 'DISPATCHED',
        occurredAt: new Date('2026-08-02T06:05:00.000Z'),
      }),
      (error: unknown) => (
        error instanceof Error
        && 'cause' in error
        && error.cause instanceof Error
        && /shipment_milestones_trip_type_uniq|duplicate key/i.test(error.cause.message)
      ),
    );

    const manualRows = await db.insert(s.shipmentMilestones)
      .values([
        {
          shipmentId: shipment.id,
          tripId: null,
          type: 'MANUAL',
          note: 'first manual note',
          occurredAt: new Date('2026-08-02T07:00:00.000Z'),
        },
        {
          shipmentId: shipment.id,
          tripId: null,
          type: 'MANUAL',
          note: 'second manual note',
          occurredAt: new Date('2026-08-02T07:05:00.000Z'),
        },
      ])
      .returning({ id: s.shipmentMilestones.id });
    ids.milestones.push(...manualRows.map((row) => row.id));
    assert.equal(manualRows.length, 2, 'manual milestones must stay append-only when tripId is null');
  });

  it('keeps the O2C baseline fence and orders additive readiness migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const migrationSql = await readFile(new URL('../../drizzle/0000_flexible-baseline.sql', import.meta.url), 'utf8');
    const orderExchangeSql = await readFile(new URL('../../drizzle/0003_majestic_clea.sql', import.meta.url), 'utf8');
    const journal = JSON.parse(await readFile(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as {
      entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    assert.deepEqual(journal.entries.map(({ idx, tag }) => ({ idx, tag })), [
      { idx: 0, tag: '0000_flexible-baseline' },
      { idx: 1, tag: '0001_backfill_shipment_readiness' },
      { idx: 2, tag: '0002_carrier_readiness_authorities' },
      { idx: 3, tag: '0003_majestic_clea' },
    ]);
    assert.match(migrationSql, /CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq"/);
    assert.doesNotMatch(migrationSql, /FOREIGN KEY|\bCHECK\s*\(/i);
    assert.match(orderExchangeSql, /ADD COLUMN "order_exchange_started_at" timestamp with time zone/);
    assert.match(orderExchangeSql, /ADD COLUMN "order_exchange_completed_at" timestamp with time zone/);
    assert.doesNotMatch(orderExchangeSql, /DROP|NOT NULL|FOREIGN KEY|\bCHECK\s*\(/i);
  });
});
