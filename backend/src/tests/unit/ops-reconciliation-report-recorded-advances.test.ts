// SIL-806 (UAT 12/11) — cột ĐÃ ỨNG của bảng Quỹ cá nhân phải đọc số GỐC:
// tổng phiếu tạm ứng ĐÃ GIẢI NGÂN (RECORDED) trong kỳ, không net settlement
// hay đợt allocation (unit source pins, no db — 2026-10-19 owner ruling):
//   - Nguyễn Huy Hoàng 5 phiếu 520.000₫ hiện 0₫ vì held bị net về 0 — the
//     gross query must exist BESIDE the netted held query, never merged.
//   - Ngày trong kỳ = ngày giải ngân (approvedAt); phiếu ghi thẳng RECORDED
//     không qua duyệt dùng createdAt.
//   - A staff whose only footprint is a recorded phiếu stays visible (the
//     zero-skip must count advancedRecorded).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/ops-reconciliation-report.service.ts'),
  'utf8',
);

test('the gross recorded-advance query reads RECORDED phiếu in the kỳ window', () => {
  assert.match(source, /eq\(s\.advanceRequests\.status, 'RECORDED'\),\s*\n\s*sql`coalesce\(\$\{s\.advanceRequests\.approvedAt\}, \$\{s\.advanceRequests\.createdAt\}\)::date >= \$\{costFrom\}::date`/,
    'the window opens at the disbursement date (createdAt when never approved)');
  assert.match(source, /::date <= \$\{costTo\}::date`/,
    'the window closes at the period end date');
  // The gross sum must NOT carry the settlement/đợt netting the held query has.
  const recordedBlock = source.slice(
    source.indexOf('const recordedRows = await db.select'),
    source.indexOf('const recordedByStaff'),
  );
  assert.doesNotMatch(recordedBlock, /advanceSettlement|expenseReconciliationAdvances|notInArray/,
    'the gross sum never nets settlements or đợt allocations');
});

test('advancedRecorded serializes on every row and counts in the zero-skip', () => {
  const push = source.slice(source.indexOf('rows.push({'));
  assert.match(push, /advancedRecorded,/, 'the row serializes the gross ĐÃ ỨNG');
  const skip = source.slice(source.indexOf('if (dntt === 0'), source.indexOf('// Số âm:'));
  assert.match(skip, /advancedRecorded === 0\) continue/,
    'a recorded-only staff is not skipped from the Quỹ cá nhân table');
  assert.match(source, /\.\.\.Object\.keys\(recordedByStaff\),/,
    'recorded-advance staff keys join the row union');
});

test('the scoped (đợt) branch keeps allocation semantics and its netted held ĐÃ ỨNG', () => {
  assert.match(source, /heldByStaff\.set\(String\(batchStaffId\), Number\(row\.allocated\)\)/,
    'scoped held ĐÃ ỨNG stays the lot allocation');
  assert.match(source, /recordedByStaff\[String\(batchStaffId\)\] = Number\(row\.allocated\)/,
    'scoped recorded ĐÃ ỨNG mirrors the same allocation — one number per lot');
});
