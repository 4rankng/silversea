/**
 * Redesign 23/10 (owner spec v2 (a) — 'Chi hãng tàu' / 'Chi nội địa' columns):
 * the L1 summary must ship the payableTotal SPLIT beside the total, so the
 * board can render the cost columns without deriving them. Static source pin
 * (the backend tests are unit-only by the 2026-10-19 owner ruling — no DB/app
 * fixtures here; the E2E identity check lives in qa/scripts/).
 *
 * SIL-782 REV2 (ticket-v2 Phần VI mục 2, 09/11/2026): the split survives, but
 * the CUS wire strips it (`hideCost`) — giá vốn ẩn 100% khỏi bảng quyết toán
 * CUS (see shipment-debit-summary-sil782.test.ts).
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
  // REV2 — the emitted line carries the CUS strip prefix (`hideCost ||`).
  assert.match(source, /carrierCostTotal:\s*hideCost \|\| externalFreight == null \? null : String\(externalFreight\)/);
  // SIL-1238 r2 — the leg is the row-grained known sum (Σ priced trips; an
  // unpriced trip contributes nothing, never blanks its priced siblings).
  assert.match(source, /const externalFreight = payables\.carrierCostTotal;/);
});

test('ships opsCostTotal from the live ops leg, null when unknown', () => {
  assert.match(source, /opsCostTotal:\s*hideCost \|\| opsTotal == null \? null : String\(opsTotal\)/);
  assert.match(source, /const opsTotal = payables\.opsCostTotal;/);
});

test('SIL-1238 (K2.74): the split stays ADDITIVE into a knowns-sum payableTotal', () => {
  // SIL-1238 r2: the total is the knowns-sum of the SAME two components the
  // split ships — for locked and open lots alike (row law, lock-blind). An
  // unknown component contributes nothing to the sum, and the total goes
  // null only when NOTHING is known (never a fabricated 0).
  assert.match(source, /const payableTotal = payables\.payableTotal == null \? null : String\(payables\.payableTotal\);/);
  // The bounce's freeze gate (and the old both-sides-must-be-known gate that
  // nulled 754/754 rows) are both gone.
  assert.doesNotMatch(source, /frozenNumber\(lock\.snapshot, 'payableTotal'\)/);
  assert.doesNotMatch(source, /externalFreight != null && opsTotal != null/);
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
