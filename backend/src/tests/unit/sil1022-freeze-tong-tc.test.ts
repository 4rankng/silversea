// SIL-1022 (K6.15a) — Khóa lô phải đóng băng số liệu: TỔNG TC không được đổi
// khi khóa/mở khóa. Regression context (staging, lô 1225 QA4B-2511-01):
// trước khi khóa TỔNG TC 4.052.000₫, sau khi khóa 4.458.714₫ (+406.714₫ =
// phụ phí 506.714 − chi phí Đảo vỏ 100.000), mở khóa về lại 4.052.000₫.
// Nguyên nhân: buildCostSnapshot freezing `receivableTotal` từ
// getShipmentDebitSummary — luật tổng của summary (freight từ total_amount
// = cước + phụ phí; ops = Σ thô customer_charge_amount) khác luật của bảng
// Ghép bộ Debit (freight_amount; ops theo debitMergeOpsChargeContribution).
// Luật mới: bản khóa ghi control.tongTc ĐÚNG như bảng hiển thị lúc khóa
// (freeze đọc cùng ô TỔNG TC merge — cùng họ luật 'Tổng TC đọc cùng ô Cước
// thu merge' của SIL-855/debit-note-money-law).
//
// buildCostSnapshot là db-bound, nên dây nối được pin bằng source scan —
// cùng style debit-note-unpriced-freight-guard.test.ts (ruling unit-only
// 19/10: unit tests không đụng DB).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const costLockSource = readFileSync(
  join(here, '../../services/shipment-cost-lock.service.ts'),
  'utf8',
);
const mergeSource = readFileSync(
  join(here, '../../services/debit-merge.service.ts'),
  'utf8',
);

function buildCostSnapshotBody(): string {
  const start = costLockSource.indexOf('async function buildCostSnapshot');
  assert.ok(start > 0, 'buildCostSnapshot anchor found');
  const end = costLockSource.indexOf('export interface LockShipmentCostInput');
  assert.ok(end > start, 'freeze body slice bounded');
  return costLockSource.slice(start, end);
}

describe('SIL-1022 — freeze TỔNG TC theo luật bảng Ghép bộ Debit', () => {
  test('buildCostSnapshot đọc control.tongTc từ getDebitMergeBoard với phạm vi shipmentIds', () => {
    const freeze = buildCostSnapshotBody();
    assert.match(freeze, /getDebitMergeBoard\(\{ shipmentIds: \[shipmentId\] \}\)/);
    assert.match(freeze, /mergeBoard\.items\.find\(\(row\) => row\.shipmentId === shipmentId\)/);
    assert.match(freeze, /mergeItem\?\.control\.tongTc/);
  });

  test('snapshot ghi receivableTotal từ giá trị bảng, không còn từ summary', () => {
    const freeze = buildCostSnapshotBody();
    assert.match(freeze, /receivableTotal: frozenTongTc/);
    assert.doesNotMatch(freeze, /receivableTotal: item\?\.receivableTotal/);
    // freightAuto/chiHoTotal vẫn đóng băng từ summary item (luật SIL-855/SIL-693
    // không đổi): cước dùng cho guard unpriced + cap dòng FREIGHT của Debit Note.
    assert.match(freeze, /freightAuto: item\?\.freightAuto \?\? null/);
    assert.match(freeze, /chiHoTotal: item\?\.chiHoTotal \?\? null/);
  });

  test('getDebitMergeBoard hỗ trợ thu hẹp theo shipmentIds (điều kiện inArray id)', () => {
    assert.match(
      mergeSource,
      /if \(query\.shipmentIds != null && query\.shipmentIds\.length > 0\) \{\s*conditions\.push\(inArray\(s\.shipments\.id, query\.shipmentIds\)\);/,
    );
  });

  test('chuỗi khóa board→freeze: mergeItem được tìm trước khi đóng băng, payables đọc sau', () => {
    const freeze = buildCostSnapshotBody();
    const boardAt = freeze.indexOf('getDebitMergeBoard({ shipmentIds: [shipmentId] })');
    const frozenAt = freeze.indexOf('receivableTotal: frozenTongTc');
    assert.ok(boardAt > 0 && frozenAt > boardAt, 'the freeze reads the board value it stores');
  });
});
