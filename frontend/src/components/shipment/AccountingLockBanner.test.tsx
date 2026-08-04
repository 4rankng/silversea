import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountingLockBanner } from './AccountingLockBanner';

describe('AccountingLockBanner', () => {
  it('shows the Debit Note authority, actor and immutable reason', () => {
    render(<AccountingLockBanner lock={{
      billingDocumentId: 12,
      billingDocumentNumber: 'DN-2026-07',
      activatedAt: '2026-08-04T08:00:00.000Z',
      activatedByName: 'Nguyễn Thị Kế Toán',
      reason: 'Đã chốt công nợ tháng 07/2026.',
    }} />);

    expect(screen.getByRole('status').textContent).toContain('Debit Note DN-2026-07');
    expect(screen.getByRole('status').textContent).toContain('Nguyễn Thị Kế Toán');
    expect(screen.getByRole('status').textContent).toContain('Đã chốt công nợ tháng 07/2026.');
  });
});
