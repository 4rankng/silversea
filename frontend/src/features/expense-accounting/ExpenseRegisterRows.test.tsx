import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';

const entry = {
  sourceKind: 'OPS', sourceId: 164, status: 'RECORDED', locked: true,
  feeName: 'Chi phí QA', shipmentCode: 'QA-EXP-164', amount: 3000,
  customerChargeAmount: 3000, expenseDate: '2026-09-16',
} as ExpenseAccountingEntry;

describe('ExpenseRegisterRows', () => {
  it('describes a generic source lock without claiming that the accounting period is locked', () => {
    render(<ExpenseRegisterRows rows={[entry]} selected={new Set()} selectable={false} canViewPayments={false} onSelect={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.getByText('Đã khóa chỉnh sửa')).toBeInTheDocument();
    expect(screen.queryByText('Khóa kỳ')).not.toBeInTheDocument();
  });
});
