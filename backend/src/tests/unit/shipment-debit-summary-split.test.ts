/**
 * Redesign 23/10 (owner spec v2 (a) — 'Chi hãng tàu' / 'Chi nội địa' columns):
 * the L1 summary must ship the payableTotal SPLIT beside the total, so the
 * board can render the cost columns without deriving them. Static source pin
 * (the backend tests are unit-only by the 2026-10-19 owner ruling — no DB/app
 * fixtures here; the E2E identity check lives in qa/scripts/).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');

test('ships carrierCostTotal from the carrier (externalFreight) leg, null when unknown', () => {
  assert.match(source, /carrierCostTotal:\s*externalFreight == null \? null : String\(externalFreight\)/);
  // The carrier leg is unknown while any active trip lacks its cost — the
  // same `known` gate the payableTotal composition uses.
  assert.match(source, /const externalFreight = carrier\?\.known \? carrier\.total : null/);
});

test('ships opsCostTotal from the live ops leg, null when unknown', () => {
  assert.match(source, /opsCostTotal:\s*opsTotal == null \? null : String\(opsTotal\)/);
  assert.match(source, /const opsTotal = ops\?\.known \? ops\.total : null/);
});

test('keeps the split ADDITIVE — payableTotal itself is untouched', () => {
  // The frozen/live payable law stays byte-for-byte: locked lots read the
  // snapshot, live lots read externalFreight + opsTotal.
  assert.match(source, /: externalFreight != null && opsTotal != null\s*\?\s*String\(externalFreight \+ opsTotal\)/);
});

const baseRow = {
  customerId: null, shipmentId: 1, code: 'S', customerName: null, factoryName: null,
  factoryAddress: null, billOrBookNumber: null, customsNumber: null, documentsSummary: null,
  freightAuto: null, freightOverrideReason: null, chiHoTotal: null, receivableTotal: null,
  payableTotal: null, profit: null, lockStatus: 'OPEN', lockedAt: null,
  cargoWeightKg: null, cargoVolumeCbm: null, cargoMode: null, costGroupId: null,
  costGroupOrder: null, revGroupId: null, revGroupOrder: null, costGroupMemberCount: null,
  revGroupMemberCount: null, actualTruckNo: null, billingTruckNo: null,
  costVehicleClassCode: null, revVehicleClassCode: null, revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
} as const;

test('the shared zod contract keeps the split fields optional + nullable (skew-safe like GP-01)', () => {
  // An older response (no split fields) still parses — the FE renders
  // a blank cell instead of failing.
  const legacy = shipmentDebitSummaryItemSchema.safeParse(baseRow);
  assert.equal(legacy.success, true);
  if (legacy.success) assert.equal(legacy.data.carrierCostTotal ?? null, null);
  const withSplit = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 2, lockStatus: 'LOCKED', carrierCostTotal: '1250000.00', opsCostTotal: '0',
  });
  assert.equal(withSplit.success, true);
  if (withSplit.success) assert.equal(withSplit.data.opsCostTotal, '0');
});
