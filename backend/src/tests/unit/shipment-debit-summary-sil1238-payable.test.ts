/**
 * SIL-1238 (board 1483) — /shipments-debit Lớp tổng (KB Ch.2 §2.2.9, K2.74):
 * "lớp tổng (Tổng phải thu khách, Tổng phải trả, Chênh lệch) tính từ cả hai
 * bảng của lô". The summary layer's TỔNG PHẢI TRẢ is the knowns-sum of the
 * lot's payable-side cost ROWS (cước trả ĐV + chi hộ ops): known rows sum,
 * a row without a recorded amount contributes nothing (never invented), and
 * the total goes null ONLY when no payable-side row is known — never a
 * fabricated 0.
 *
 * Round 1 (65cd5d70) still failed QA on build 61999831 — payableTotal null
 * 707/765 (92%), 0/45 LOCKED lots with a total despite real rows carried in
 * the same response (MATS8322408000 ops 1.600.000₫ etc.). Two drop sources:
 * (1) locked lots read only the snapshot's `payableTotal` key (frozen under
 * the old both-sides-must-be-known law, absent on legacy locks); (2) the
 * carrier leg was known-iff-every-active-trip, dropping every known row of a
 * partially priced lot. Round 2 replaces both with the lock-blind row law
 * pinned below.
 *
 * Behavioral pins on the pure `composeLotPayableCosts` + static wiring pins
 * (BE unit tests are db-free per the 2026-10-19 owner ruling).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';
import { composeLotPayableCosts } from '../../services/shipment-debit-summary.service';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');

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

test('SIL-1238 r2: a LOCKED lot with ops costs sums — the lock never gates the total (QA repro MATS8322408000)', () => {
  const lot = composeLotPayableCosts({
    carrierCostRows: [],
    opsCostRows: [{ amount: '1600000' }],
  });
  assert.equal(lot.carrierCostTotal, null);
  assert.equal(lot.opsCostTotal, 1_600_000);
  assert.equal(lot.payableTotal, 1_600_000, 'TỔNG PHẢI TRẢ = 1.600.000 (ops 1.600.000₫ carried in the response)');
  // Chênh lệch derives FE-side from the two wire strings: receivable
  // 5.682.000 − payable 1.600.000 = 4.082.000 (QA's expected delta).
  // Wiring: the composition is lock-blind — every lot (lockStatus LOCKED or
  // OPEN) routes through the SAME call, and the bounce's freeze read is gone.
  assert.match(source, /composeLotPayableCosts\(\{\s*carrierCostRows: carrierRowsByLot\.get\(lot\.id\) \?\? \[\],\s*opsCostRows: opsRowsByLot\.get\(lot\.id\) \?\? \[\],\s*\}\)/);
  assert.doesNotMatch(source, /frozenNumber\(lock\.snapshot, 'payableTotal'\)/);
});

test('SIL-1238 r2: a lot with NO known payable rows reads null — never a fabricated 0', () => {
  const empty = composeLotPayableCosts({ carrierCostRows: [], opsCostRows: [] });
  assert.equal(empty.carrierCostTotal, null);
  assert.equal(empty.opsCostTotal, null);
  assert.equal(empty.payableTotal, null);
  const allUnknown = composeLotPayableCosts({
    carrierCostRows: [{ externalFreightCost: null }, { externalFreightCost: '' }],
    opsCostRows: [],
  });
  assert.equal(allUnknown.carrierCostTotal, null, 'a row with no recorded amount is unknown — never invented');
  assert.equal(allUnknown.payableTotal, null);
});

test('SIL-1238 r2: known rows sum row by row — an unknown row contributes nothing', () => {
  // A partially priced lot keeps its priced rows (the bounce's
  // known-iff-every-trip gate dropped them all).
  const partial = composeLotPayableCosts({
    carrierCostRows: [{ externalFreightCost: '1000000' }, { externalFreightCost: null }, { externalFreightCost: '600000' }],
    opsCostRows: [],
  });
  assert.equal(partial.carrierCostTotal, 1_600_000);
  assert.equal(partial.payableTotal, 1_600_000);
  // Card 20260928_181 — a negative ops row behaves as absent for money while
  // the row still arms the side (an all-negative lot reads a known 0).
  const negativeOps = composeLotPayableCosts({
    carrierCostRows: [],
    opsCostRows: [{ amount: '-500' }],
  });
  assert.equal(negativeOps.opsCostTotal, 0);
  assert.equal(negativeOps.payableTotal, 0, 'a computed 0 is a value — never blank');
});

test('SIL-1238 r2: previously-working shapes unchanged (both sides, ops-only, carrier-only)', () => {
  const both = composeLotPayableCosts({
    carrierCostRows: [{ externalFreightCost: '2000000' }, { externalFreightCost: '1000000' }],
    opsCostRows: [{ amount: '50000' }],
  });
  assert.equal(both.carrierCostTotal, 3_000_000);
  assert.equal(both.opsCostTotal, 50_000);
  assert.equal(both.payableTotal, 3_050_000, 'the knowns-sum of both sides');
  // QA-QUICK-FCL-R4C / KB172-01 shapes: a known single side reads its sum.
  const opsOnly = composeLotPayableCosts({ carrierCostRows: [], opsCostRows: [{ amount: '27382' }] });
  assert.equal(opsOnly.payableTotal, 27_382);
  const carrierOnly = composeLotPayableCosts({
    carrierCostRows: [{ externalFreightCost: '1800000' }],
    opsCostRows: [],
  });
  assert.equal(carrierOnly.payableTotal, 1_800_000);
});

test('SIL-1238 r2: each side keeps its own row knownness — one unknown side never blanks the total', () => {
  // Cruise trả unknown (no priced trip) + ops known → the ops sum (not null).
  const opsArms = composeLotPayableCosts({
    carrierCostRows: [{ externalFreightCost: null }],
    opsCostRows: [{ amount: '35128' }],
  });
  assert.equal(opsArms.carrierCostTotal, null);
  assert.equal(opsArms.payableTotal, 35_128);
});

test('SIL-1238 r2: hideCost (SIL-782 REV2) and the receivable law stay untouched', () => {
  assert.match(source, /const hideCost = query\.viewerRole === 'CUS';/);
  assert.match(source, /payableTotal: hideCost \? null : payableTotal/);
  assert.match(source, /receivableTotal: receivableValue == null \? null : String\(receivableValue\)/);
});

test('SIL-1238: the wire contract carries the payable as a nullable money string — FE derives Chênh lệch', () => {
  // A payable-only row parses (the receivable side stays blank upstream);
  // money rides the wire as a string, never a number.
  const payableOnly = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 2, receivableTotal: null, payableTotal: '900000',
  });
  assert.equal(payableOnly.success, true);
  if (payableOnly.success) assert.equal(payableOnly.data.payableTotal, '900000');
  const both = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 3, receivableTotal: '1200000', payableTotal: '900000',
  });
  assert.equal(both.success, true);
  const junk = shipmentDebitSummaryItemSchema.safeParse({
    ...baseRow, shipmentId: 4, payableTotal: 900000,
  });
  assert.equal(junk.success, false, 'money rides the wire as a string, never a number');
});
