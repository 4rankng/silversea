import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EXPENSE_COST_GROUPS,
  EXPENSE_COST_GROUP_REQUIRED_FUND,
  EXPENSE_COST_GROUP_LABELS,
  expenseCostLineName,
} from './expense-accounting';

/** SIL-1098 (KB §5.4.5 K5.35 = §6.2 K6.12; QuyTrinhO2C.md §7.5) — bảng nguồn
 *  quỹ theo dòng chi là HỢP ĐỒNG dùng chung cho guard server
 *  (`assertVoucherFundMatches`) và hộp thoại lập phiếu (`voucherFundIssue`);
 *  hai cổng lệch nhau là phiếu sai quỹ lọt hoặc phiếu đúng quỹ bị oan. */
describe('EXPENSE_COST_GROUP_REQUIRED_FUND — K5.35', () => {
  test('mọi nhóm chi phí đều có nguồn quỹ bắt buộc (map không thiếu nhóm)', () => {
    for (const group of EXPENSE_COST_GROUPS) {
      assert.ok(EXPENSE_COST_GROUP_REQUIRED_FUND[group], `thiếu nguồn quỹ cho ${group}`);
    }
  });

  test('chi hộ có hóa đơn (kể cả chi phí hóa đơn) → Quỹ tiền mặt; ứng Ops / chi phí lô không hóa đơn / phát sinh Ops / tiền đường / cược container → Quỹ công ty', () => {
    for (const group of EXPENSE_COST_GROUPS) {
      const invoicedFamily = group === 'INVOICED_LIFT' || group === 'INVOICED_DROP' || group === 'INVOICED_OTHER' || group === 'INVOICE_SERVICE';
      assert.equal(EXPENSE_COST_GROUP_REQUIRED_FUND[group], invoicedFamily ? 'TM' : 'COMPANY', group);
    }
  });

  test('tên dòng khi từ chối = tên phí + nhãn nhóm; tên phí trống thì lấy nhãn nhóm', () => {
    assert.equal(expenseCostLineName('Nâng vỏ', 'INVOICED_LIFT'), `Nâng vỏ (${EXPENSE_COST_GROUP_LABELS.INVOICED_LIFT})`);
    assert.equal(expenseCostLineName('   ', 'INVOICED_LIFT'), EXPENSE_COST_GROUP_LABELS.INVOICED_LIFT);
    assert.equal(expenseCostLineName('Phí lẻ', null), 'Phí lẻ');
    assert.equal(expenseCostLineName(null, null), '—');
  });
});
