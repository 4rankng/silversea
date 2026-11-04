/**
 * SIL-679 r2 (QA comment 3834 §2) — the L2 manual "Giá cước thu khách" clear
 * must actually work ("trống = tự động tra cứu"): QA cleared the typed price,
 * saved, and the lot stayed at 3.679.000; the clear request omitted the field
 * and an explicit null 400'd. Static source pins + shared-zod contract checks
 * (unit-only tree, no DB):
 *   - the wire accepts null | '' (clear intent) beside number (manual) and
 *     absent (no intent);
 *   - setLclLotRevClass runs the clear law: the manual marker leaves the
 *     winning channel, the auto lane trace re-prices when it can, the
 *     response carries the new price, and a lane-miss trip-less clear cites
 *     its zero (D02) so every board reads "Chưa xác định".
 * The auto-lookup logic itself is pinned unchanged (SIL-679 r2: "KHÔNG đổi
 * logic auto-lookup đã pass").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLclLotRevClassSchema } from '@tingting/shared';
import { isRevManualPriceNote, isRevManualClearNote, REV_LOT_MANUAL_CLEARED_REASON } from '../../services/lcl-rev-notes';
import { effectiveLclFreight, revManualPrice } from '../../services/lcl-effective-freight';

const here = dirname(fileURLToPath(import.meta.url));
const grouping = readFileSync(join(here, '../../services/lcl-grouping.service.ts'), 'utf8');

const clearLaw = () => grouping.slice(
  grouping.indexOf('async function clearLotManualRevPrice'),
  grouping.indexOf('/**\n * 161026232349 (DEV SPEC Hàng lẻ §II.3.2'),
);
const clearBranch = () => grouping.slice(
  grouping.indexOf('const clearManualRevenue = input.freightRevenue'),
  grouping.indexOf('// The lane needs the customer'),
);

// ── shared zod contract ─────────────────────────────────────────────────────

test('wire: explicit null and \u0027\u0027 express clear intent; absent stays no-intent', () => {
  const cleared = setLclLotRevClassSchema.safeParse({ shipmentId: 811, freightRevenue: null });
  assert.equal(cleared.success, true);
  if (cleared.success) assert.equal(cleared.data.freightRevenue, null);
  const blankString = setLclLotRevClassSchema.safeParse({ shipmentId: 811, freightRevenue: '' });
  assert.equal(blankString.success, true);
  if (blankString.success) assert.equal(blankString.data.freightRevenue, null);
  const manual = setLclLotRevClassSchema.parse({ shipmentId: 811, freightRevenue: 3_679_000 });
  assert.equal(manual.freightRevenue, 3_679_000);
  const absent = setLclLotRevClassSchema.safeParse({ shipmentId: 811 });
  assert.equal(absent.success, false, 'the refine still requires one output when nothing is sent');
  const negative = setLclLotRevClassSchema.safeParse({ shipmentId: 811, freightRevenue: -1 });
  assert.equal(negative.success, false);
});

// ── the clear branch rides the same guards ──────────────────────────────────

test('clear runs inside setLclLotRevClass behind both lock gates and the class update', () => {
  const body = clearBranch();
  assert.match(body, /input\.freightRevenue !== undefined && input\.freightRevenue == null/);
  // The branch sits AFTER the standing guards (grep the order in the service):
  const service = grouping.slice(grouping.indexOf('export async function setLclLotRevClass'), grouping.indexOf('/**\n * FB-093 — quick-edit the BKS pair'));
  const assertAt = service.indexOf('await assertShipmentCostUnlocked(tx, row.id);');
  const clearAt = service.indexOf('const clearManualRevenue = input.freightRevenue');
  assert.ok(assertAt > -1 && clearAt > assertAt, 'the cost-lock gate precedes the clear branch');
  assert.match(body, /freightManual: null/);
  assert.match(body, /action: 'rev-class-single-lot-clear-manual'/);
});

test('clear law, live trip: lane hit writes the auto lane price through the standing channel', () => {
  const body = clearLaw();
  assert.match(body, /if \(trip != null\) \{/);
  assert.match(body, /revenue: String\(lane\.price\)/);
  assert.match(body, /revenueOverrideReason: classPickReason \?\? autoTraceNote \?\? 'Xóa giá nhập tay — về tự tra'/);
  assert.match(body, /channel: 'TRIP', reason: classPickReason/);
});

test('clear law, live trip lane miss: the manual stamp un-marks (revenueOriginal legacy law)', () => {
  const body = clearLaw();
  assert.match(body, /const stampedManual = trip\.revenueOverrideReason != null && isRevManualPriceNote\(trip\.revenueOverrideReason\);/);
  assert.match(body, /if \(!stampedManual\) return \{ freightAuto: null, freight: null, channel: 'NONE', reason: null \};/);
  assert.match(body, /\.\.\.\(trip\.revenueOriginal != null \? \{ revenue: trip\.revenueOriginal \} : \{\}\)/);
  assert.match(body, /revenueOverriddenBy: null/);
  assert.match(body, /revenueOverriddenAt: null/);
  assert.match(body, /revenueOverrideReason: null/);
});

test('clear law, trip-less: lane hit supersedes the manual snapshot with the auto note', () => {
  const body = clearLaw();
  assert.match(body, /await insertRevMergeSnapshot\(tx, row\.id, lane\.price, autoTraceNote\);/);
});

test('clear law, trip-less lane miss: rewind to the pre-manual row, else the cited clear zero (D02)', () => {
  const body = clearLaw();
  assert.match(body, /while \(cursor >= 0 && isRevManualPriceNote\(rows\[cursor\]!\.formulaText\)\) cursor -= 1;/);
  assert.match(body, /await insertRevMergeSnapshot\(tx, row\.id, 0, REV_LOT_MANUAL_CLEARED_REASON\);/);
  // The pre-manual row re-materializes verbatim (money AND trace ids AND its
  // frozen prose) — the restoreRevPreMergeMoney law.
  assert.match(body, /formula: 'Xóa giá nhập tay — trở về cước thu trước khi nhập tay'/);
  assert.match(body, /\.\.\.\(pre\.formulaText != null \? \{ formulaText: pre\.formulaText \} : \{\}\)/);
});

// ── the boards classify the clear state ────────────────────────────────────

test('the clear marker is a manual-vocabulary note the boards read as UNSET, never 0\u20ab or manual', () => {
  assert.equal(isRevManualPriceNote(REV_LOT_MANUAL_CLEARED_REASON), false);
  assert.equal(isRevManualClearNote(REV_LOT_MANUAL_CLEARED_REASON), true);
  const facts = {
    snapshotChannel: { total: 0, formulaNote: REV_LOT_MANUAL_CLEARED_REASON },
    override: null,
    revGroupId: null,
    revGroupOrder: null,
    cargoMode: 'LCL',
  };
  const board = effectiveLclFreight(facts);
  assert.deepEqual(board, { value: null, reason: null }, 'the cited clear zero reads Chưa xác định');
  assert.equal(revManualPrice(facts), null, 'the clear state prefill-reopens blank');
  // A non-zero manual-clear citation is impossible by construction — the
  // writer only cites 0 — but the classification stays note-exact.
  assert.equal(isRevManualClearNote('Chọn giá cước thu khách — giá nhập tay (thỏa thuận với khách)'), false);
  assert.equal(isRevManualClearNote(null), false);
});
