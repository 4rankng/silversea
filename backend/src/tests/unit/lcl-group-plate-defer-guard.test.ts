// SIL-494 (QA R3 26/10, build 52ee6443) — hai mắt xích bị hở trên cùng một
// lớp lỗi "BKS nhóm nhận nhãn tạm hoãn", unit-only (no db, no app boot):
//   1. Wire contract: shared `truckNo` (Gán xe nhóm · sửa nhóm · Đổi BKS nhóm)
//      phải TỪ CHỐI literal "Bổ sung sau" cùng biến thể whitespace/case —
//      đường "gõ mới" của dialog nhóm từng lưu chuỗi này lên cả nhóm đang
//      ghép. Tạm hoãn biển chỉ tồn tại trên lô đơn (deferred pick của editor).
//   2. Source-scan pins (style lcl-gop-hang-money-wiring): cả BA điểm ghi
//      fulfillment có thể rớt biển (atomic plan save · legacy /plate · đổi
//      nhà xe) phải dọn `shipments.actualTruckNo` stale của lô đứng ngoài
//      nhóm COST (QA note 4 — 99H-004.59 sống sót sau defer), và plan save
//      gộp reset vào ĐÚNG block shipment write có guard version (một write
//      riêng sẽ 409 notes/isCombined).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLclCostGroupSchema,
  updateLclCostGroupSchema,
  updateLclTruckSchema,
} from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

// ─── 1. Wire contract — "Bổ sung sau" không phải biển số ───────────────────

test('SIL-494: updateLclTruckSchema từ chối literal "Bổ sung sau" kèm lý do tạm hoãn lô đơn', () => {
  const outcome = updateLclTruckSchema.safeParse({ shipmentId: 1, actualTruckNo: 'Bổ sung sau' });
  assert.equal(outcome.success, false);
  if (!outcome.success) {
    assert.match(outcome.error.issues[0]!.message, /không phải biển số/);
    assert.match(outcome.error.issues[0]!.message, /lô đơn/);
  }
});

test('SIL-494: biến thể whitespace/chữ hoa-thường cũng bị chặn', () => {
  for (const variant of [' Bổ   sung  sau ', 'BỔ SUNG SAU', '\tbổ sung sau\n', 'bổ  sung sau']) {
    const outcome = updateLclTruckSchema.safeParse({ shipmentId: 1, actualTruckNo: variant });
    assert.equal(outcome.success, false, `variant phải bị chặn: ${JSON.stringify(variant)}`);
  }
});

test('SIL-494: BKS thật vẫn đi qua wire trên cả 3 schema nhóm', () => {
  assert.equal(
    updateLclTruckSchema.safeParse({ shipmentId: 1, actualTruckNo: '99H-004.59' }).success,
    true,
  );
  assert.equal(
    assignLclCostGroupSchema.safeParse({
      shipmentIds: [1, 2],
      vehicleSizeClassId: 3,
      actualTruckNo: '15C-99999',
    }).success,
    true,
  );
  assert.equal(
    updateLclCostGroupSchema.safeParse({ groupId: '0b8f6c1e-7c31-4a6e-9d2a-5f1e3b9a77c1', actualTruckNo: '30K-123.45' }).success,
    true,
  );
});

test('SIL-494: BKS trống giữ luật cũ (min 1) — không nhầm với luật defer', () => {
  assert.equal(updateLclTruckSchema.safeParse({ shipmentId: 1, actualTruckNo: '   ' }).success, false);
});

// ─── 2. Source-scan — dọn actualTruckNo stale tại 3 điểm rớt biển ───────────

const SERVICE = read('../../services/dispatch-planning-detail-plan.service.ts');

test('SIL-494 source-scan: helper dọn stale chỉ chạy khi lô NGOÀI nhóm COST và đang còn BKS', () => {
  assert.match(SERVICE, /costGroupId != null \|\| lot\.actualTruckNo == null\) return/);
});

test('SIL-494 source-scan: cả 3 điểm ghi fulfillment đều gọi clearStaleLotActualTruck khi rớt biển', () => {
  // Atomic plan save — composed into the version-guarded shipment write.
  assert.match(SERVICE, /lotIdentityReset = rowPlateless/);
  assert.match(SERVICE, /shipment\.costGroupId == null\s*&&\s*shipment\.actualTruckNo != null/);
  // Legacy /plate endpoint — guard trên kết quả resolve (biển null/rỗng).
  assert.match(SERVICE, /if \(vehicle\.plannedVehiclePlateNumber == null \|\| vehicle\.plannedVehiclePlateNumber\.trim\(\) === ''\) \{\s*await clearStaleLotActualTruck\(tx, fulfillment\.shipmentId\);/);
  // Carrier change — plate bị xoá vô điều kiện.
  assert.match(SERVICE, /await clearStaleLotActualTruck\(tx, shipment\.id\);/);
});

test('SIL-494 source-scan: plan save gộp reset vào block shipment write có guard version', () => {
  // Một write riêng sẽ bump version dưới chân notes/isCombined và 409 save.
  assert.match(SERVICE, /if \(isCombinedChanged \|\| notesChanged \|\| lotIdentityReset\) \{/);
  assert.match(SERVICE, /\.\.\.\(lotIdentityReset \? \{ actualTruckNo: null \} : \{\}\),/);
});
