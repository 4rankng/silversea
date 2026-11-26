// SIL-1022 (K6.15a) — Khóa lô phải đóng băng số liệu: TỔNG TC và từng thành
// phần không được đổi khi khóa/mở khóa. Regression context (staging, lô 1225
// QA4B-2511-01): trước khi khóa TỔNG TC 4.052.000₫, sau khi khóa 4.458.714₫
// (freight + phụ phí 506.714), mở khóa về lại 4.052.000₫.
//
// Root cause: buildCostSnapshot đóng băng HAI LUẬT KHÁC NHAU trong MỘT
// snapshot — freightAuto từ getShipmentDebitSummary (total_amount = cước +
// phụ phí dầu = 4.458.714) đối lập receivableTotal từ getDebitMergeBoard
// (freight_amount + phí ops = 4.052.000). Hậu quả dây chuyền:
// 1. buildFrozenShipmentDebitLines clamp min(freight, receivable) qua HAI
//    luật → phụ phí dầu > phí ops thì SERVICE_FEE sập về 0, phí ops nuốt vào
//    dòng FREIGHT (lô 1225 khóa sau fix 34911d70 vẫn sai thành phần);
// 2. profit của hàng khóa trên /shipment-debit-summary = receivableValue
//    (đóng băng, luật bảng) − freightAuto (live, luật summary) → số âm rác.
//
// Luật mới (r28a): MỘT LUẬT từ MỘT lần đọc — freightAuto đóng băng từ cùng
// ô Cước thu merge (mergeItem.revenue.cuoc) mà control.tongTc được tổng từ
// đó (SIL-805 override đã hợp nhất); receivableTotal = control.tongTc;
// profit = tam thức đóng băng cùng luật. Tổng sau khóa == tổng trước khóa
// từng đồng; các thành phần (freight / phụ phí dầu / phí ops / SERVICE_FEE)
// tách rời, giữ nguyên từng phần khi khóa.
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
const summarySource = readFileSync(
  join(here, '../../services/shipment-debit-summary.service.ts'),
  'utf8',
);

function buildCostSnapshotBody(): string {
  const start = costLockSource.indexOf('async function buildCostSnapshot');
  assert.ok(start > 0, 'buildCostSnapshot anchor found');
  const end = costLockSource.indexOf('export interface LockShipmentCostInput');
  assert.ok(end > start, 'freeze body slice bounded');
  return costLockSource.slice(start, end);
}

describe('SIL-1022 — snapshot MỘT LUẬT từ bảng Ghép bộ Debit', () => {
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
  });

  test('freightAuto đóng băng từ cùng ô Cước thu merge (một luật với receivableTotal)', () => {
    const freeze = buildCostSnapshotBody();
    assert.match(freeze, /const mergeCuoc = mergeItem\?\.revenue\.cuoc/);
    assert.match(freeze, /freightAuto: frozenFreight/);
    // Không còn freight luật-summary trong snapshot.
    assert.doesNotMatch(freeze, /freightAuto: item\?\.freightAuto/);
    assert.doesNotMatch(freeze, /freightOverrideByLot/);
    assert.doesNotMatch(freeze, /shipmentDebitRateOverrides/);
    // chi hộ vẫn là chi phí đóng băng từ summary (luật chi hộ không đổi).
    assert.match(freeze, /chiHoTotal: item\?\.chiHoTotal \?\? null/);
  });

  test('profit đóng băng theo tam thức cùng luật (tổng − cước bảng − chi hộ)', () => {
    const freeze = buildCostSnapshotBody();
    assert.match(freeze, /frozenTongTc != null && frozenFreight != null && frozenChiHo != null/);
    assert.match(freeze, /frozenTongTc - frozenFreight - frozenChiHo/);
    assert.doesNotMatch(freeze, /profit: item\?\.profit/);
  });

  test('thứ tự luật: mergeItem được tìm trước khi cả hai khóa money đóng băng', () => {
    const freeze = buildCostSnapshotBody();
    const boardAt = freeze.indexOf('getDebitMergeBoard({ shipmentIds: [shipmentId] })');
    const freightAt = freeze.indexOf('freightAuto: frozenFreight');
    const frozenAt = freeze.indexOf('receivableTotal: frozenTongTc');
    assert.ok(boardAt > 0 && frozenAt > boardAt && freightAt > boardAt, 'both frozen money keys derive from the one board read');
  });

  test('summary không còn nhận options.freightOverrideByLot (kênh chết sau thống nhất luật)', () => {
    assert.doesNotMatch(summarySource, /freightOverrideByLot/);
    // SIL-855 giữ nguyên: cột cước live đọc ghi đè ô SIL-805 từ bảng.
    assert.match(summarySource, /cuocThuOverrideByLot\.get\(lot\.id\)/);
    assert.match(summarySource, /cuocThuCellOverride !== 0 \|\| effectiveFreight\.value != null/);
  });

  test('profit hàng khóa trên summary đọc tam thức ĐÓNG BĂNG (không trộn luật live)', () => {
    assert.match(summarySource, /const frozenFreight = lock != null \? frozenNumber\(lock\.snapshot, 'freightAuto'\) : null/);
    assert.match(summarySource, /const frozenChiHo = lock != null \? frozenNumber\(lock\.snapshot, 'chiHoTotal'\) : null/);
    assert.match(summarySource, /receivableValue - frozenFreight - frozenChiHo/);
  });

  test('getDebitMergeBoard hỗ trợ thu hẹp theo shipmentIds (điều kiện inArray id)', () => {
    assert.match(
      mergeSource,
      /if \(query\.shipmentIds != null && query\.shipmentIds\.length > 0\) \{\s*conditions\.push\(inArray\(s\.shipments\.id, query\.shipmentIds\)\);/,
    );
  });

  test('chuỗi khóa board→freeze: mergeItem được tìm trước khi đóng băng', () => {
    const freeze = buildCostSnapshotBody();
    const boardAt = freeze.indexOf('getDebitMergeBoard({ shipmentIds: [shipmentId] })');
    const frozenAt = freeze.indexOf('receivableTotal: frozenTongTc');
    assert.ok(boardAt > 0 && frozenAt > boardAt, 'the freeze reads the board value it stores');
  });
});
