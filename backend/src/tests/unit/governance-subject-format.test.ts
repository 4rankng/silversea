import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSubjectLabel,
  subjectKeyCustomerIds,
  subjectKeySettlementIds,
  type SubjectLabelContext,
} from '../../services/governance-subject-format';

// The approval-center queue must show approvers what they are approving, not
// a colon-delimited internal key. These tests pin the parsing contract;
// unknown formats resolve to null so the UI falls back to the raw key.
describe('governance subject formatting', () => {
  const ctx: SubjectLabelContext = {
    customerNames: new Map([[78404, 'SilverSea Logistics']]),
    settlementCodes: new Map([[12, 'PC-0026']]),
    driverNames: new Map([[7, 'Phạm Văn Hùng']]),
  };

  test('resolves customer receipt keys to customer name + receipt code', () => {
    assert.equal(
      resolveSubjectLabel('customer:78404:receipt:REC-1787478843148', ctx),
      'Khách hàng SilverSea Logistics — phiếu thu REC-1787478843148',
    );
    // Customer row gone → still human: the receipt code carries the label.
    assert.equal(
      resolveSubjectLabel('customer:999:receipt:REC-1', ctx),
      'Phiếu thu REC-1',
    );
  });

  test('collects customer and settlement ids for the batch lookups', () => {
    const keys = ['customer:1:receipt:REC-1', 'customer:2:receipt:REC-2', 'advance-settlement:12:reverse'];
    assert.deepEqual([...subjectKeyCustomerIds(keys)].sort(), [1, 2]);
    assert.deepEqual([...subjectKeySettlementIds(keys)], [12]);
  });

  test('resolves settlement keys via code, falling back to the id', () => {
    assert.equal(resolveSubjectLabel('advance-settlement:12:expense:7', ctx), 'Phiếu thanh toán PC-0026');
    assert.equal(resolveSubjectLabel('advance-settlement:99:reverse', ctx), 'Phiếu thanh toán #99');
  });

  test('labels the remaining known formats without lookups', () => {
    assert.equal(resolveSubjectLabel('trip-expense:4102:decision', ctx), 'Chi phí chuyến đi #4102');
    assert.equal(resolveSubjectLabel('payment-receipt:REC-9:refund:v3', ctx), 'Hoàn tiền phiếu thu REC-9');
    assert.equal(resolveSubjectLabel('2026-08', ctx), 'Kỳ lương 08/2026');
  });

  test('resolves driver salary keys to driver name + period', () => {
    // Salary governance writes `${driverId}:${year}-${month}`.
    assert.equal(resolveSubjectLabel('7:2026-08', ctx), 'Lương Phạm Văn Hùng — kỳ 08/2026');
    assert.equal(resolveSubjectLabel('999:2026-07', ctx), 'Bảng lương lái xe — kỳ 07/2026');
  });

  test('returns null for bare trip codes, codes, and unknown formats', () => {
    // Trip codes / treasury codes are already the labels users know — the UI
    // shows the raw key, which is correct for them.
    assert.equal(resolveSubjectLabel('TRP-2608-0042', ctx), null);
    assert.equal(resolveSubjectLabel('TR-0031', ctx), null);
    assert.equal(resolveSubjectLabel('something:odd:shape', ctx), null);
    assert.equal(resolveSubjectLabel(null, ctx), null);
    assert.equal(resolveSubjectLabel('', ctx), null);
  });
});
