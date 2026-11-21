import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDebitRateOverridesToCells,
  computeDebitBoardProfit,
  mergeContainerOverrides,
  type DebitBoardDerivedCells,
  type ShipmentDebitRateOverrides,
} from '../services/accounting-debit-close.service';

// SIL-864 — QA verdict build 32e22c12 (role hoapt, 19:18 SGT), lô K5K5346365,
// 2 container MNBU0006614 + MNBU0006609 (VĂN LAN): baseline CẢ HAI dòng
// Cước thu 4.160.000₫ / Tổng thu 4.160.000₫ / Tổng trả 1.002₫ (Phát sinh ĐV)
// / Lợi nhuận 4.158.998₫ — một giá trị cấp-lô mirror vào cả 2 dòng, inline
// edit 1 dòng đổi CẢ HAI. Overrides bây giờ là per-(lot, container): dòng
// baseline cấp lô (container NULL) + dòng riêng từng container đè
// field-by-field; dòng không có edit giữ baseline.

const BASELINE: ShipmentDebitRateOverrides = {
  cuocThu: '4160000', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
  cuocTraDv: null, lachHuyenDv: null, phatSinhDv: '1002', phiRu: null,
};
const EDIT_MNBU0006609: ShipmentDebitRateOverrides = {
  cuocThu: '4161000', lachHuyenThu: null, phuPs: null, phatSinhCus: null,
  cuocTraDv: null, lachHuyenDv: null, phatSinhDv: '2002', phiRu: null,
};
const DERIVED: DebitBoardDerivedCells = {
  cuocThu: '4160000', cuocThuKnown: true,
  lachHuyen: null, lachHuyenKnown: false,
  phuPs: null, phuPsKnown: false,
  phatSinhCus: null, phatSinhCusKnown: false,
  cuocTraDv: null, cuocTraDvKnown: false,
  lachHuyenDv: null, lachHuyenDvKnown: false,
  phatSinhDv: '1002', phatSinhDvKnown: true,
  phiRu: null,
};

describe('mergeContainerOverrides + per-container money — SIL-864', () => {
  test('the edited row (MNBU0006609) shows its own edit; the sibling keeps the baseline', () => {
    // MNBU0006609: Cước thu 4.160.000 → 4.161.000 và Phát sinh ĐV 1.002 →
    // 2.002 — CHỈ dòng này.
    const effective6609 = mergeContainerOverrides(BASELINE, EDIT_MNBU0006609);
    assert.equal(effective6609?.cuocThu, '4161000');
    assert.equal(effective6609?.phatSinhDv, '2002');
    const cells6609 = applyDebitRateOverridesToCells(DERIVED, effective6609);
    assert.equal(cells6609.thu.cuocThu, '4161000');
    assert.equal(cells6609.thu.tongThu, '4161000');
    assert.equal(cells6609.tra.tong1, '2002');
    assert.equal(computeDebitBoardProfit(cells6609.thu.tongThu, cells6609.tra.tong1, null), '4158998');

    // MNBU0006614: KHÔNG có dòng override riêng → giữ baseline, mirror phải bỏ.
    const effective6614 = mergeContainerOverrides(BASELINE, undefined);
    const cells6614 = applyDebitRateOverridesToCells(DERIVED, effective6614);
    assert.equal(cells6614.thu.cuocThu, '4160000');
    assert.equal(cells6614.thu.tongThu, '4160000');
    assert.equal(cells6614.tra.tong1, '1002');
    assert.equal(computeDebitBoardProfit(cells6614.thu.tongThu, cells6614.tra.tong1, null), '4158998');
    assert.notEqual(cells6614.thu.cuocThu, cells6609.thu.cuocThu);
  });

  test('container row wins FIELD-BY-FIELD — untouched fields fall back to the lot baseline', () => {
    const partial: ShipmentDebitRateOverrides = {
      ...EDIT_MNBU0006609, phatSinhDv: null, // this edit only touches Cước thu
    };
    const effective = mergeContainerOverrides(BASELINE, partial);
    assert.equal(effective?.cuocThu, '4161000'); // container field wins
    assert.equal(effective?.phatSinhDv, '1002'); // baseline field survives
  });

  test('a lot without a container edit row keeps the baseline identity', () => {
    assert.equal(mergeContainerOverrides(BASELINE, undefined), BASELINE);
    assert.equal(mergeContainerOverrides(undefined, undefined), undefined);
    assert.deepEqual(mergeContainerOverrides(undefined, EDIT_MNBU0006609), EDIT_MNBU0006609);
  });
});
