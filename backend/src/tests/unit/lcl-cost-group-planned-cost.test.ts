// SIL-492 — the cost group's planned-cost law, pure: the money the group law
// lands on `shipment_fulfillments.planned_carrier_cost` (the column the
// "Chỉnh sửa điều phối" popup and the plan grid render), per member order.
// Unit-only tree: no db, no app boot (BE unit-only ruling 2026-10-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lclCostGroupPlannedCosts } from '../../services/lcl-grouping-law';

test('Lô 1 giữ 100%: manual cước trả ĐVVC thắng — các lô còn lại 0₫', () => {
  const planned = lclCostGroupPlannedCosts([11, 22], { amount: '1000000', source: 'MANUAL' });
  assert.equal(planned.get(11), '1000000');
  assert.equal(planned.get(22), '0');
  assert.equal(planned.size, 2);
});

test('Auto-trace: giá bảng về Lô 1, thành viên 0₫', () => {
  const planned = lclCostGroupPlannedCosts([11, 22, 33], { amount: '850000', source: 'PRICE_BOARD' });
  assert.equal(planned.get(11), '850000');
  assert.equal(planned.get(22), '0');
  assert.equal(planned.get(33), '0');
});

test('Trượt bảng giá: Lô 1 null (GIỮ giá trị cũ — không bịa 0₫), thành viên vẫn 0₫', () => {
  const planned = lclCostGroupPlannedCosts([11, 22], null);
  assert.equal(planned.get(11), null);
  assert.equal(planned.get(22), '0');
});

test('Nhóm 1 lô không tồn tại ở đây (schema cần ≥2) nhưng luật vẫn đúng thứ tự chọn', () => {
  // Selection order decides the principal: the FIRST id is Lô 1 regardless of
  // numeric order — the caller maps rows in click order.
  const planned = lclCostGroupPlannedCosts([77, 12], { amount: '500000', source: 'MANUAL' });
  assert.equal(planned.get(77), '500000');
  assert.equal(planned.get(12), '0');
});
