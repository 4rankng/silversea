// SIL-693 (id 805) — completed-trip pricing carve-out pins (source-scan,
// unit-only tree: no db connection, no app boot). The QA-verified dead-end:
// a lot whose trip COMPLETED could never be priced (every rev-class write
// 409'd "đã hoàn thành chuyến"), so the remedy the unpriced-debit-note guard
// promises ("xác định giá trên Quyết toán rồi khóa lại") was unreachable and
// the lot stayed locked + unpriced + un-exportable forever. These pins hold
// the new law: the per-lot outputs price completed trips, the merge/assign
// sibling law does NOT move, and every completed-trip write lands in the
// audit trail with a reason + completed-trip marker.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/lcl-grouping.service.ts'), 'utf8');
const schema = readFileSync(join(here, '../../../../shared/src/schemas/lcl-grouping.ts'), 'utf8');

// Four lockstep slices of the SAME per-lot function — one seam, all pins.
const perLot = () => svc.slice(
  svc.indexOf('export async function setLclLotRevClass'),
  svc.indexOf('export async function updateLclGroupTruck'),
);

test('SIL-693: per-lot pricing no longer throws the completed-trip 409', () => {
  const slice = perLot();
  // The dead-end message is gone from the per-lot outputs entirely.
  assert.doesNotMatch(slice, /không đổi loại xe\/giá cước thu được nữa/);
  assert.doesNotMatch(slice, /trip\.status === 'COMPLETED'\)[\s\S]{0,120}throw new ApiError\(409/);
});

test('SIL-693: completed-trip carve-out derives reason + marker for the audit trail', () => {
  const slice = perLot();
  assert.match(slice, /const completedTrip = trip != null && trip\.status === 'COMPLETED';/);
  // Kèm lý do: the operator's reason when supplied, a deterministic default
  // otherwise — the existing Quyết toán UI sends no reason field, so the
  // remedy must not depend on one.
  assert.match(slice, /const completedTripReason = input\.reason\?\.trim\(\)\s*\n\s*\|\|/);
  assert.match(slice, /Định giá bù trên lô đã hoàn thành chuyến/);
  // + audit: all three audit call sites (clear / lane-miss / money) carry the
  // completed-trip marker with the reason.
  const auditSpread = '...(completedTrip ? { completedTrip: true, completedTripId: trip?.tripId ?? null, completedTripReason } : {})';
  const auditSpreads = slice.split(auditSpread).length - 1;
  assert.equal(auditSpreads, 3, 'all three auditGroupChange sites must mark a completed trip');
});

test('SIL-693: completed-trip pricing rides the SAME trip override money channel', () => {
  const slice = perLot();
  // Live trip (COMPLETED included) ⇒ trip_financial_state override stamp —
  // the channel the money boards and effectiveLclFreight already read; the
  // trip-less snapshot grain stays for trip-less lots.
  assert.match(slice, /if \(trip\) \{[\s\S]*?upsertTripFinancialState\(tx, trip\.tripId, \{/);
  assert.match(slice, /revenueOverriddenReason|revenueOverrideReason: reason \?\? snapshotNote/);
});

test('SIL-693: both lock gates stay AHEAD of the completed-trip write', () => {
  const slice = perLot();
  const accountingAt = slice.indexOf('assertShipmentAccountingUnlocked(tx, row.id)');
  const costAt = slice.indexOf('assertShipmentCostUnlocked(tx, row.id)');
  const tripAt = slice.indexOf('loadLiveTripFactsByShipment(tx, [row.id])');
  assert.ok(accountingAt > -1 && costAt > -1 && tripAt > -1);
  assert.ok(accountingAt < tripAt && costAt < tripAt, 'lock asserts must precede the trip facts read');
});

test('SIL-693: merge/assign sibling law unchanged — completed trips still refuse grouping', () => {
  const mergeMoney = svc.slice(
    svc.indexOf('async function assertMergeableMoney'),
    svc.indexOf('─── FB-095 — un-merge safety'),
  );
  assert.match(mergeMoney, /trip\.status === 'COMPLETED'/);
  assert.match(mergeMoney, /đã hoàn thành chuyến — không thay đổi nhóm ghép được nữa/);
});

test('SIL-693: schema carries the optional reason (trim, ≤500) without making it mandatory', () => {
  const slice = schema.slice(
    schema.indexOf('export const setLclLotRevClassSchema'),
    schema.indexOf('export type SetLclLotRevClassInput'),
  );
  assert.match(slice, /reason: z\.string\(\)\.trim\(\)\.max\(500\)\.optional\(\)/);
  // The existing refine (class or manual price required) is untouched.
  assert.match(slice, /vehicleSizeClassId != null || value\.freightRevenue !== undefined/);
});
