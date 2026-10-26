// SIL-498 (owner ruling 26/10, QA fail lot 257): fan-out tờ khai trên SỬA
// per-cont chỉ điền sibling TRỐNG (FB-109). Sibling giữ BẤT KỲ số nào — kể cả
// chính số cũ của dòng vừa sửa — giữ nguyên: sau fan-out tạo lô, mọi dòng đều
// là bản copy của số đầu, nên luật cũ "số-cũ đi theo" (SIL-184,
// card 261022095235a) normalize TOÀN lô ở mỗi lần sửa và không bao giờ tạo
// được lô 2 tờ khai khác nhau (QA: sửa dòng 3 = TK3 → cả 3 dòng thành TK3).
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

test('SỬA tờ khai: fan-out sibling CHỈ fill trống — predicate FB-109 nguyên vẹn', () => {
  assert.match(
    lineUpdateFlow(),
    /\$\{s\.shipmentContainers\.declarationNumber\} IS NULL OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = ''/,
  );
});

test('LUẬT MỚI 26/10: KHÔNG còn mệnh đề kéo sibling giữ số-cũ đi theo (đã bỏ inSyncSiblingMatch)', () => {
  // QA lot 257: "OR btrim(...) = <số cũ>" chính là normalize lot-wide —
  // sau khi bỏ, sibling giữ số cũ (bản copy) GIỮ NGUYÊN khi dòng khác được
  // sửa sang số mới → lô 2 tờ khai khác nhau tạo được.
  assert.doesNotMatch(lineUpdateFlow(), /OR btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\) = \$\{container\.declarationNumber\.trim\(\)\}/);
  assert.doesNotMatch(lineUpdateFlow(), /inSyncSiblingMatch/);
});

test('fan-out loại trừ chính dòng được sửa (ne id) — dòng sửa luôn ghi giá trị mới', () => {
  const flow = lineUpdateFlow();
  const fanout = flow.indexOf('const syncedSiblings');
  assert.ok(fanout > -1);
  const tail = flow.slice(fanout, fanout + 500);
  assert.match(tail, /ne\(s\.shipmentContainers\.id, container\.id\)/);
  assert.match(tail, /eq\(s\.shipmentContainers\.shipmentId, args\.shipmentId\)/);
});

test('divergence được bảo vệ: mọi update siblings đều có predicate trống (không UPDATE blanket toàn lô)', () => {
  const flow = lineUpdateFlow();
  const updates = [...flow.matchAll(/await tx\.update\(s\.shipmentContainers\)\.set\(\{[\s\S]*?\}\)\.where\(/g)];
  assert.ok(updates.length >= 2, 'phải có update dòng chính + update siblings');
  for (const match of updates) {
    const tail = flow.slice(match.index!, match.index! + 600);
    if (/declarationNumber: nextDeclarationNumber/.test(tail) && /ne\(s\.shipmentContainers\.id, container\.id\)/.test(tail)) {
      assert.match(tail, /IS NULL OR btrim/, 'fan-out siblings phải giữ predicate chỉ-fill-trống');
      // Law-keyed pin (review M-1): predicate phải ĐÓNG bằng fill-trống —
      // mọi so sánh btrim của sibling trong fan-out phải có vế phải là literal
      // rỗng ('' — kể cả ''||…) ; vế phải bắt đầu bằng ký tự khác (vd
      // ${container…}, ${prev}, TRIM(…) = số cũ viết lại) là kéo sibling đi
      // theo và bị cấm.
      const predicate = tail.slice(tail.indexOf('IS NULL OR btrim'));
      assert.doesNotMatch(
        predicate,
        /(?:OR|AND)\s+btrim\(\$\{s\.shipmentContainers\.declarationNumber\}\)\s*=\s*[^\s']/,
        'không được kéo sibling giữ số-cũ đi theo dưới bất kỳ hình thức nào',
      );
    }
  }
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

test('REGRESSION SIL-498: đường TẠO lô 1 tờ khai giữ syncDeclarationOntoEmptyContainers (normalize-all là ĐÚNG ở tạo)', () => {
  // Tạo lô: mọi dòng sinh ra TRỐNG → fill-hết là đúng luật (owner 26/10).
  assert.match(writes, /await syncDeclarationOntoEmptyContainers\(tx, args\.shipmentId, lotDeclarationNumber\)/);
});

// ─── Không hồi quy: luật xóa tờ khai SIL-177 cùng file không bị xáo trộn ────

test('remove guard SIL-177 vẫn nguyên trong cùng service', () => {
  assert.match(writes, /Cont có tờ khai \$\{declaredNumber\} — gỡ tờ khai trước khi xóa dòng container/);
});
