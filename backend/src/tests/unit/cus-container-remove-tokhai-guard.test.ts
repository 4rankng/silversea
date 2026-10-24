// SIL-177 (card 211026094500, QA R42): "Xóa container" phải bị CHẶN khi dòng
// đang mang số tờ khai — QA xóa MSKU1234586 (mang Q1-DECL-177) thành công là
// lỗ hổng. Pin ở ranh giới unit cho phép (không db): wiring nguồn của cả HAI
// đường xóa container — remove của CUS workspace và reconcile của "Sửa thông
// tin lô" (cùng class lỗi, không được thành cửa ngõ vòng qua guard).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const writes = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');
const containersService = readFileSync(join(here, '../../services/shipment-containers.service.ts'), 'utf8');

const removeFlow = () => writes.slice(
  writes.indexOf('export async function removeCusShipmentContainer'),
  writes.indexOf('// ─── Bulk appointment copy'),
);

const reconcileFlow = () => containersService.slice(
  containersService.indexOf('export async function reconcileShipmentContainersInTx'),
  containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
);

// ─── SIL177-R1: đường remove của CUS workspace chặn tờ khai ──────────────────

test('remove select cả declarationNumber của dòng (không guard mù)', () => {
  assert.match(removeFlow(), /declarationNumber: s\.shipmentContainers\.declarationNumber/);
});

test('remove ném 409 kèm SỐ tờ khai thật + chỉ dẫn gỡ tờ khai TRƯỚC khi xóa dòng', () => {
  const flow = removeFlow();
  const guardAt = flow.indexOf("Cont có tờ khai ${declaredNumber}");
  const deleteAt = flow.indexOf('await tx.delete(s.shipmentContainers)');
  assert.ok(guardAt > -1, 'thiếu message guard "Cont có tờ khai <số>"');
  assert.ok(deleteAt > -1 && guardAt < deleteAt, 'guard phải chạy trước hard-delete');
  assert.match(flow, /declaredNumber !== ''[\s\S]*?new ApiError\(409/);
  assert.match(flow, /gỡ tờ khai trước khi xóa dòng container/);
});

test('guard đứng trên mọi role — không có nhánh bỏ qua cho ADMIN', () => {
  // requireWorkspaceWriter chạy trước execute; bên trong execute không được
  // có đường thoát theo role (ruling: cont có chứng từ bị chặn "đúng lý do",
  // không có ngoại lệ admin trong spec card 211026094500).
  const flow = removeFlow();
  const guardAt = flow.indexOf("Cont có tờ khai ${declaredNumber}");
  assert.ok(flow.slice(0, guardAt).indexOf('Role.ADMIN') === -1, 'không được thêm nhánh ADMIN qua guard');
});

// ─── SIL177-R2: đường reconcile (Sửa thông tin lô) không thành cửa ngõ ───────

test('reconcile chặn xóa dòng mang tờ khai bị payload bỏ sót, cùng message', () => {
  const flow = reconcileFlow();
  const guardAt = flow.indexOf('declaredVictim');
  const deleteAt = flow.indexOf('await tx.delete(s.shipmentContainers)');
  assert.ok(guardAt > -1, 'reconcile thiếu guard declaredVictim');
  assert.ok(deleteAt > -1 && guardAt < deleteAt, 'guard reconcile phải chạy trước hard-delete');
  assert.match(flow, /Cont có tờ khai \$\{declaredVictim\.declarationNumber!\.trim\(\)\} — gỡ tờ khai trước khi xóa dòng container/);
});

test('reconcile chỉ chặn dòng CÓ tờ khai — lô không tờ khai vẫn xóa bình thường', () => {
  assert.match(reconcileFlow(), /\(row\.declarationNumber\?\.trim\(\) \?\? ''\) !== ''/);
});
