/**
 * SIL-1238 (board 1483) — /shipments-debit Lớp tổng (KB Ch.2 §2.2.9, K2.74):
 * "lớp tổng (Tổng phải thu khách, Tổng phải trả, Chênh lệch) từ cả hai bảng
 * của lô". The summary layer's TỔNG PHẢI TRẢ must read the lot's REAL
 * payables sides (cước trả ĐV + chi hộ ops) with the debit-summary
 * knowns-sum precedent: a genuinely unknown side contributes nothing, and
 * the total goes null only when NOTHING is known — never a fabricated 0.
 *
 * Bug: every live row carried `payableTotal: null` because the old law
 * demanded BOTH sides known while the cước-trả side is known iff EVERY
 * active trip carries trip_carrier_info.external_freight_cost — on staging
 * (036a1acf, accountant hoapt) that nulled 754/754 rows (receivableTotal
 * nulled 515 where no revenue side is determined — that stays legal: a lot
 * with no determined revenue side reads blank, không bịa số).
 *
 * Static source pins + schema parse checks (BE unit tests are db-free per
 * the 2026-10-19 owner ruling).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentDebitSummaryItemSchema } from '@tingting/shared';

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

test('SIL-1238: the live TỔNG PHẢI TRẢ is the knowns-sum of the lot\'s two payables sides (K2.74)', () => {
  // K2.74 "từ cả hai bảng của lô": cước trả ĐV + chi hộ ops — knowns-sum,
  // debit-summary precedent (SIL-776 REV2).
  assert.match(source, /const payableKnown = knownSum\(externalFreight, opsTotal\);/);
  // The live branch emits the sum; null only when NOTHING is known.
  assert.match(source, /: payableKnown == null \? null : String\(payableKnown\);/);
});

test('SIL-1238: each side\'s own knownness law is preserved (known-iff-complete cước trả)', () => {
  // The per-side gates stay byte-for-byte: cước trả known iff every active
  // trip carries its cost (Bảng 2.3 composition), chi hộ ops known at ≥1 row.
  assert.match(source, /const externalFreight = carrier\?\.known \? carrier\.total : null/);
  assert.match(source, /const opsTotal = ops\?\.known \? ops\.total : null/);
});

test('SIL-1238: the old both-sides-must-be-known gate is gone', () => {
  assert.doesNotMatch(source, /externalFreight != null && opsTotal != null/);
  assert.doesNotMatch(source, /String\(externalFreight \+ opsTotal\)/);
});

test('SIL-1238: locked lots still read the frozen snapshot, CUS wire keeps giá vốn ẩn', () => {
  // The freeze path is untouched — missing snapshot keys read null.
  assert.match(source, /frozenNumber\(lock\.snapshot, 'payableTotal'\)/);
  // hideCost law (SIL-782 REV2) still strips the cost fields for the CUS role.
  assert.match(source, /const hideCost = query\.viewerRole === 'CUS';/);
  assert.match(source, /payableTotal: hideCost \? null : payableTotal/);
});

test('SIL-1238: the receivable law stays untouched — an undetermined revenue side reads null', () => {
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
