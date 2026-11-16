// SIL-843 — KH 15/11: "/ops/orders hiển thị tất cả các lô, tìm bằng kính lúp
// hiển thị ra luôn lô hàng mà không cần chọn ngày giao hàng dự kiến". Hiện
// trạng cũ: route mặc định date=hôm nay và service luôn gắn
// `eq(expectedDeliveryDate, date)` ⇒ trang trống khi hôm nay không có lô, và
// tìm kiếm vẫn bị kẹt theo ngày. Service là db-bound (BE unit-only ruling
// 2026-10-19: no connection, no app boot), nên luật xuyên ngày được chốt bằng
// source-scan đúng mẫu house (ops-orders-search-columns.test.ts): date là bộ
// lọc TÙY CHỌN và từ khóa tìm kiếm luôn bỏ điều kiện ngày.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/ops-orders.service.ts'), 'utf8');
const route = readFileSync(join(here, '../../routes/ops.ts'), 'utf8');

/** The listOpsOrders head (signature + effectiveDate + conditions array). */
const conditionsBlock = () => {
  const start = svc.indexOf('export async function listOpsOrders');
  const end = svc.indexOf('if (search && search.trim())');
  assert.ok(start > 0 && end > start, 'listOpsOrders head not found in ops-orders.service.ts');
  return svc.slice(start, end);
};

/** The GET /orders route handler (date param parsing). */
const ordersRoute = () => {
  const start = route.indexOf("router.get('/orders'");
  const end = route.indexOf("router.put('/orders/shipment-pins");
  assert.ok(start > 0 && end > start, 'GET /orders route not found in routes/ops.ts');
  return route.slice(start, end);
};

test('SIL-843: service nhận date nullable — date=null là phạm vi xuyên ngày', () => {
  assert.match(svc, /export async function listOpsOrders\(\s*userId: number,\s*date: string \| null,/);
  // expectedDeliveryDate chỉ vào WHERE khi effectiveDate có giá trị — không
  // còn điều kiện ngày vô điều kiện.
  assert.match(conditionsBlock(), /const effectiveDate = search && search\.trim\(\) \? null : date;/);
  assert.match(conditionsBlock(), /\.\.\.\(effectiveDate \? \[eq\(s\.shipments\.expectedDeliveryDate, effectiveDate\)\] : \[\]\),/);
  assert.doesNotMatch(conditionsBlock(), /eq\(s\.shipments\.expectedDeliveryDate, date\)/);
});

test('SIL-843: kính lúp tra cứu XUYÊN NGÀY — có từ khóa thì bỏ hẳn điều kiện ngày', () => {
  // Quy tắc nằm ở service nên MỌI client gọi API đều được semantics này.
  assert.match(conditionsBlock(), /const effectiveDate = search && search\.trim\(\) \? null : date;/);
});

test('SIL-843: route không còn mặc định date=hôm nay; bỏ param ⇒ toàn bộ lô đang hoạt động', () => {
  const block = ordersRoute();
  // Không có fallback formatLocalDate() — date thiếu/rỗng ⇒ null (xuyên ngày).
  assert.doesNotMatch(block, /formatLocalDate/);
  assert.match(block, /rawDate \? dateQuerySchema\.parse\(rawDate\) : null/);
  // Vẫn validate định dạng khi có param — ngày sai shape vẫn 400.
  assert.match(block, /dateQuerySchema\.parse\(rawDate\)/);
});

test('SIL-843: "đang hoạt động" giữ nguyên — lô xoá mềm và lô huỷ không lẫn vào danh sách', () => {
  assert.match(conditionsBlock(), /isNull\(s\.shipments\.deletedAt\)/);
  assert.match(conditionsBlock(), /ne\(s\.shipments\.status, 'CANCELED'\)/);
});
