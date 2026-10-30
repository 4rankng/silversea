/**
 * SIL-478 (2026-10-25) — the L1 summary ships the phone row's meta facts:
 * the lot's expected delivery date and its active container count, so the
 * grouped row's second line renders "Số Bill · ngày giao · n cont" from wire
 * data instead of a blank. Static source pin + schema parse checks (the
 * backend tests are unit-only by the 2026-10-19 owner ruling — no DB/app
 * fixtures here; the E2E identity check lives in qa/scripts/).
 *
 * SIL-601 (id 702, owner ruling 30/10/2026) supersedes the Σ semantics for
 * LCL only: one LCL lot ≡ 1-cont lot ("không phải 0 cont, không phải nhiều
 * cont") — the projection routes LCL through the shared count law while FCL
 * keeps the active-trip Σ.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');

test('selects the lot delivery date the list already orders by', () => {
  assert.match(source, /expectedDeliveryDate:\s*s\.shipments\.expectedDeliveryDate/);
});

test('sums container_count over the ACTIVE trip scope (non-deleted, non-CANCELED)', () => {
  // One aggregate beside the existing trip count — same scope, one query.
  assert.match(source, /containers:\s*sql<number>`coalesce\(sum\(\$\{s\.trips\.containerCount\}\), 0\)::int`/);
  const countBlock = source.slice(source.indexOf('const tripCountRows'), source.indexOf('const containerCountByLot'));
  assert.match(countBlock, /isNull\(s\.trips\.deletedAt\)/);
  assert.match(countBlock, /ne\(s\.trips\.status,\s*'CANCELED'\)/);
  // NOT the chốt scope: the container count describes the lot's cargo, so it
  // must not require fulfillment (the shadow-line law stays on the money).
  assert.doesNotMatch(countBlock, /fulfillmentId/);
});

test('maps deliveryDate + containerCount under the SIL-601 LCL count law', () => {
  assert.match(source, /deliveryDate:\s*lot\.expectedDeliveryDate \?\? null/);
  // SIL-601 (id 702): the lot's cont count routes through the shared law
  // (LCL ≡ 1 cont, never 0/Σ); the FCL value keeps the active-trip Σ with
  // the null-when-no-trips missing semantics.
  assert.match(source, /containerCount:\s*effectiveLotContainerCount\(lot\.cargoMode, tripCountByLot\.has\(lot\.id\) \? \(containerCountByLot\.get\(lot\.id\) \?\? null\) : null\)/);
});

const baseRow = {
  customerId: null, shipmentId: 1, code: 'S', customerName: null, factoryName: null,
  factoryAddress: null, billOrBookNumber: null, customsNumber: null, documentsSummary: null,
  freightAuto: null, freightOverrideReason: null, chiHoTotal: null, receivableTotal: null,
  payableTotal: null, profit: null, lockStatus: 'OPEN' as const, lockedAt: null,
  cargoWeightKg: null, cargoVolumeCbm: null, cargoMode: null, costGroupId: null,
  costGroupOrder: null, revGroupId: null, revGroupOrder: null, costGroupMemberCount: null,
  revGroupMemberCount: null, actualTruckNo: null, billingTruckNo: null,
  costVehicleClassCode: null, revVehicleClassCode: null, revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
};

test('the shared zod contract keeps the meta fields optional + nullable (skew-safe)', () => {
  // An older response (no meta fields) still parses — the FE drops the
  // segments instead of failing.
  const older = shipmentDebitSummaryItemSchema.safeParse(baseRow);
  assert.equal(older.success, true);
});

test('the meta fields accept the populated wire shape and reject junk', () => {
  const full = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, deliveryDate: '2026-10-06', containerCount: 2,
  });
  assert.equal(full.success, true);
  if (full.success) {
    assert.equal(full.data.deliveryDate, '2026-10-06');
    assert.equal(full.data.containerCount, 2);
  }
  const junk = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, containerCount: 1.5,
  });
  assert.equal(junk.success, false);
});
