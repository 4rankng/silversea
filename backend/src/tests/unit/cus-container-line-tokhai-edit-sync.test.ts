// SIL-184 (card 261022095235a, CUS-05 clarify, QA R42): sửa tờ khai inline
// TẠI CHỖ phải kéo cả lô theo — không chỉ fill cont trống (FB-109) mà còn
// cập nhật các cont đang giữ CHÍNH SỐ CŨ (bản copy cùng lô). Cont đã có số
// KHÁC (divergence chủ đích, card 261013200312) thì KHÔNG bao giờ bị đụng.
// Pin wiring nguồn ở ranh giới unit cho phép (không db).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const writes = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');

const lineUpdateFlow = () => writes.slice(
  writes.indexOf('export async function updateCusShipmentContainerLine'),
  writes.indexOf('export async function addCusShipmentContainer'),
);

test('SỬA tờ khai: fan-out phủ cả sibling đang giữ SỐ CŨ của dòng được sửa (btrim so khớp)', () => {
  assert.match(
    lineUpdateFlow(),
    /OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = \$\{container\.declarationNumber\.trim\(\)\}/,
  );
});

test('predicate vẫn mở đầu bằng fill-trống (FB-109 không hồi quy)', () => {
  assert.match(
    lineUpdateFlow(),
    /\$\{s\.shipmentContainers\.declarationNumber\} IS NULL OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = ''/,
  );
});

test('divergence vẫn được bảo vệ: chỉ empty HOẶC số-cũ được ghi — không có UPDATE blanket toàn lô', () => {
  // Fan-out duy nhất của line-update là câu WHERE ở trên; không được xuất hiện
  // câu update siblings thiếu predicate (IS NULL/btrim).
  const flow = lineUpdateFlow();
  const updates = [...flow.matchAll(/await tx\.update\(s\.shipmentContainers\)\.set\(\{[\s\S]*?\}\)\.where\(/g)];
  assert.ok(updates.length >= 2, 'phải có update dòng chính + update siblings');
  for (const match of updates) {
    const tail = flow.slice(match.index!, match.index! + 600);
    if (/declarationNumber: nextDeclarationNumber/.test(tail) && /ne\(s\.shipmentContainers\.id, container\.id\)/.test(tail)) {
      assert.match(tail, /IS NULL OR btrim/, 'fan-out siblings phải giữ predicate trống-hoặc-số-cũ');
    }
  }
});

test('match số-cũ chỉ bật khi dòng gốc ĐÃ có số (thêm mới giữ nguyên FB-109)', () => {
  assert.match(lineUpdateFlow(), /container\.declarationNumber != null\s*\?\s*sql` OR btrim/);
});

test('XÓA số (clear) vẫn local — fan-out chỉ chạy khi số mới khác null', () => {
  const flow = lineUpdateFlow();
  const nullGate = flow.indexOf('if (nextDeclarationNumber != null) {');
  const fanout = flow.indexOf('const syncedSiblings');
  assert.ok(nullGate > -1 && fanout > nullGate, 'fan-out phải nằm trong nhánh nextDeclarationNumber != null');
});

test('response vẫn khai báo declarationSync cho toast (không đổi wire)', () => {
  assert.match(lineUpdateFlow(), /declarationSyncedContainerIds != null && declarationSyncedContainerIds\.length > 0/);
});

// ─── Không hồi quy: luật xóa tờ khai SIL-177 cùng file không bị xáo trộn ────

test('remove guard SIL-177 vẫn nguyên trong cùng service', () => {
  assert.match(writes, /Cont có tờ khai \$\{declaredNumber\} — gỡ tờ khai trước khi xóa dòng container/);
});
