// SIL-1152 (K2.22/K5.47/K5.48) + SIL-1153 (K5.6/K2.22) — re-import của file
// báo giá phải trở thành PHIÊN BẢN MỚI của đúng khung mà file xuất ra (QA
// acceptance 28/11: xuất khung 20 → nhập lại → khung 20 lên Phiên bản 3),
// KHÔNG nhân bản khung, KHÔNG đổi tên khung, KHÔNG xóa khung nào khác
// (danh sách chưa lọc chỉ hiện khung mới nhất là LUẬT HIỂN THỊ —
// listQuotations.isActiveFrame, không phải luật dữ liệu), và KHÔNG sinh dòng
// phí từ hàng 'Phụ phí' của lưới dầu khi nhập lại (chỉ import ĐẦU TIÊN mới
// seed từ hàng đó — card _8; còn lại kế thừa/giữ nguyên danh mục).
//
// Wiring được pin ở ranh giới unit cho phép (không db) — same convention as
// sil1070-quotation-fee-inheritance.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const importService = readFileSync(join(here, '../../services/quotation-import.service.ts'), 'utf8');
const exportService = readFileSync(join(here, '../../services/quotation-export.service.ts'), 'utf8');

const commitFlow = () => importService.slice(importService.indexOf('export async function commitQuotationImport'));
const targetLookup = () => slice(commitFlow(), 'const [activeFrame]', 'const reimport');
const feeBlock = () => slice(commitFlow(), '// Card _8 (Director ruling, 2026-09-25)', '// SIL-1152: a re-import replaces');

function slice(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  assert.ok(from > -1 && to > from, `mất mốc slice: ${start} → ${end}`);
  return src.slice(from, to);
}

test('SIL-1152: xuất xlsx đóng dấu định danh khung — sheet ẩn "_khung" A1 = view.id', () => {
  assert.match(exportService, /addWorksheet\('_khung'\)/);
  assert.match(exportService, /marker\.state = 'hidden'/);
  assert.match(exportService, /marker\.getCell\('A1'\)\.value = view\.id;/);
});

test('SIL-1152: import đọc marker "_khung" — số nguyên dương, rác → không có marker', () => {
  const reader = slice(importService, 'function readQuotationFrameMarker', 'function visibleQuotationSheets');
  assert.match(reader, /getWorksheet\('_khung'\)/);
  assert.match(reader, /Number\.isInteger\(id\) && id > 0 \? id : null/);
});

test('SIL-1152: preview chỉ đọc sheet visible — marker sheet không thành sheet preview lỗi', () => {
  const filter = slice(importService, 'function visibleQuotationSheets', 'export async function previewQuotationImport');
  assert.match(filter, /sheet\.state !== 'hidden'/);
  assert.match(filter, /sheet\.state !== 'veryHidden'/);
  // Preview và commit cùng dùng một bộ lọc — marker không rò vào đường nào.
  assert.ok(commitFlow().includes('visibleQuotationSheets(workbook)'));
});

test('commit chọn khung đích: marker (đúng khách, chưa xóa) thắng, fallback = khung active mới nhất (tie-break updatedAt)', () => {
  const lookup = targetLookup();
  assert.match(lookup, /eq\(s\.quotations\.id, markerFrameId\), isNull\(s\.quotations\.deletedAt\)/);
  assert.match(lookup, /markerFrame\.customerId === enriched\.customerId\s*\n\s*\? markerFrame\s*\n\s*: activeFrame/);
  assert.match(lookup, /lte\(s\.quotations\.effectiveDate, today\)/);
  assert.match(lookup, /\.orderBy\(desc\(s\.quotations\.effectiveDate\), desc\(s\.quotations\.updatedAt\)\)/);
});

test('re-import: UPDATE khung đích — KHÔNG insert khung mới, KHÔNG đổi templateName, KHÔNG xóa khung khác', () => {
  const flow = commitFlow();
  const lookupAt = flow.indexOf('const [activeFrame]');
  const insertAt = flow.indexOf('await tx.insert(s.quotations)');
  assert.ok(lookupAt > -1 && insertAt > lookupAt, 'lookup khung đích phải đi trước insert');
  const updateBranch = slice(flow, 'if (reimport) {', '} else {');
  assert.match(updateBranch, /frameId = targetFrame\.id;/);
  assert.match(updateBranch, /effectiveDate: today/);
  assert.match(updateBranch, /surchargeRoundingMode: enriched\.roundingMode === 'NONE' \? 'NONE' : enriched\.roundingMode/);
  assert.match(updateBranch, /fuelPriceLagDays: frameLag\.fuelLagDays/);
  assert.ok(!/templateName\s*:/.test(updateBranch), 're-import không được đổi tên khung');
  // Chưa hiệu lực hoá/không xoá bất kỳ khung nào khác — K5.48 là luật hiển thị.
  assert.ok(!flow.includes('deletedAt: new Date()'), 'import không được soft-delete khung nào');
  assert.ok(!flow.includes("ne(s.quotations.id"), 'import không được chọn/supercede khung khác');
});

test('re-import: grid replace-all trên cùng khung — xoá quotation_cells của khung trước khi ghi grid mới', () => {
  const flow = commitFlow();
  assert.match(flow, /if \(reimport\) \{\s*await tx\.delete\(s\.quotationCells\)\.where\(eq\(s\.quotationCells\.quotationId, frameId\)\);\s*\}/);
  assert.match(flow, /quotationId: frameId, routeId, vehicleSizeClassId: prepared\.classId/);
});

test('SIL-1153: hàng "Phụ phí" chỉ seed trên import ĐẦU TIÊN — nhập lại KHÔNG ghi quotation_fees', () => {
  const block = feeBlock();
  assert.match(block, /if \(!reimport\) \{[\s\S]*?const feeRows = enriched\.routes\.flatMap/);
  assert.match(block, /await tx\.insert\(s\.quotationFees\)\.values\(feeRows\)/);
  assert.match(block, /await inheritPriorFrameFees\(enriched\.customerId, frameId, tx\)/);
  // Đúng MỘT điểm ghi quotation_fees trong cả commit — nhánh !reimport; và
  // nó đứng TRƯỚC replace-all cells (luật khối phí không được kéo ra sau).
  const commit = commitFlow();
  assert.equal(commit.split('insert(s.quotationFees)').length - 1, 1, 'commit chỉ được ghi fees ở seed import đầu tiên');
});

test('phiên bản: releaseQuotationVersion chạy trên khung đích — version tăng trong khung, trigger IMPORT', () => {
  const flow = commitFlow();
  assert.match(flow, /const view = await getQuotation\(quotationId\);\s*await releaseQuotationVersion\(view, \{ triggerKind: 'IMPORT', actorId \}\);/);
  assert.match(flow, /return frameId;/);
});
