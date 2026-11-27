// SIL-1152 (K2.22/K5.47/K5.48) + SIL-1153 (K5.6/K2.22) — re-import của file
// báo giá cho khách ĐÃ có khung đang hiệu lực (vd Long Minh) từng nhân bản
// khung: commit insert một `quotations` row mới mỗi lần → 2 khung cùng 'Đang
// hiệu lực', và danh mục phí bị nh defaultCenter 'Phụ phí' hàng loạt (grid
// Phụ phí → quotation_fees per class). Luật mới: re-import trở thành PHIÊN
// BẢN MỚI trong khung đang hiệu lực của khách (cùng khung, version tăng),
// danh mục phí của khung giữ nguyên; chỉ import ĐẦU TIÊN mới sinh khung mới.
//
// Wiring được pin ở ranh giới unit cho phép (không db) — same convention as
// sil1070-quotation-fee-inheritance.test.ts / wave5-rerun-fixes.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const importService = readFileSync(join(here, '../../services/quotation-import.service.ts'), 'utf8');

const commitFlow = () => importService.slice(importService.indexOf('export async function commitQuotationImport'));
const activeFrameLookup = () => slice(commitFlow(), 'const [activeFrame]', 'const reimport');
const feeBlock = () => slice(commitFlow(), '// Card _8 (Director ruling, 2026-09-25) + SIL-1153', '// SIL-1152: a re-import replaces');

function slice(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  assert.ok(from > -1 && to > from, `mất mốc slice: ${start} → ${end}`);
  return src.slice(from, to);
}

test('commit chọn khung ĐANG HIỆU LỰC của khách trước khi ghi: effectiveDate ≤ hôm nay, mới nhất, chưa xóa', () => {
  const lookup = activeFrameLookup();
  assert.match(lookup, /eq\(s\.quotations\.customerId, enriched\.customerId\)/);
  assert.match(lookup, /isNull\(s\.quotations\.deletedAt\)/);
  assert.match(lookup, /lte\(s\.quotations\.effectiveDate, today\)/);
  assert.match(lookup, /\.orderBy\(desc\(s\.quotations\.effectiveDate\), desc\(s\.quotations\.id\)\)/);
  assert.match(lookup, /\.limit\(1\)/);
});

test('re-import: UPDATE khung đang hiệu lực (cùng khung), không insert khung mới', () => {
  const flow = commitFlow();
  // Active-frame lookup xảy ra TRƯỚC nhánh insert — re-import chưa bao giờ
  // chạm INSERT quotations.
  const lookupAt = flow.indexOf('const [activeFrame]');
  const insertAt = flow.indexOf('await tx.insert(s.quotations)');
  assert.ok(lookupAt > -1 && insertAt > lookupAt, 'lookup active frame phải đi trước insert');
  assert.match(flow, /if \(reimport\) \{\s*frameId = activeFrame\.id;\s*await tx\.update\(s\.quotations\)\.set\(/);
  const updateBranch = slice(flow, 'if (reimport) {', '} else {');
  assert.match(updateBranch, /templateName: `\$\{enriched\.sheet\} \(\$\{today\}\)`/);
  assert.match(updateBranch, /effectiveDate: today/);
  assert.match(updateBranch, /surchargeRoundingMode: enriched\.roundingMode === 'NONE' \? 'NONE' : enriched\.roundingMode/);
  assert.match(updateBranch, /fuelPriceLagDays: frameLag\.fuelLagDays/);
});

test('re-import: grid replace-all trên cùng khung — xoá quotation_cells của khung trước khi ghi grid mới', () => {
  const flow = commitFlow();
  assert.match(flow, /if \(reimport\) \{\s*await tx\.delete\(s\.quotationCells\)\.where\(eq\(s\.quotationCells\.quotationId, frameId\)\);\s*\}/);
  // Grid mới ghi vào ĐÚNG khung đang hiệu lực, không phải khung mới.
  assert.match(flow, /quotationId: frameId, routeId, vehicleSizeClassId: prepared\.classId/);
});

test('SIL-1153: khối phí file-carried chỉ chạy trên import ĐẦU TIÊN — re-import không đụng quotation_fees', () => {
  const block = feeBlock();
  assert.match(block, /if \(!reimport\) \{[\s\S]*?const feeRows = enriched\.routes\.flatMap/);
  // Toàn bộ seed/inherit phí nằm trong nhánh !reimport — phần sau khối này
  // (replace-all cells trở đi) không có INSERT quotation_fees nào.
  const afterFees = commitFlow().slice(commitFlow().indexOf('// SIL-1152: a re-import replaces'));
  assert.ok(!afterFees.includes('insert(s.quotationFees)'), 're-import còn ghi quotation_fees');
  // Nhánh khung đầu tiên vẫn giữ đủ 2 luật card _8 + inherit K5.6.
  assert.match(block, /await tx\.insert\(s\.quotationFees\)\.values\(feeRows\)/);
  assert.match(block, /await inheritPriorFrameFees\(enriched\.customerId, frameId, tx\)/);
});

test('phiên bản: releaseQuotationVersion chạy trên CÙNG quotationId — version tăng trong khung, trigger IMPORT', () => {
  const flow = commitFlow();
  assert.match(flow, /const view = await getQuotation\(quotationId\);\s*await releaseQuotationVersion\(view, \{ triggerKind: 'IMPORT', actorId \}\);/);
  // transaction trả về frameId (khung dùng lại khi re-import).
  assert.match(flow, /return frameId;/);
});
