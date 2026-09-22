// Zone-surcharge ladder + 'Phí khác' 2-số pins (card _2).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { ZONE_SURCHARGE_KIND } from '../services/zone-surcharge.service';
import { shipmentDebitDetailSchema } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-zs-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const portIds: number[] = [];
const containerIds: number[] = [];
const tripIds: number[] = [];
const driverIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const fulfillmentIds: number[] = [];

async function mkLotWithZonePort(configAmount?: string): Promise<{ shipmentId: number; containerId: number }> {
  const [customer] = await db.insert(s.customers).values({ name: `ZS customer ${suffix} ${shipmentIds.length}` }).returning();
  customerIds.push(customer.id);
  const [zonePort] = await db.insert(s.ports).values({
    name: `ZS port ${suffix} ${portIds.length}`,
    code: `ZS-${portIds.length}-${Date.now().toString(36)}`,
    dispatchZone: 'LACH_HUYEN',
  }).returning();
  portIds.push(zonePort.id);
  if (configAmount != null) {
    await db.insert(s.portZoneSurcharges).values({
      portId: zonePort.id,
      kindSlug: ZONE_SURCHARGE_KIND,
      label: 'Lạch Huyện',
      amount: configAmount,
    });
  }
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `ZS-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: 1,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerNumber: `ZS${shipmentIds.length}${suffix.slice(-4)}`.toUpperCase(),
    pickupPortId: zonePort.id,
  }).returning();
  containerIds.push(container.id);
  return { shipmentId: shipment.id, containerId: container.id };
}

/** Fee-configured port helper (card 20260922_63 cases): zone is data; the
 *  optional amount seeds a per-port CONFIG row. */
async function mkPortWithFee(zone: 'LACH_HUYEN' | 'HAI_PHONG', amount?: string): Promise<number> {
  const [port] = await db.insert(s.ports).values({
    name: `ZS port ${suffix} ${portIds.length}`,
    code: `ZS-${portIds.length}-${Date.now().toString(36)}`,
    dispatchZone: zone,
  }).returning();
  portIds.push(port.id);
  if (amount != null) {
    await db.insert(s.portZoneSurcharges).values({
      portId: port.id,
      kindSlug: ZONE_SURCHARGE_KIND,
      label: 'Phí nâng/hạ Lạch Huyện',
      amount,
    });
  }
  return port.id;
}

/** One-container lot with explicit pickup/dropoff port ends. */
async function mkLotWithEnds(pickupPortId: number, dropoffPortId: number | null): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `ZS customer ${suffix} ${shipmentIds.length}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `ZS-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: 1,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerNumber: `ZS${shipmentIds.length}${suffix.slice(-4)}`.toUpperCase(),
    pickupPortId,
    dropoffPortId,
  }).returning();
  containerIds.push(container.id);
  return shipment.id;
}

after(async () => {
  try {
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.shipmentId, shipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, containerIds));
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds));
    await db.delete(s.portZoneSurcharges).where(inArray(s.portZoneSurcharges.portId, portIds));
    await db.delete(s.ports).where(inArray(s.ports.id, portIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  } catch { /* best-effort */ }
  await client.end();
  await disconnectRedis();
});

describe('zone-surcharge ladder', () => {
  test('CONFIG rung auto-fills with the config label and amount', async () => {
    const { shipmentId } = await mkLotWithZonePort('440000');
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Lạch Huyện', amount: 440000, source: 'CONFIG' });
    shipmentDebitDetailSchema.parse(detail);
  });

  test('CONFIG rung is per-lift (card 20260922_63 case 2): lift + drop both in-zone = 2×', async () => {
    const lift = await mkPortWithFee('LACH_HUYEN', '500000');
    const drop = await mkPortWithFee('LACH_HUYEN', '500000');
    const shipmentId = await mkLotWithEnds(lift, drop);
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Phí nâng/hạ Lạch Huyện', amount: 1000000, source: 'CONFIG' });
    shipmentDebitDetailSchema.parse(detail);
  });

  test('CONFIG rung per-lift (card 20260922_63 case 1): drop outside the fee zone = 1×', async () => {
    const lift = await mkPortWithFee('LACH_HUYEN', '500000');
    const drop = await mkPortWithFee('HAI_PHONG');
    const shipmentId = await mkLotWithEnds(lift, drop);
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Phí nâng/hạ Lạch Huyện', amount: 500000, source: 'CONFIG' });
    shipmentDebitDetailSchema.parse(detail);
  });

  test('CONFIG rung per-lift: same port for nâng + hạ counts 2 lifts', async () => {
    const port = await mkPortWithFee('LACH_HUYEN', '500000');
    const shipmentId = await mkLotWithEnds(port, port);
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Phí nâng/hạ Lạch Huyện', amount: 1000000, source: 'CONFIG' });
    shipmentDebitDetailSchema.parse(detail);
  });

  test('INCIDENTAL rung: driver-reported actuals win over the config amount', async () => {
    const { shipmentId } = await mkLotWithZonePort('440000');
    const [route] = await db.insert(s.routes).values({ name: `ZS route ${suffix}` }).returning();
    routeIds.push(route.id);
    const [cargo] = await db.insert(s.cargoTypes).values({ name: `ZS cargo ${suffix}` }).returning();
    cargoTypeIds.push(cargo.id);
    const [trip] = await db.insert(s.trips).values({
      tripCode: `ZS-T-${suffix}`.slice(0, 50),
      customerId: customerIds[0],
      routeId: route.id,
      cargoTypeId: cargo.id,
      shipmentId,
      status: 'COMPLETED',
      departureDate: '2026-09-20',
    }).returning();
    tripIds.push(trip.id);
    const [driver] = await db.insert(s.drivers).values({ name: `ZS driver ${suffix}` }).returning();
    driverIds.push(driver.id);
    await db.insert(s.driverIncidentalCosts).values({
      tripId: trip.id,
      driverId: driver.id,
      costType: 'LIFT_DROP_ZONE',
      amount: '120000',
      occurredAt: '2026-09-20',
    });

    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Lạch Huyện', amount: 120000, source: 'INCIDENTAL' });
  });

  test('OVERRIDE rung: dispatcher ops expense wins over both', async () => {
    const { shipmentId } = await mkLotWithZonePort('440000');
    await db.insert(s.opsExpenseEntries).values({
      shipmentId,
      expenseTypeCode: 'ZONE_SURCHARGE',
      amount: '250000',
      paidById: 1,
      paidAt: '2026-09-20',
    });

    const detail = await getShipmentDebitDetail(shipmentId);
    assert.deepEqual(detail.zoneSurcharge, { label: 'Lạch Huyện', amount: 250000, source: 'OVERRIDE' });
  });

  test('no source at all renders null — never a fabricated 0', async () => {
    const { shipmentId } = await mkLotWithZonePort();
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.equal(detail.zoneSurcharge, null);
    shipmentDebitDetailSchema.parse(detail);
  });

  test("'Phí khác' carries two numbers: buy in amount, sell in thuKhach", async () => {
    const { shipmentId, containerId } = await mkLotWithZonePort();
    const [route] = await db.insert(s.routes).values({ name: `ZS route2 ${suffix}` }).returning();
    routeIds.push(route.id);
    const [cargo] = await db.insert(s.cargoTypes).values({ name: `ZS cargo2 ${suffix}` }).returning();
    cargoTypeIds.push(cargo.id);
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      sourceShipmentVersion: 1,
    }).returning();
    fulfillmentIds.push(fulfillment.id);
    const [trip] = await db.insert(s.trips).values({
      tripCode: `ZS-T2-${suffix}`.slice(0, 50),
      customerId: customerIds[0],
      routeId: route.id,
      cargoTypeId: cargo.id,
      shipmentId,
      fulfillmentId: fulfillment.id,
      status: 'COMPLETED',
      departureDate: '2026-09-20',
    }).returning();
    tripIds.push(trip.id);
    // The 2.3 producer groups chi-hộ per CONTAINER — link the trip to the
    // lot's container so the row renders.
    await db.insert(s.tripContainers).values({
      tripId: trip.id,
      containerNumber: `ZS1${suffix.slice(-4)}`.toUpperCase(),
      sourceShipmentId: shipmentId,
      sourceShipmentContainerId: containerId,
    });
    const [fee] = await db.insert(s.tripExpenses).values({
      tripId: trip.id,
      expenseType: 'OTHER',
      feeName: 'Phí vệ sinh container',
      buyAmount: '500000',
      sellAmount: '300000',
      settlementMethod: 'COMPANY_DIRECT',
      approvalStatus: 'RECORDED',
    }).returning();

    const detail = await getShipmentDebitDetail(shipmentId);
    const row = detail.chiHoRows.find((entry) => entry.tripId === trip.id);
    assert.ok(row, 'the trip renders a chi-hộ row');
    const other = row.otherFees.find((entry) => entry.id === fee.id);
    assert.ok(other, 'the OTHER expense renders as a Phí khác row');
    assert.equal(other.amount, 500000);
    assert.equal(other.thuKhach, 300000);
    shipmentDebitDetailSchema.parse(detail);
  });
});
