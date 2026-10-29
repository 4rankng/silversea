// SIL-555 (id 629, QA fail 29/10): "xóa lot còn sót container" — xóa lô phải
// dọn cả các dòng container của lô đó. softDeleteShipment trước đây chỉ hủy
// fulfillment + soft-delete shipments, để lại shipmentContainers sống mãi
// (QA: những dòng kiểm thử còn sót từ các đợt trước tiếp tục đọng trên board).
// Pin ở ranh giới unit cho phép (không db): wiring nguồn của flow xóa lô —
// cùng lớp hard-delete với remove-per-row (CUS workspace) và quét FCL→LCL
// (shipment-update), sau TẤT CẢ các guard theo luật xóa lô.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const lifecycle = readFileSync(join(here, '../../services/shipment-lifecycle.service.ts'), 'utf8');

const deleteFlow = () => lifecycle.slice(
  lifecycle.indexOf('export async function softDeleteShipment'),
  lifecycle.indexOf('export interface CancelShipmentFulfillmentResult'),
);

test('xóa lô cascade dọn container rows của lô (không sót dòng sau xóa)', () => {
  assert.match(
    deleteFlow(),
    /await tx\.delete\(s\.shipmentContainers\)\.where\(eq\(s\.shipmentContainers\.shipmentId, shipmentId\)\)/,
    'softDeleteShipment thiếu sweep shipmentContainers theo shipmentId',
  );
});

test('cascade chạy SAU guard chuyến đang sống (lô đã điều xe vẫn bị chặn trước khi dọn)', () => {
  const flow = deleteFlow();
  const guardAt = flow.indexOf('Không thể xóa lô hàng đã có container được điều xe');
  const cascadeAt = flow.indexOf('await tx.delete(s.shipmentContainers)');
  assert.ok(guardAt > -1, 'thiếu guard live-trip của xóa lô');
  assert.ok(cascadeAt > -1 && guardAt < cascadeAt, 'guard live-trip phải chạy trước cascade');
});

test('cascade chạy SAU khóa kế toán + SAU việc hủy fulfillment của lô', () => {
  const flow = deleteFlow();
  const lockAt = flow.indexOf('await assertShipmentAccountingUnlocked(tx, shipmentId);');
  const cancelAt = flow.indexOf('cancellationReason: \'Shipment deleted\'');
  const cascadeAt = flow.indexOf('await tx.delete(s.shipmentContainers)');
  assert.ok(lockAt > -1 && lockAt < cascadeAt, 'khóa kế toán phải chạy trước cascade');
  assert.ok(cancelAt > -1 && cancelAt < cascadeAt, 'hủy fulfillment phải chạy trước cascade');
});

test('lô vẫn soft-delete (audit trail giữ nguyên) — cascade chỉ dọn container rows', () => {
  const flow = deleteFlow();
  assert.match(flow, /deletedAt: new Date\(\)/, 'lô phải giữ soft-delete (deletedAt)');
  const softDeleteAt = flow.indexOf('deletedAt: new Date()');
  const cascadeAt = flow.indexOf('await tx.delete(s.shipmentContainers)');
  assert.ok(cascadeAt > -1 && cascadeAt < softDeleteAt, 'cascade dọn rows trước khi đánh dấu xóa lô');
});
