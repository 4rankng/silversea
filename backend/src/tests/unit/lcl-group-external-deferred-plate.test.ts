// SIL-1224 (KB Ch.4 §4.1.7, K4.30) — "Gán xe nhóm" with an outside nhà xe and
// NO plate yet: the group IS saved (the run carries "chưa có biển", the plate
// rides in later through "Đổi BKS nhóm") — the same law the single-lot flow
// already ships (card 20261004_359). The internal fleet keeps the hard rule:
// its tractor is always a registered one.
//
// Unit-only (no db, no app boot), like the sibling SIL-494 guard:
//   1. the law patch writes a NULL plate (never ''), so the plan row reads
//      "chờ bổ sung biển" instead of a blank string;
//   2. source-scan pins the service wiring on both write paths (gán nhóm and
//      sửa/THÊM-lô).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costGroupMemberPatch } from '../../services/lcl-grouping-law';

const here = dirname(fileURLToPath(import.meta.url));
const SERVICE = readFileSync(join(here, '../../services/lcl-grouping.service.ts'), 'utf8');

// ─── 1. Law patch — a plate-less group stores NULL, never '' ────────────────

test('SIL-1224: costGroupMemberPatch ghi NULL cho nhóm chưa có biển', () => {
  const patch = costGroupMemberPatch({
    groupId: 'g1',
    order: 1,
    actualTruckNo: null,
    costVehicleClassId: 7,
    version: 1,
    updatedBy: 1,
    now: new Date(),
  });
  assert.equal(patch.actualTruckNo, null);
  // The group's own identity still rides the patch.
  assert.equal(patch.costGroupId, 'g1');
  assert.equal(patch.costVehicleClassId, 7);
});

test('SIL-1224: costGroupMemberPatch vẫn ghi biển thật khi có', () => {
  const patch = costGroupMemberPatch({
    groupId: 'g1',
    order: 2,
    actualTruckNo: '29H-635.35',
    costVehicleClassId: 7,
    version: 1,
    updatedBy: 1,
    now: new Date(),
  });
  assert.equal(patch.actualTruckNo, '29H-635.35');
});

// ─── 2. Source-scan — wiring trên cả hai đường ghi ─────────────────────────

const assign = SERVICE.slice(
  SERVICE.indexOf('export async function assignLclCostGroup'),
  SERVICE.indexOf('export async function updateLclCostGroup'),
);
const update = SERVICE.slice(SERVICE.indexOf('export async function updateLclCostGroup'));

test('SIL-1224 source-scan: đường gán nhóm quy rỗng thành NULL và giữ luật xe nội bộ', () => {
  assert.match(assign, /const groupPlate = actualTruckNo === '' \? null : actualTruckNo;/);
  // Nhóm không biển chỉ hợp lệ với nhà xe NGOÀI.
  assert.match(assign, /if \(groupPlate == null && carrier\.carrierType !== 'EXTERNAL'\)/);
  // Cột lưu NULL, không lưu chuỗi rỗng.
  assert.match(assign, /actualTruckNo: groupPlate,/);
  // Kế hoạch "phân bổ xe" cũng nhận NULL (biển chưa có ⇒ "chờ bổ sung biển").
  assert.match(assign, /carrier,\n      groupPlate,/);
});

test('SIL-1224 source-scan: persistLclCostCarrier nhận biển nullable', () => {
  const persist = SERVICE.slice(
    SERVICE.indexOf('async function persistLclCostCarrier'),
    SERVICE.indexOf('export async function assignLclCostGroup'),
  );
  assert.match(persist, /actualTruckNo: string \| null,/);
  assert.match(persist, /plannedVehiclePlateNumber: actualTruckNo,/);
});

test('SIL-1224 source-scan: đường sửa/THÊM-lô giữ được nhóm chưa có biển', () => {
  // Nguồn xe được xác định TRƯỚC khi kiểm tra biển, để nhóm của nhà xe ngoài
  // không bị chặn oan.
  assert.match(update, /if \(groupPlate == null && carrier\.carrierType !== 'EXTERNAL'\)/);
  assert.match(update, /actualTruckNo: groupPlate,/);
});

test('SIL-1224 source-scan: tra cứu xe của nhà xe bỏ qua khi chưa có biển', () => {
  assert.match(SERVICE, /const \[vehicle\] = actualTruckNo === ''/);
});
