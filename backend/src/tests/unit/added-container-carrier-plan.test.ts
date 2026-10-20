import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveAddedContainerCarrierPlan } from '../../services/added-container-carrier-plan';

/**
 * Card 201026124500 (181026185900 A.1) — the added container's Nhà xe copy
 * law. The wire's provided pair wins under the add wire's contract (EXPLICIT
 * NULL = deliberate carrier-less row, never re-inherited); an omitted pair
 * inherits the FIRST coherent sibling plan (per-column FIRST non-null, the
 * same rule the container-column inherit applies). Biển số/xe never ride —
 * the plan carries no plate/vehicle at all.
 */
const siblings = [
  { plannedCarrierType: null, plannedExternalCarrierId: null },
  { plannedCarrierType: 'OWN', plannedExternalCarrierId: null },
  { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: 9 },
];

test('A1-1: an omitted wire pair inherits the first coherent sibling plan', () => {
  assert.deepEqual(
    resolveAddedContainerCarrierPlan(undefined, siblings),
    { plannedCarrierType: 'OWN', plannedExternalCarrierId: null },
  );
});

test('A1-2: incoherent sibling halves (EXTERNAL without its carrier id) are skipped', () => {
  assert.deepEqual(
    resolveAddedContainerCarrierPlan(undefined, [
      { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: null },
      { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: 42 },
    ]),
    { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: 42 },
  );
});

test('A1-3: an empty or carrier-less lot resolves to no plan at all', () => {
  assert.equal(resolveAddedContainerCarrierPlan(undefined, []), null);
  assert.equal(resolveAddedContainerCarrierPlan(undefined, [
    { plannedCarrierType: null, plannedExternalCarrierId: null },
  ]), null);
});

test('A1-4: the provided pair wins over the inherited plan', () => {
  assert.deepEqual(
    resolveAddedContainerCarrierPlan({ carrierType: 'EXTERNAL', externalCarrierId: 7 }, siblings),
    { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: 7 },
  );
  assert.deepEqual(
    resolveAddedContainerCarrierPlan({ carrierType: 'OWN', externalCarrierId: null }, siblings),
    { plannedCarrierType: 'OWN', plannedExternalCarrierId: null },
  );
});

test('A1-5: an explicit null is a deliberate clear — never re-inherited', () => {
  assert.equal(
    resolveAddedContainerCarrierPlan({ carrierType: null, externalCarrierId: null }, siblings),
    null,
  );
});

test('A1-6: an incoherent provided pair never resolves to a plan', () => {
  assert.equal(
    resolveAddedContainerCarrierPlan({ carrierType: 'EXTERNAL', externalCarrierId: null }, siblings),
    null,
  );
  // OWN + stray carrier id is incoherent (the add wire's superRefine rejects
  // it too) — the resolver mirrors that strictness instead of silently
  // dropping the id.
  assert.equal(
    resolveAddedContainerCarrierPlan({ carrierType: 'OWN', externalCarrierId: 9 }, siblings),
    null,
  );
});

// The root-cause regression of ticket 201026124500 is a WIRING failure (the
// add flow minting a fulfillment without the plan), which pure-logic tests
// cannot see. Backend tests are unit-only (owner ruling 2026-10-19 — no DB
// import), so pin the wiring as a filesystem invariant like the other static
// source contracts: the add flow must pass the plan to the fulfillment birth,
// the birth must stamp it, and the plate/vehicle must never ride the copy.
test('A1-7: the fulfillment birth stamps the copied plan (source wiring pin)', () => {
  const writesSource = readFileSync(
    new URL('../../services/cus-shipment-workspace-writes.service.ts', import.meta.url),
    'utf8',
  );
  assert.ok(
    writesSource.includes('createFulfillmentForAddedContainer(tx, args.shipmentId, inserted!.id, args.actor.userId, carrierPlan)'),
    'addCusShipmentContainer must hand the resolved carrier plan to the fulfillment birth',
  );

  const fulfillmentSource = readFileSync(
    new URL('../../services/shipment-fulfillment.service.ts', import.meta.url),
    'utf8',
  );
  const birthStart = fulfillmentSource.indexOf('export async function createFulfillmentForAddedContainer');
  assert.ok(birthStart >= 0, 'createFulfillmentForAddedContainer must exist');
  const body = fulfillmentSource.slice(birthStart, fulfillmentSource.indexOf('\nexport ', birthStart + 10));
  assert.ok(body.includes('plannedCarrierType: plannedCarrier.plannedCarrierType'), 'the birth must stamp plannedCarrierType');
  assert.ok(body.includes('plannedExternalCarrierId:'), 'the birth must stamp plannedExternalCarrierId');
  assert.ok(!body.includes('plannedExternalCarrierVehicleId:'), 'Biển số/xe là per-truck entry — the copy must never stamp a vehicle');
  assert.ok(!body.includes('plannedVehiclePlateNumber:'), 'Biển số/xe là per-truck entry — the copy must never stamp a plate');
});
