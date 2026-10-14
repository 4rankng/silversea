/**
 * FB-086 (round 19, ticket 131026201000) — quick-added container inherits
 * the lot's own values.
 *
 * Contract: an added container rides the lot like a create-time row rides
 * the previous row in the create form (createContainerFromPrevious): type,
 * route, ports, factory and the customer appointment default from the first
 * non-null sibling when the add input omits them; an explicit input value
 * still wins. The schedule projection then shows the new row's line in the
 * overview immediately.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role, calculateCheckDigit } from '@tingting/shared';
import { addCusShipmentContainer } from '../services/cus-shipment-workspace-writes.service';
import type { AuthUser } from '../middleware/auth';

const suffix = `q86-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  siteIds: [] as number[],
  portIds: [] as number[],
  routeIds: [] as number[],
  containerTypeIds: [] as number[],
  shipmentIds: [] as number[],
  containerIds: [] as number[],
  fulfillmentIds: [] as number[],
};

const numberWithCheckDigit = (base10: string) => `${base10}${calculateCheckDigit(base10)}`;

const actor = {
  userId: 0,
  username: 'q86-cus',
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
  const [customer] = await db.insert(s.customers).values({ name: `Q86 customer ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q86 route ${suffix}` }).returning();
  created.routeIds.push(route.id);
  const [factory] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `Q86F${suffix.slice(-5)}`,
    name: `Q86 nhà máy ${suffix}`,
    siteType: 'FACTORY',
    address: `Địa chỉ Q86 ${suffix}`,
    isActive: true,
    routeId: route.id,
  }).returning();
  created.siteIds.push(factory.id);
  const [liftPort] = await db.insert(s.ports).values({ code: `Q86A${suffix.slice(-4)}`, name: `Q86 cảng nâng ${suffix}` }).returning();
  const [dropPort] = await db.insert(s.ports).values({ code: `Q86B${suffix.slice(-4)}`, name: `Q86 cảng hạ ${suffix}` }).returning();
  created.portIds.push(liftPort.id, dropPort.id);
  const [containerType] = await db.insert(s.containerTypes).values({ code: `Q86T${suffix.slice(-4)}`, name: `Q86 type ${suffix}` }).returning();
  created.containerTypeIds.push(containerType.id);

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    blNumber: `Q86-BL-${suffix.slice(-8)}`,
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
  }).returning();
  shipmentId = shipment.id;
  created.shipmentIds.push(shipment.id);

  // The fully-populated create-time sibling the add should mirror.
  const [sibling] = await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerNumber: numberWithCheckDigit('QKGA000001'),
    containerTypeId: containerType.id,
    routeId: route.id,
    pickupPortId: liftPort.id,
    dropoffPortId: dropPort.id,
    operationalSiteId: factory.id,
    customerAppointmentAt: new Date('2026-10-20T01:00:00+00:00'),
  }).returning({ id: s.shipmentContainers.id });
  siblingContainerId = sibling.id;
  created.containerIds.push(sibling.id);
});

after(async () => {
  await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, shipmentId));
  await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipmentId));
  await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
  if (created.containerTypeIds.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, created.containerTypeIds));
  if (created.portIds.length) await db.delete(s.ports).where(inArray(s.ports.id, created.portIds));
  if (created.siteIds.length) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, created.siteIds));
  if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});

describe('quick-add container inherits the lot (FB-086, round 19)', () => {
  test('an omitted column falls back to the first non-null sibling value', async () => {
    const addedNumber = numberWithCheckDigit('QKGB000002');
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
      containerTypeId: s.shipmentContainers.containerTypeId,
      routeId: s.shipmentContainers.routeId,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
      operationalSiteId: s.shipmentContainers.operationalSiteId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    const [sibling] = await db.select({
      containerTypeId: s.shipmentContainers.containerTypeId,
      routeId: s.shipmentContainers.routeId,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
      operationalSiteId: s.shipmentContainers.operationalSiteId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, siblingContainerId));

    // Same lot data as the create-time sibling — TC-R19-ADD-01.
    assert.equal(row.containerTypeId, sibling.containerTypeId);
    assert.equal(row.routeId, sibling.routeId);
    assert.equal(row.pickupPortId, sibling.pickupPortId);
    assert.equal(row.dropoffPortId, sibling.dropoffPortId);
    assert.equal(row.operationalSiteId, sibling.operationalSiteId);
    // The appointment rides too (create-time rows ride the previous row's
    // window), so the overview schedule gains the new line at once.
    assert.deepEqual(row.customerAppointmentAt, sibling.customerAppointmentAt);

    // The read model the drawer renders carries the inherited columns.
    assert.equal(line.containerTypeId, sibling.containerTypeId);
    assert.equal(line.routeId, sibling.routeId);
    assert.equal(line.liftSiteId, sibling.pickupPortId);
    assert.equal(line.dropoffSiteId, sibling.dropoffPortId);

    // Its own fulfillment exists so dispatch sees the row.
    const [fulfillment] = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentContainerId, line.id));
    assert.ok(fulfillment);
    created.fulfillmentIds.push(fulfillment.id);

    // Inherited appointments keep the lot's schedule projection intact.
    const [shipmentRow] = await db.select({ expectedDeliveryDate: s.shipments.expectedDeliveryDate })
      .from(s.shipments).where(eq(s.shipments.id, shipmentId));
    assert.equal(shipmentRow.expectedDeliveryDate?.toString().slice(0, 10), '2026-10-20');
  });

  test('an explicit add input still overrides the lot default', async () => {
    const [ownType] = await db.insert(s.containerTypes).values({ code: `Q86U${suffix.slice(-4)}`, name: `Q86 override ${suffix}` }).returning();
    created.containerTypeIds.push(ownType.id);
    const addedNumber = numberWithCheckDigit('QKGC000003');
    const { line } = await addCusShipmentContainer({
      shipmentId,
      input: {
        containerNumber: addedNumber,
        expectedShipmentVersion: await currentShipmentVersion(),
        containerTypeId: ownType.id,
        customerAppointmentAt: '2026-10-22T02:30:00+07:00',
      } as never,
      actor,
    });
    created.containerIds.push(line.id);

    const [row] = await db.select({
      containerTypeId: s.shipmentContainers.containerTypeId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    assert.equal(row.containerTypeId, ownType.id);
    assert.equal(row.customerAppointmentAt?.toISOString(), '2026-10-21T19:30:00.000Z');
    // Columns the input still omits keep inheriting.
    const [sibling] = await db.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, siblingContainerId));
    const [inheritRow] = await db.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    assert.equal(inheritRow.routeId, sibling.routeId);
  });

  // Round-19 review m1: the shared schema accepts explicit nulls on every
  // inheritable column. Wire contract: undefined = inherit, explicit null =
  // deliberate clear (the pre-inheritance behavior), so an API caller can
  // still add a deliberately appointment-less row.
  test('an explicit null clears instead of inheriting (wire contract)', async () => {
    const addedNumber = numberWithCheckDigit('QKGD000004');
    const { line } = await addCusShipmentContainer({
      shipmentId,
      input: {
        containerNumber: addedNumber,
        expectedShipmentVersion: await currentShipmentVersion(),
        routeId: null,
        customerAppointmentAt: null,
      } as never,
      actor,
    });
    created.containerIds.push(line.id);
    const [row] = await db.select({
      routeId: s.shipmentContainers.routeId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    assert.equal(row.routeId, null);
    assert.equal(row.customerAppointmentAt, null);
  });

  // Determinism pin: siblings that disagree resolve to the FIRST non-null
  // value in id order, and the deliberately NOT-inherited columns stay null.
  test('sibling disagreement resolves to the first non-null row by id; weights never inherit', async () => {
    // A later sibling with a different route (inserted after the first).
    const [otherRoute] = await db.insert(s.routes).values({ name: `Q86 other route ${suffix}` }).returning();
    created.routeIds.push(otherRoute.id);
    const [later] = await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerNumber: numberWithCheckDigit('QKGE000005'),
      routeId: otherRoute.id,
      cargoWeightKg: '9999.00',
      cargoVolumeCbm: '12.000',
    }).returning({ id: s.shipmentContainers.id });
    created.containerIds.push(later.id);

    const addedNumber = numberWithCheckDigit('QKGF000006');
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
      routeId: s.shipmentContainers.routeId,
      cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      cargoVolumeCbm: s.shipmentContainers.cargoVolumeCbm,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.id, line.id));
    const [firstSibling] = await db.select({ routeId: s.shipmentContainers.routeId })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, siblingContainerId));
    // The FIRST sibling's route wins, not the later row's.
    assert.equal(row.routeId, firstSibling.routeId);
    assert.notEqual(row.routeId, otherRoute.id);
    // Cargo metrics are per-container facts — they never ride the lot.
    assert.equal(row.cargoWeightKg, null);
    assert.equal(row.cargoVolumeCbm, null);
  });
});
