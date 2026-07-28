import { describe, expect, it } from 'vitest';
import { expenseSubmissionMessage } from './expense-entry-utils';

describe('expenseSubmissionMessage', () => {
  it('does not claim a newly requested expense or payable already exists', () => {
    expect(expenseSubmissionMessage(false, { actionKind: 'COMPANY_EXPENSE' }))
      .toBe('Đã gửi yêu cầu ghi nhận chi phí vào hàng chờ kiểm tra. Chưa phát sinh công nợ phải trả.');
  });

  it('distinguishes a governed financial edit from an immediate non-financial update', () => {
    expect(expenseSubmissionMessage(true, { actionKind: 'COMPANY_EXPENSE' }))
      .toBe('Đã gửi thay đổi chi phí vào hàng chờ kiểm tra. Chưa cập nhật công nợ.');
    expect(expenseSubmissionMessage(true, { id: 42 }))
      .toBe('Đã cập nhật thông tin không ảnh hưởng công nợ.');
  });

  it('explains append-only replacement for a finalized expense correction', () => {
    expect(expenseSubmissionMessage(true, {
      actionKind: 'COMPANY_EXPENSE',
      deltaSnapshot: { applicationMode: 'FINALIZED_REPLACEMENT' },
    })).toBe(
      'Đã gửi điều chỉnh chi phí đã quyết toán vào hàng chờ. Phiếu gốc chưa thay đổi; sau phê duyệt hệ thống sẽ lưu một bản thay thế và giữ nguyên lịch sử.',
    );
  });
});
