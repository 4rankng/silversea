/**
 * Card 181026185900 A.1+A.6 — quick-add copies EVERY other field down to the
 * new row (only Số container and Loại container stay the operator's own).
 *
 * Contract: FB-086 round 19 already inherited type/route/ports/factory/
 * appointment; the customer's follow-up names the fields the flat workboard
 * still showed EMPTY on the added row — the per-container tờ khai, the
 * container-level hãng tàu, and the ad-hoc free-text ports/factory/route.
 * An added container rides the lot's first non-null sibling value for every
 * inheritable column; explicit input still wins and cargo metrics still
 * never ride (pinned by container-quickadd-inherit-lot.test.ts).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role, calculateCheckDigit } from '@tingting/shared';
import { addCusShipmentContainer } from '../services/cus-shipment-workspace-writes.service';
import type { AuthUser } from '../middleware/auth';

const suffix = `qA1-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  portIds: [] as number[],
  shipmentIds: [] as number[],
  containerIds: [] as number[],
  fulfillmentIds: [] as number[],
};

const numberWithCheckDigit = (base10: string) => `${base10}${calculateCheckDigit(base10)}`;

const actor = {
  userId: 0,
  username: `qA1-cus-${suffix}`,
  role: Role.CUS,
  customerId: null,
  customerIds: [],
} as unknown as AuthUser;

let shipmentId = 0;
let siblingContainerId = 0;

async function currentShipmentVersion(): Promise<number> {
  const [row] = await db.select({ version: s.shipments.version })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId));
  return row.version;
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `QA1 customer ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [liftPort] = await db.insert(s.ports).values({ code: `AA1P${suffix.slice(-4)}a`, name: `QA1 cảng nâng ${suffix}` }).returning();
  const [dropPort] = await db.insert(s.ports).values({ code: `AA1P${suffix.slice(-4)}b`, name: `QA1 cảng hạ ${suffix}` }).returning();
  created.portIds.push(liftPort.id, dropPort.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    blNumber: `QA1-BL-${suffix.slice(-8)}`,
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    status: 'PENDING_DATE',
  }).returning();
  shipmentId = shipment.id;
  created.shipmentIds.push(shipment.id);

  // The fully-worded sibling the add must mirror, document fields included.
  const [sibling] = await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerNumber: numberWithCheckDigit('QAAB000001'),
    declarationNumber: `TK-QA1-${suffix.slice(-8)}`,
    shippingLineName: `Hãng tàu QA1 ${suffix}`,
    rawPickupPortName: `Cảng nâng tự do QA1 ${suffix}`,
    rawDropoffPortName: `Cảng hạ tự do QA1 ${suffix}`,
    rawFactoryName: `Nhà máy tự do QA1 ${suffix}`,
    rawRouteName: `Tuyến tự do QA1 ${suffix}`,
    customerAppointmentAt: new Date('2026-10-25T01:30:00+00:00'),
  }).returning({ id: s.shipmentContainers.id });
  siblingContainerId = sibling.id;
  created.containerIds.push(sibling.id);
});

after(async () => {
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, shipmentId));
  await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipmentId));
  await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
  if (created.portIds.length) await db.delete(s.ports).where(inArray(s.ports.id, created.portIds));
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});

describe('quick-add copies every inheritable field (card A.1+A.6)', () => {
  test('the added row inherits tờ khai, hãng tàu and ad-hoc free text from the lot', async () => {
    const addedNumber = numberWithCheckDigit('QAAA000002');
    const { line } = await addCusShipmentContainer({
      shipmentId,
      input: {
        containerNumber: addedNumber,
        expectedShipmentVersion: await currentShipmentVersion(),
      } as never,
      actor,
    });
    created.containerIds.push(line.id);

    const [row] = await db.select({
      declarationNumber: s.shipmentContainers.declarationNumber,
      shippingLineName: s.shipmentContainers.shippingLineName,
      rawPickupPortName: s.shipmentContainers.rawPickupPortName,
      rawDropoffPortName: s.shipmentContainers.rawDropoffPortName,
      rawFactoryName: s.shipmentContainers.rawFactoryName,
      rawRouteName: s.shipmentContainers.rawRouteName,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    const [sibling] = await db.select({
      declarationNumber: s.shipmentContainers.declarationNumber,
      shippingLineName: s.shipmentContainers.shippingLineName,
      rawPickupPortName: s.shipmentContainers.rawPickupPortName,
      rawDropoffPortName: s.shipmentContainers.rawDropoffPortName,
      rawFactoryName: s.shipmentContainers.rawFactoryName,
      rawRouteName: s.shipmentContainers.rawRouteName,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, siblingContainerId));

    // The workboard's Chứng từ & hãng tàu columns fill themselves in — the
    // operator typed only the container number (type omitted → also rides).
    assert.equal(row.declarationNumber, sibling.declarationNumber);
    assert.equal(row.shippingLineName, sibling.shippingLineName);
    assert.equal(row.rawPickupPortName, sibling.rawPickupPortName);
    assert.equal(row.rawDropoffPortName, sibling.rawDropoffPortName);
    assert.equal(row.rawFactoryName, sibling.rawFactoryName);
    assert.equal(row.rawRouteName, sibling.rawRouteName);

    // The returned line (what both CUS surfaces re-render) already carries it.
    assert.equal(line.declarationNumber, sibling.declarationNumber);
  });
});
