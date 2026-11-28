// SIL-1247 — "Ghi nhận thanh toán xong hộp thoại lỗi — không thấy bảng phân bổ":
// POST /payments/receive phải trả PaymentReceiptResponse đúng hợp đồng —
// result là PaymentReceiptResult ĐẦY ĐỦ (allocations included) để hộp thoại
// dựng bảng phân bổ. Cuộc chạy governance chỉ mang applicationResult (không có
// allocation rows — chính nó sập dialog bằng 'n.allocations is undefined'),
// nên route phải dựng lại result từ receipt mà applicationResult gọi tên.
// Source-scan (route-guard precedent — route wiring không có db-free runtime seam).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(here, '..', '..', 'routes', 'financial', 'payments.routes.ts'), 'utf8');

test('the receive route rebuilds the wire result from the receipt the applicationResult names', () => {
  assert.ok(routesSource.includes('loadPaymentReceiptResultTx(db, paymentReceiptId)'),
    'the wire result must be the full receipt result (allocations included)');
  assert.ok(routesSource.includes('json({ result: wireResult, replayed })'),
    'the response must send the rebuilt result');
});

test('audit identity stays the governance action, not the rebuilt receipt', () => {
  assert.ok(routesSource.includes('res.locals.auditEntityId = result.id;'));
  assert.ok(routesSource.includes('res.locals.auditEntityKey = result.subjectKey ?? data.receiptId;'));
});
