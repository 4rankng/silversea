// SIL-1022 (K6.15a) — MỘT LUẬT snapshot khóa lô: các thành phần tách rời,
// tổng sau khóa == tổng trước khóa từng đồng. Regression lô 1225
// QA4B-2511-01 (Kế toán khóa trên Ghép bộ Debit):
//   TỔNG TC 4.052.000₫ = cước 3.952.000 (ô Cước thu merge, KHÔNG phụ phí
//   dầu) + phí ops Đảo vỏ đã duyệt 100.000 — trong khi phụ phí dầu 506.714
//   > phí ops 100.000.
// Bản khóa cũ trộn hai luật (freightAuto luật summary = 4.458.714 kế bên
// receivableTotal luật bảng = 4.052.000) → buildFrozenShipmentDebitLines
// clamp min(freight, receivable) qua hai luật: dòng FREIGHT nuốt cả phí ops,
// SERVICE_FEE sập về 0 — mất thành phần dù tổng còn đúng.
// Sau r28a, snapshot đóng băng freightAuto từ cùng ô Cước thu merge
// (3.952.000) — các pin dưới đây chốt phép tách dòng trên snapshot MỘT
// LUẬT: FREIGHT + SERVICE_FEE giữ nguyên từng phần, tổng khớp đồng.
// buildFrozenShipmentDebitLines là hàm thuần (không DB) — unit trực tiếp.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrozenShipmentDebitLines } from '../../services/shipment-cost-lock-lines';

const LÔ_1225 = {
  freightAuto: 3_952_000,
  receivableTotal: 4_052_000,
  chiHoTotal: '100000',
  freightPricingBasis: { action: 'LOCK' },
};

describe('SIL-1022 — tách dòng Debit Note trên snapshot MỘT LUẬT (phụ phí dầu > phí ops)', () => {
  test('lô 1225: FREIGHT 3.952.000 + SERVICE_FEE 100.000 — SERVICE_FEE không mất, tổng == TỔNG TC đã khóa', () => {
    const lines = buildFrozenShipmentDebitLines({ ...LÔ_1225 }, 'QA4B-2511-01');
    assert.equal(lines.length, 2);
    const freight = lines[0]!;
    const serviceFee = lines[1]!;
    assert.equal(freight.lineType, 'FREIGHT');
    assert.equal(freight.grossAmount, 3_952_000);
    assert.equal(serviceFee.lineType, 'SERVICE_FEE');
    assert.equal(serviceFee.grossAmount, 100_000, 'phí ops Đảo vỏ 100.000 sống sót thành SERVICE_FEE, không nuốt vào FREIGHT');
    assert.equal(
      lines.reduce((sum, line) => sum + line.grossAmount!, 0),
      LÔ_1225.receivableTotal,
      'tổng note == tổng trước khóa từng đồng',
    );
  });

  test('bảo toàn thành phần: freight ≤ receivable thì tổng dòng luôn == receivableTotal', () => {
    const lines = buildFrozenShipmentDebitLines({ ...LÔ_1225, chiHoTotal: '0' }, 'QA4B-2511-02');
    assert.equal(lines.reduce((sum, line) => sum + line.grossAmount!, 0), 4_052_000);
  });

  test('giảm giá đàm phán (freight > receivable, cùng MỘT luật): clamp là ý nghĩa thương mại, không còn lỗi trộn luật', () => {
    const discounted = buildFrozenShipmentDebitLines(
      { ...LÔ_1225, freightAuto: 3_952_000, receivableTotal: 3_500_000 },
      'QA4B-2511-03',
    );
    assert.equal(discounted.length, 1);
    assert.equal(discounted[0]!.lineType, 'FREIGHT');
    assert.equal(discounted[0]!.grossAmount, 3_500_000);
    assert.equal(discounted[0]!.typeLabel, 'Cước vận tải (đã khóa)');
  });

  test('snapshot legacy khóa trước r28a (freightAuto = receivableTotal, cùng luật summary) giữ nguyên luật cũ', () => {
    const legacy = buildFrozenShipmentDebitLines(
      { freightAuto: 4_458_714, receivableTotal: 4_458_714, chiHoTotal: '0', freightPricingBasis: { action: 'LOCK' } },
      'QA4B-LEGACY-1225',
    );
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0]!.lineType, 'FREIGHT');
    assert.equal(legacy[0]!.grossAmount, 4_458_714);
  });
});
