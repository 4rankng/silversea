import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignLclCostGroupSchema,
  mergeLclRevGroupSchema,
  setLclLotRevClassSchema,
  unmergeLclLotSchema,
  updateLclCostGroupSchema,
  updateLclTruckSchema,
} from './lcl-grouping';

/** Regression pins (zod v3 → v4 bump, case-2026-10-29-zod4-final-bump):
 *  the LCL lot-merge wire contract (FB-092/093/095/141, SIL-494) must accept
 *  and return payloads identically across the bump — money 3-state semantics
 *  (`null` = auto-trace, omitted = untouched) and the deferred-plate guard
 *  are the two rules an accidental `.default()`/partial regression would
 *  silently break. */

const GROUP_ID = '123e4567-e89b-42d3-a456-426614174000';

test('Z4-MERGE-1: assignLclCostGroupSchema accepts a real 2-lot assign and keeps operator order', () => {
  const parsed = assignLclCostGroupSchema.parse({
    shipmentIds: [242, 244],
    vehicleSizeClassId: 7,
    actualTruckNo: '51C-123.45',
    carrierId: 9,
    carrierType: 'EXTERNAL',
    freightCost: 3_100_000,
  });
  assert.deepEqual(parsed.shipmentIds, [242, 244]);
  assert.equal(parsed.actualTruckNo, '51C-123.45');
  assert.equal(parsed.freightCost, 3_100_000);

  const oneLot = assignLclCostGroupSchema.safeParse({
    shipmentIds: [242],
    vehicleSizeClassId: 7,
    actualTruckNo: '51C-123.45',
  });
  assert.equal(oneLot.success, false);
  if (!oneLot.success) {
    assert.equal(oneLot.error.issues[0]?.message, 'Nhóm ghép cần ít nhất 2 lô');
  }
});

test('Z4-MERGE-2: the deferred-plate label is refused on every truck-no wire (SIL-494)', () => {
  for (const plate of ['bổ sung sau', 'Bổ Sung Sau', '  bổ sung sau ', 'BỔ SUNG SAU']) {
    assert.equal(assignLclCostGroupSchema.safeParse({
      shipmentIds: [1, 2],
      vehicleSizeClassId: 7,
      actualTruckNo: plate,
    }).success, false, `assign must refuse "${plate}"`);
    assert.equal(updateLclCostGroupSchema.safeParse({
      groupId: GROUP_ID,
      actualTruckNo: plate,
    }).success, false, `group edit must refuse "${plate}"`);
    assert.equal(updateLclTruckSchema.safeParse({
      shipmentId: 1,
      actualTruckNo: plate,
    }).success, false, `truck edit must refuse "${plate}"`);
  }
});

test('Z4-MERGE-3: updateLclCostGroupSchema — nothing-to-edit guard and the 3-state freightCost', () => {
  const empty = updateLclCostGroupSchema.safeParse({ groupId: GROUP_ID });
  assert.equal(empty.success, false);
  if (!empty.success) {
    assert.equal(
      empty.error.issues[0]?.message,
      'Không có gì để sửa — truyền ít nhất một trong 4 trường gán xe nhóm',
    );
  }

  // null = BLANK ⇒ auto-trace the carrier price board again — must survive
  // the parse as an explicit null (a default-or-optional regression would
  // drop it and silently keep the old manual money).
  const cleared = updateLclCostGroupSchema.parse({ groupId: GROUP_ID, freightCost: null });
  assert.equal('freightCost' in cleared, true);
  assert.equal(cleared.freightCost, null);

  // omitted = keep the group's money untouched — the key must NOT appear.
  const kept = updateLclCostGroupSchema.parse({ groupId: GROUP_ID, vehicleSizeClassId: 5 });
  assert.equal('freightCost' in kept, false);
  assert.equal(kept.vehicleSizeClassId, 5);
});

test('Z4-MERGE-4: mergeLclRevGroupSchema lets a blank billing truck through (FB-141 clear)', () => {
  const blank = mergeLclRevGroupSchema.parse({
    shipmentIds: [242, 244],
    vehicleSizeClassId: 7,
    billingTruckNo: '',
  });
  assert.equal(blank.billingTruckNo, '');

  const nulled = mergeLclRevGroupSchema.parse({
    shipmentIds: [242, 244],
    vehicleSizeClassId: 7,
    billingTruckNo: null,
  });
  assert.equal(nulled.billingTruckNo, null);

  const omitted = mergeLclRevGroupSchema.parse({
    shipmentIds: [242, 244],
    vehicleSizeClassId: 7,
  });
  assert.equal('billingTruckNo' in omitted, false);
});

test('Z4-MERGE-5: per-lot rev class needs one of its two money fields; unmerge dimension is COST|REV only', () => {
  const empty = setLclLotRevClassSchema.safeParse({ shipmentId: 242 });
  assert.equal(empty.success, false);
  if (!empty.success) {
    assert.equal(
      empty.error.issues[0]?.message,
      'Cần ít nhất Loại xe thu khách hoặc Giá cước thu khách nhập tay',
    );
  }
  const manual = setLclLotRevClassSchema.parse({ shipmentId: 242, freightRevenue: 1_200_000 });
  assert.equal(manual.freightRevenue, 1_200_000);

  assert.equal(unmergeLclLotSchema.safeParse({ shipmentId: 242, dimension: 'COST' }).success, true);
  assert.equal(unmergeLclLotSchema.safeParse({ shipmentId: 242, dimension: 'REV' }).success, true);
  assert.equal(unmergeLclLotSchema.safeParse({ shipmentId: 242, dimension: 'cost' }).success, false);
});
