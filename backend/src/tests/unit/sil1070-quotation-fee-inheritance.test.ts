// SIL-1070 (id 1241, KB Ch.5 §5.1.5 K5.6, QA staging 99c711f2 26/11): "Tạo
// báo giá" cùng khách mở khung mới với mục "Chi phí khác" RỖNG (GET
// /api/quotations/13 → fees: [] trong khi bản trước /api/quotations/12 đủ 9
// dòng) — createQuotation ghi đúng payload, không bao giờ kế thừa. Luật K5.6:
// bản khung mới kế thừa nguyên vẹn danh mục phí của bản trước cùng khách
// (tên phí, loại phụ, số tiền mặc định, gán cột riêng, ghi chú, thứ tự).
//
// Wiring được pin ở ranh giới unit cho phép (không db) — same convention as
// sil789-declaration-cost-lock.test.ts / sil1054-cost-lock-write-guards.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '../..', rel), 'utf8');
const slice = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));
const sharedSchema = readFileSync(join(here, '../../../..', 'shared/src/schemas/quotation.ts'), 'utf8');

const quotationService = read('services/quotation.service.ts');
const importService = read('services/quotation-import.service.ts');

const createFlow = () => slice(quotationService, 'export async function createQuotation', 'export async function updateQuotation');
const inheritFlow = () => slice(quotationService, 'export async function inheritPriorFrameFees', 'async function loadFees');

test('createQuotation: payload có phí → ghi đúng payload (supersede)', () => {
  const flow = createFlow();
  const writeAt = flow.indexOf('await writeFees(row.id, input.fees, ex)');
  const inheritAt = flow.indexOf('await inheritPriorFrameFees(input.customerId, row.id, ex)');
  assert.ok(writeAt > -1, 'nhánh explicit fees mất writeFees');
  assert.ok(inheritAt > -1, 'nhánh inherit mất');
  assert.ok(writeAt < inheritAt, 'nhánh explicit phải đứng trước nhánh inherit');
  assert.match(flow, /if \(input\.fees\.length > 0\) \{[\s\S]*?writeFees[\s\S]*?\} else \{[\s\S]*?inheritPriorFrameFees/);
});

test('createQuotation: payload trống phí → kế thừa danh mục của bản trước cùng khách (K5.6)', () => {
  const flow = createFlow();
  assert.match(flow, /await inheritPriorFrameFees\(input\.customerId, row\.id, ex\)/);
  assert.match(flow, /KHÔNG bao giờ mở khung mới mà rỗng phí khi khách đã có khung|never opens fee-less|never opens fee-less when the customer already has one/);
});

test('inheritPriorFrameFees: chọn bản trước MỚI NHẤT cùng khách, khác khung mới, chưa xóa', () => {
  const flow = inheritFlow();
  assert.match(flow, /eq\(s\.quotations\.customerId, customerId\)/);
  assert.match(flow, /ne\(s\.quotations\.id, newQuotationId\)/);
  assert.match(flow, /isNull\(s\.quotations\.deletedAt\)/);
  assert.match(flow, /\.orderBy\(desc\(s\.quotations\.effectiveDate\), desc\(s\.quotations\.updatedAt\)\)/);
  assert.match(flow, /\.limit\(1\)/);
});

test('inheritPriorFrameFees: sao chép nguyên vẹn 6 thuộc tính, bỏ row phí đã xóa mềm', () => {
  const flow = inheritFlow();
  for (const column of ['feeName', 'subType', 'defaultAmount', 'routing', 'note', 'sortOrder']) {
    assert.match(flow, new RegExp(`${column}: s\\.quotationFees\\.${column}`), `thiếu cột ${column}`);
  }
  assert.match(flow, /isNull\(s\.quotationFees\.deletedAt\)/, 'phí xóa mềm của bản trước không kế thừa');
  assert.match(flow, /quotationId: newQuotationId/);
});

test('DUY NHẤT một luật phí: import xlsx gọi chung helper (nhánh khung đầu tiên), khối phí không tự chọn/sao chép danh mục inline', () => {
  // SIL-1152: helper nhận frameId — khung đầu tiên birth qua nhánh else của
  // active-frame lookup; re-import vào khung đang hiệu lực KHÔNG đụng phí.
  assert.match(importService, /await inheritPriorFrameFees\(enriched\.customerId, frameId, tx\)/);
  // The duplicated fee-selection/copy law must not come back inside the fee
  // block. The ACTIVE-frame lookup outside it is SIL-1152's own selection
  // (frame reuse, not fee inheritance) — allowed there, banned here.
  const feeBlock = slice(importService, '// SIL-1153 (QA logic wave 28/11)', '// SIL-1152: a re-import replaces');
  assert.ok(!feeBlock.includes('orderBy(desc(s.quotations'), 'khối phí còn chọn prior frame riêng lẻ');
  assert.ok(!feeBlock.includes('values(priorFees'), 'khối phí còn sao chép danh mục prior inline');
});

test('schema create giữ fees mặc định rỗng — payload trống là ngỏ ý kế thừa', () => {
  assert.match(sharedSchema, /fees: z\.array\(quotationFeeSchema\)\.max\(200\)\.default\(\[\]\)/);
});
