// SIL-805 — Bảng Kiểm soát lô hàng: kế toán sửa trực tiếp 8 ô giá/chi phí.
// Merge law: một override thay giá trị tự động của ĐÚNG ô đó và tính là
// KNOWN (kể cả 0 — một con số 0 tài chính là một giá trị, card 20261002_293);
// Tổng thu/Tổng trả roll từ các ô đã merge (Phí RU chỉ hiển thị) nên Lợi
// nhuận = Tổng thu − Tổng trả − Chi phí ngoài đọc override. Pure merge —
// no db, no app boot (BE unit-only law).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDebitRateOverridesToCells,
  computeDebitBoardProfit,
  paymentTermWarningForLot,
  type DebitBoardDerivedCells,
} from '../../services/accounting-debit-close.service';

// Derived channels matching the SIL-771 fixture: tongThu 1.790.000,
// tong1 480.000, RU 150.000 (display-only).
const derived: DebitBoardDerivedCells = {
  cuocThu: '1000000', cuocThuKnown: true,
  lachHuyen: '90000', lachHuyenKnown: true,
  phuPs: '200000', phuPsKnown: true,
  phatSinhCus: '500000', phatSinhCusKnown: true,
  cuocTraDv: '400000', cuocTraDvKnown: true,
  lachHuyenDv: '50000', lachHuyenDvKnown: true,
  phatSinhDv: '30000', phatSinhDvKnown: true,
  phiRu: '150000',
};

describe('applyDebitRateOverridesToCells (SIL-805)', () => {
  it('không có override → các ô và tổng giữ nguyên kênh tự động', () => {
    const cells = applyDebitRateOverridesToCells(derived, undefined);
    assert.deepEqual(cells.thu, { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' });
    assert.deepEqual(cells.tra, { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' });
  });

  it('override thay giá trị tự động của đúng ô đó', () => {
    const cells = applyDebitRateOverridesToCells(derived, {
      cuocThu: null, lachHuyenThu: '1200000', phuPs: null, phatSinhCus: null,
      cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    assert.equal(cells.thu.lachHuyen, '1200000');
    assert.equal(cells.thu.tongThu, '2900000'); // 1000000 + 1200000 + 200000 + 500000
  });

  it('override cả hai bên → Tổng thu và Tổng trả đều đọc override', () => {
    const cells = applyDebitRateOverridesToCells(derived, {
      cuocThu: '1500000', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
      cuocTraDv: '350000', lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    assert.equal(cells.thu.cuocThu, '1500000');
    assert.equal(cells.thu.tongThu, '2290000'); // 1500000 + 90000 + 200000 + 500000
    assert.equal(cells.tra.cuocTraDv, '350000');
    assert.equal(cells.tra.tong1, '430000'); // 350000 + 50000 + 30000
  });

  it('override 0 trên ô ĐÃ BIẾT là computed zero — tổng tính 0 (card 20261002_293)', () => {
    const pricedOnce: DebitBoardDerivedCells = {
      ...derived, cuocThu: '1000000', cuocThuKnown: true,
    };
    const cells = applyDebitRateOverridesToCells(pricedOnce, {
      cuocThu: '0', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
      cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    assert.equal(cells.thu.cuocThu, '0');
    assert.equal(cells.thu.tongThu, '790000'); // 0 + 90000 + 200000 + 500000
  });

  it('override 0 trên ô CHƯA XÁC ĐỊNH không định giá — ô giữ trống, không bịa 0 (luật 24/10, lô R3K-J1)', () => {
    const emptyDerived: DebitBoardDerivedCells = {
      cuocThu: null, cuocThuKnown: false,
      lachHuyen: null, lachHuyenKnown: false,
      phuPs: null, phuPsKnown: false,
      phatSinhCus: null, phatSinhCusKnown: false,
      cuocTraDv: null, cuocTraDvKnown: false,
      lachHuyenDv: null, lachHuyenDvKnown: false,
      phatSinhDv: null, phatSinhDvKnown: false,
      phiRu: null,
    };
    const cells = applyDebitRateOverridesToCells(emptyDerived, {
      cuocThu: '0', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
      cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    assert.equal(cells.thu.cuocThu, null);
    assert.equal(cells.thu.tongThu, null); // undetermined — ô TRỐNG, không '0' giả
    assert.equal(cells.tra.tong1, null); // tra side still fully unknown
  });

  it('override biến ô Chưa xác định thành ô biết giá trị', () => {
    const missingOne: DebitBoardDerivedCells = { ...derived, phatSinhCus: null, phatSinhCusKnown: false };
    const cells = applyDebitRateOverridesToCells(missingOne, {
      cuocThu: null, lachHuyenThu: null, phuPs: null, phatSinhCus: '250000',
      cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    assert.equal(cells.thu.phatSinhCus, '250000');
    assert.equal(cells.thu.tongThu, '1540000'); // 1000000 + 90000 + 200000 + 250000
  });

  it('override Phí RU chỉ đổi hiển thị, KHÔNG vào Tổng trả', () => {
    const cells = applyDebitRateOverridesToCells(derived, {
      cuocThu: null, lachHuyenThu: null, phuPs: null, phatSinhCus: null,
      cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, phiRu: '200000',
    });
    assert.equal(cells.tra.phiRu, '200000');
    assert.equal(cells.tra.tong1, '480000');
  });

  it('chuỗi đầy đủ: override → tổng → lợi nhuận', () => {
    const cells = applyDebitRateOverridesToCells(derived, {
      cuocThu: '1500000', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
      cuocTraDv: '350000', lachHuyenDv: null, phatSinhDv: null, phiRu: null,
    });
    // Lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài (SIL-771 công thức).
    assert.equal(computeDebitBoardProfit(cells.thu.tongThu, cells.tra.tong1, '100000'), '1760000'); // 2290000 − 430000 − 100000
    assert.equal(computeDebitBoardProfit(cells.thu.tongThu, '2500000', '100000'), '-310000'); // âm giữ dấu
  });
});

describe('paymentTermWarningForLot (K2.45 — hạn thanh toán chưa xác định trên dòng bảng)', () => {
  const BROKEN_LINK = 'Chưa xác định hạn thanh toán: nhà cung cấp liên kết #7 không còn tồn tại.';
  const NO_LINK = 'Chưa xác định hạn thanh toán: nhà xe chưa có nhà cung cấp liên kết.';
  const warnings = new Map<number, string | null>([
    [7, BROKEN_LINK],
    [8, null],
    [9, NO_LINK],
  ]);

  it('mọi nhà xe còn liên kết nguyên vẹn → dòng im lặng (null, không ô cảnh báo)', () => {
    assert.equal(paymentTermWarningForLot([8, 10], warnings), null);
    assert.equal(paymentTermWarningForLot([], warnings), null);
  });

  it('nhà xe mất liên kết → lý do của server nguyên văn trên dòng', () => {
    assert.equal(paymentTermWarningForLot([7], warnings), BROKEN_LINK);
  });

  it('nhiều nhà xe hỏng liên kết → các lý do KHÁC nhau ghép một dòng, đúng thứ tự nhà xe', () => {
    assert.equal(paymentTermWarningForLot([9, 7], warnings), `${NO_LINK} · ${BROKEN_LINK}`);
  });

  it('hai nhà xe cùng một lý do → gộp một lần, không lặp', () => {
    const doubled = new Map<number, string | null>([[3, NO_LINK], [4, NO_LINK]]);
    assert.equal(paymentTermWarningForLot([3, 4], doubled), NO_LINK);
  });
});
