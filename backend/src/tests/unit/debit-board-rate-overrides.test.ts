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

  it('override 0 là KNOWN — tổng tính 0, không rơi về null (card 20261002_293)', () => {
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
    assert.equal(cells.thu.cuocThu, '0');
    assert.equal(cells.thu.tongThu, '0'); // known 0, never null
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
