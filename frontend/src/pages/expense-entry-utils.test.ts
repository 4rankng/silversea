import { describe, expect, it } from 'vitest';
import { expenseSubmissionMessage } from './expense-entry-utils';

describe('expenseSubmissionMessage', () => {
  it('confirms an expense and payable are recorded directly', () => {
    expect(expenseSubmissionMessage(false, { actionKind: 'COMPANY_EXPENSE' }))
      .toBe('Đã ghi nhận chi phí và công nợ nhà cung cấp.');
  });

  it('distinguishes a governed financial edit from an immediate non-financial update', () => {
    expect(expenseSubmissionMessage(true, { actionKind: 'COMPANY_EXPENSE' }))
      .toBe('Đã cập nhật chi phí và công nợ liên quan.');
    expect(expenseSubmissionMessage(true, { id: 42 }))
      .toBe('Đã cập nhật thông tin không ảnh hưởng công nợ.');
  });

  it('explains append-only replacement for a finalized expense correction', () => {
    expect(expenseSubmissionMessage(true, {
      actionKind: 'COMPANY_EXPENSE',
      deltaSnapshot: { applicationMode: 'FINALIZED_REPLACEMENT' },
    })).toBe(
      'Đã lưu bản điều chỉnh chi phí. Phiếu gốc và lịch sử thanh toán được giữ nguyên.',
    );
  });
});
