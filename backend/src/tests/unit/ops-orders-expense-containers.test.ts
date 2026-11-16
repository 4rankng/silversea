// SIL-844 (id 973) — popup Khai chi phí: khu chọn Số Cont + [Chọn tất cả] bị
// khóa với mọi lô chưa có SỐ cont (staging probe 16/11: 52/138 lots) vì
// /ops/orders chỉ project containerIds/containerNumbers từ container CÓ số.
// Hạch toán theo cont đi bằng shipmentContainerId, không cần số đã cập nhật —
// nên BE phải project ĐỦ mọi dòng cont (id + number nullable) qua trường
// `containers`, trong khi cặp containerIds/containerNumbers GIỮ NGUYÊN luật
// hiển thị SIL-601 (chỉ đếm vỏ có số). Service db-bound (BE unit-only ruling
// 2026-10-19) — pin bằng source-scan đúng mẫu house.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/ops-orders.service.ts'), 'utf8');

/** The listOpsOrders mapping tail (numbered filter → returned row shape). */
const mappingBlock = () => {
  const start = svc.indexOf('const numbered =');
  const end = svc.indexOf('export async function setShipmentPin');
  assert.ok(start > 0 && end > start, 'row mapping not found in ops-orders.service.ts');
  return svc.slice(start, end);
};

test('SIL-844: payload có trường containers — ĐỦ mọi dòng cont, không lọc theo số', () => {
  const block = mappingBlock();
  assert.match(block, /containers: \(byShipment\.get\(row\.id\) \?\? \[\]\)\.map\(/);
  assert.match(block, /\{ id: pair\.id, number: pair\.number \}/);
  // number giữ nguyên nullable — FE tự gắn nhãn "chưa có số".
  assert.doesNotMatch(block, /containers:[^}]*filter/);
});

test('SIL-844: truy vấn cont có thứ tự id xác định (ordinal "Cont N (chưa có số)" ổn định)', () => {
  assert.match(svc, /\.orderBy\(asc\(s\.shipmentContainers\.id\)\)/);
});

test('SIL-844: luật hiển thị SIL-601 giữ nguyên — containerIds/Numbers vẫn chỉ đếm vỏ CÓ số', () => {
  const block = mappingBlock();
  // numbered filter vẫn là nguồn của containerCount/containerNumbers/containerIds.
  assert.match(block, /\(pair\): pair is \{ id: number; number: string \} => pair\.number != null/);
  assert.match(block, /containerNumbers: numbered\.map\(\(pair\) => pair\.number\)/);
  assert.match(block, /containerIds: numbered\.map\(\(pair\) => pair\.id\)/);
});
