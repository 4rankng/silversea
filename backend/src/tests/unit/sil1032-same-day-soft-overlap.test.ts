/**
 * SIL-1032 — Phân xe trùng yếu (cùng ngày, khác giờ) lưu thầm lặng (KB
 * §4.1.6 K4.27: Trùng yếu phải hiện cảnh báo một lần 'Vẫn lưu?' trước khi
 * lưu; không được lưu thầm lặng).
 *
 * QA 25/11: xe 15H-104.03 đã có chuyến 563 (25/11 08:00–10:00) và 190
 * (25/11 14:00–16:00); phân xe lúc 11:00 cùng ngày LƯU THẦM LẶT — tầng trùng
 * mạnh (trùng giờ) vẫn chặn đúng, nhưng trùng-ngày-không-trùng-giờ rơi qua
 * mọi tầng quét (chúng đều phán xét WINDOW overlap).
 *
 * Fix: a Trùng YẾU tier in the plan-save rig guard — same Vietnam business
 * day, non-overlapping hours, cross-lot, cross-group — answers the family's
 * warn-once 409 (RIG_OVERLAP_COMPLETED + '. Vẫn lưu?'), so the editor's
 * existing confirm flow asks exactly once and the confirmed retry proceeds.
 * Carves: the lot's own rotation, a Ghép-trả-ĐV group's siblings, and a
 * declared pair row (Kẹp/Kết hợp shares its rig by definition).
 *
 * BE unit-only ruling: the DB-bound tier is pinned by source-scan; the
 * message-reference dedupe (the ticket's wording note: "SHP-2611-00630 lặp
 * 2 lần") is a pure law and is asserted directly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { describeRigConflicts } from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const planSource = readFileSync(
  path.join(here, '../../services/dispatch-planning-detail-plan.service.ts'),
  'utf8',
);

describe('SIL-1032 wording — one claim never reads twice in the busy copy', () => {
  const row = (shipmentId: number, code: string) => ({
    shipmentId,
    shipmentCode: code,
    blNumber: null,
    bookingRef: null,
    slotAt: null,
  });
  const trip = (tripId: number, shipmentId: number | null, code: string | null) => ({
    tripId,
    tripCode: code,
    plannedStartAt: null,
    shipmentId,
    shipmentCode: code,
    blNumber: null,
    bookingRef: null,
  });

  it('a trip whose lot already rides a plan-row label is dropped', () => {
    const message = describeRigConflicts(
      [row(7, 'SHP-2611-00630')],
      [trip(563, 7, 'SHP-2611-00630')],
    );
    assert.equal(message, 'Lô SHP-2611-00630');
    assert.equal(message.split('SHP-2611-00630').length - 1, 1, 'the lot name must appear exactly once');
  });

  it('a fulfillment-less trip (BULK task) keeps its own label', () => {
    const message = describeRigConflicts(
      [row(7, 'SHP-2611-00630')],
      [trip(900, null, null)],
    );
    assert.match(message, /Lô SHP-2611-00630, Lệnh #900/);
  });

  it('two different lots still both list', () => {
    const message = describeRigConflicts(
      [row(7, 'SHP-2611-00630')],
      [trip(563, 8, 'SHP-2611-00671')],
    );
    assert.match(message, /SHP-2611-00630/);
    assert.match(message, /SHP-2611-00671/);
  });
});

describe('SIL-1032 — the Trùng YẾU tier in the plan-save rig guard', () => {
  const tierIdx = () => planSource.indexOf('SIL-1032 (KB §4.1.6 K4.27)');

  it('the tier exists, fenced off declared pair rows, inside the confirm-once block', () => {
    const idx = tierIdx();
    assert.ok(idx > 0, 'the same-day tier must exist');
    const block = planSource.slice(idx, idx + 2400);
    assert.match(block, /if \(!isDeclaredPairRow\) \{/,
      'a declared Kẹp/Kết hợp row never fires the weak tier — its rig share is the arrangement');
    // Inside `if (!args.confirmOverlap) {` — the confirmed retry proceeds.
    const confirmGateIdx = planSource.lastIndexOf('if (!args.confirmOverlap) {', idx);
    assert.ok(confirmGateIdx > 0 && idx > confirmGateIdx,
      'the tier must run only before a confirmed retry');
  });

  it('the scan judges same-day NON-overlap, after the strong window scans', () => {
    const block = planSource.slice(tierIdx(), tierIdx() + 3600);
    assert.match(block, /not \(\$\{s\.trips\.plannedStartAt\} < \$\{windowEnd\.toISOString\(\)\}::timestamptz/,
      'the tier must scan the NON-overlap complement — the weak half of K4.27');
    assert.match(block, /at time zone 'Asia\/Ho_Chi_Minh'\)::date/,
      'same-day compares Vietnam business days');
    // Carves: own leg, own lot rotation, cost-group siblings.
    assert.match(block, /ne\(s\.trips\.fulfillmentId, args\.fulfillmentId\)/);
    assert.match(block, /ne\(s\.shipments\.id, args\.shipmentId\)/);
    assert.match(block, /ne\(s\.shipments\.costGroupId, ownCostGroupId\)/);
  });

  it('the refusal rides the warn-once contract with the Vẫn lưu? copy', () => {
    const block = planSource.slice(tierIdx(), tierIdx() + 3600);
    assert.match(block, /chuyến khác trong cùng ngày phân công này \(không trùng giờ chạy\)\. Vẫn lưu\?/);
    assert.match(block, /code: 'RIG_OVERLAP_COMPLETED'/,
      'the confirmable contract code drives the editor\'s Vẫn lưu? dialog');
  });
});
