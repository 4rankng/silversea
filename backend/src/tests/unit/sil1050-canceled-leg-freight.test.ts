// SIL-1050 (K2.61) — chân đã hủy không tính cước. Regression context (QA
// 25/11, lô W4A1-FCL-03 id 1241 sau Hủy phân xe — trip 609 CANCELED, lô về
// READY_FOR_DISPATCH): mọi lớp đọc cước (bảng Kiểm soát lô hàng, chi tiết
// lô, debit-merge, debit-summary) vẫn tính đủ 4.458.714₫ cho lô hết chuyến
// sống. Nguyên nhân: priced legs của chuyến bị hủy drop out đúng bởi
// active-trip scope, nhưng fallback `tripLegs ?? intake` ở BA điểm chép
// cùng luật (debit-merge grain, accounting-debit-close grain, và
// loadFreightSnapshotChannelByLot dùng cho debit-summary) hồi sinh dòng
// intake freeze (đóng băng trước phân xe) — tổng quay lại số trước hủy.
//
// Luật: intake freeze chỉ còn tính khi lô CHƯA TỪNG phân xe (không có trip)
// hoặc còn chuyến sống (luật dummy-dispatch-freeze SIL-814 giữ nguyên).
// Mọi chuyến CANCELED → không channel, không cước.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeFreezeCountsForLot } from '../../services/revenue-override-read.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(join(here, p), 'utf8');
const channelSource = read('../../services/revenue-override-read.service.ts');
const mergeSource = read('../../services/debit-merge.service.ts');
const closeSource = read('../../services/accounting-debit-close.service.ts');

describe('SIL-1050 — luật intake freeze với chuyến đã hủy (pure)', () => {
  test('lô chưa từng phân xe: intake freeze tính một lần', () => {
    assert.equal(intakeFreezeCountsForLot(undefined), true);
    assert.equal(intakeFreezeCountsForLot({ totalTrips: 0, activeTrips: 0 }), true);
  });

  test('lô còn chuyến sống: fallback giữ nguyên (luật SIL-814 dummy freeze)', () => {
    assert.equal(intakeFreezeCountsForLot({ totalTrips: 2, activeTrips: 1 }), true);
    assert.equal(intakeFreezeCountsForLot({ totalTrips: 1, activeTrips: 1 }), true);
  });

  test('lô hết chuyến sống (mọi chuyến CANCELED): intake freeze KHÔNG tính', () => {
    assert.equal(intakeFreezeCountsForLot({ totalTrips: 1, activeTrips: 0 }), false);
    assert.equal(intakeFreezeCountsForLot({ totalTrips: 3, activeTrips: 0 }), false);
  });
});

describe('SIL-1050 — cả ba điểm chép fallback đều đi qua presence law', () => {
  test('channel loader (debit-summary) nạp presence và gate intake', () => {
    assert.match(channelSource, /const tripPresence = await loadLotTripPresence\(executor, lotIds\)/);
    assert.match(channelSource, /intake != null && intakeFreezeCountsForLot\(tripPresence\.get\(lot\)\)/);
  });

  test('debit-merge grain nạp presence và gate cả psAuto lẫn snapshotChannel', () => {
    assert.match(mergeSource, /const tripPresence = await loadLotTripPresence\(db, lotIds\)/);
    assert.equal(
      (mergeSource.match(/intakeFreezeCountsForLot\(tripPresence\.get\(lot(?:\.id)?\)\)/g) ?? []).length >= 2,
      true,
      'both the psAuto pick and the effectiveFreight channel read the law',
    );
  });

  test('accounting-debit-close grain (Kiểm soát lô hàng) nạp presence và gate intake', () => {
    assert.match(closeSource, /const tripPresence = await loadLotTripPresence\(executor, lotIds\)/);
    assert.equal(
      (closeSource.match(/intakeFreezeCountsForLot\(tripPresence\.get\(lot(?:\.id)?\)\)/g) ?? []).length >= 2,
      true,
      'both the psAuto pick and the effectiveFreight channel read the law',
    );
  });

  test('presence query đếm đúng hai trục: tổng trip không-deleted và trip sống (không CANCELED)', () => {
    assert.match(
      channelSource,
      /count\(\*\) filter \(where \$\{s\.trips\.status\} <> 'CANCELED'\)/,
    );
    assert.match(channelSource, /isNull\(s\.trips\.deletedAt\)/);
  });
});
