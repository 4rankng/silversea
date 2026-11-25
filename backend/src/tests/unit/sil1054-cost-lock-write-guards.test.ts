// SIL-1054 (KB Ch3 §3.7.3 K3.92 + §3.5.4 K3.72, QA 25/11 build dev): lô đã
// khóa kế toán (POST /api/shipments/:id/lock → shipment_cost_locks
// unlockedAt NULL, ví dụ lô W4A-FCL-03 id 1244, lock id 87) vẫn sửa được
// qua form "Sửa lô hàng": PUT /api/shipments/1244 → 200 và
// PUT /api/shipments/1244/containers → 200, Số Bill đổi thành W4A-FCL-03X
// trên lô đang khóa. Hai đường PUT này chỉ guard kỳ-kế-toán
// (assertShipmentAccountingUnlocked — bảng shipment_accounting_locks) mà
// thiếu freeze gate của cost lock (shipment_cost_locks) — guard duy nhất
// lọt qua khóa, trong khi sửa tờ khai đã bị chặn 409 đúng
// (assertShipmentDeclarationEditableByCostLock, SIL-789).
//
// Luật: lô khóa kế toán không nhận chỉnh sửa hồ sơ — chặn TẠI NGUỒN (BE
// 409) + detail wire công bố costLock để form sửa từ chối arm (same law as
// accountingLock/SIL-453). Pin wiring ở ranh giới unit cho phép (không db)
// — same convention as sil789-declaration-cost-lock.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '../..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(join(here, '../../../..', rel), 'utf8');
const slice = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));

const updateService = read('services/shipment-update.service.ts');
const containersService = read('services/shipment-containers.service.ts');
const detailService = read('services/shipment-detail-reads.service.ts');
const costLockService = read('services/shipment-cost-lock.service.ts');
const prefillHook = readRoot('frontend/src/features/shipments/create/use-shipment-workspace-prefill.ts');
const client = readRoot('frontend/src/api/shipmentClient.ts');

const updateFlow = () => slice(updateService, 'export async function updateShipment', 'function isNotesOnlyShipmentUpdate');
const batchFlow = () => slice(containersService, 'export async function batchUpsertShipmentContainers', 'export async function syncTripSnapshotIdentityFromShipmentContainer');

test('PUT /api/shipments/:id: freeze gate cost lock chạy cùng guard kỳ-kế-toán, ngoài nhánh notes-only', () => {
  const flow = updateFlow();
  const notesOnlyAt = flow.indexOf('const notesOnly');
  const guardAt = flow.indexOf('await assertShipmentCostUnlocked(tx, id)');
  const accountingAt = flow.indexOf('await assertShipmentAccountingUnlocked(tx, id)');
  assert.ok(notesOnlyAt > -1, 'notes-only carve-out vẫn phân nhánh');
  assert.ok(accountingAt > notesOnlyAt, 'accounting guard trong nhánh !notesOnly');
  assert.ok(guardAt > accountingAt, 'cost-lock guard đi ngay sau accounting guard');
  // Notes-only giữ nguyên carve-out: guard phải nằm TRONG khối !notesOnly —
  // hàng 'if (!notesOnly) {' mở ngay trước cặp guard.
  assert.match(flow, /if \(!notesOnly\) \{[\s\S]*?assertShipmentAccountingUnlocked[\s\S]*?assertShipmentCostUnlocked/);
});

test('PUT /api/shipments/:id/containers: batch upsert cùng chịu freeze gate', () => {
  const flow = batchFlow();
  const guardAt = flow.indexOf('await assertShipmentCostUnlocked(tx, shipmentId)');
  assert.ok(guardAt > -1, 'batchUpsertShipmentContainers thiếu cost-lock guard');
  assert.ok(guardAt > flow.indexOf('await assertShipmentAccountingUnlocked(tx, shipmentId)'), 'guard sau accounting guard');
});

test('Guard dùng đúng 409 freeze của cost lock (message khóa chi phí/Debit Note)', () => {
  assert.match(costLockService, /export async function assertShipmentCostUnlocked\(executor: Executor, shipmentId: number\): Promise<void>/);
  assert.match(costLockService, /isNull\(s\.shipmentCostLocks\.unlockedAt\)/);
  assert.match(costLockService, /throw new ApiError\(409, SHIPMENT_COST_LOCKED_MESSAGE\)/);
});

test('Detail wire công bố costLock (active Khóa lô) cạnh accountingLock', () => {
  assert.match(detailService, /async function getShipmentCostLock\(shipmentId: number\)/);
  assert.match(detailService, /costLock: ShipmentCostLockView \| null/);
  assert.match(detailService, /getShipmentCostLock\(id\)/);
  assert.match(client, /costLock\?: \{\s*lockedAt: string;\s*lockNote: string \| null;\s*\} \| null/);
});

test('Form sửa từ chối arm trên lô bị khóa chi phí — same law as accountingLock', () => {
  const hook = slice(prefillHook, 'if (detail.costLock) {', 'setForm(prefill.form)');
  assert.match(hook, /setEditLoadError\('Lô hàng đã khóa kế toán \(khóa lô\) nên không thể sửa thông tin\. Ghi chú vẫn sửa được ở Tổng quan\.'\)/);
  assert.match(hook, /setViewLocked\(true\)/);
});
