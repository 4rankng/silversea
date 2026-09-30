import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpsFundBook } from '../../api/opsClient';
import { OpsFundBookSection } from './OpsFundBookSection';

/**
 * Card 20260930 — the fund book's per-row "Số dư" column must be a running
 * BALANCE, so it starts from the window's opening and ends on the window's
 * closing. It used to start at 0, which made the column disagree with the
 * "Số dư đầu kỳ" line printed directly beneath the same table as soon as a
 * date window was set (the rows are the window only).
 */
const { useOpsFundBookMock } = vi.hoisted(() => ({ useOpsFundBookMock: vi.fn() }));
vi.mock('../../hooks/useOpsQueries', () => ({ useOpsFundBook: useOpsFundBookMock }));

function book(over: Partial<OpsFundBook> = {}): OpsFundBook {
  return {
    items: [
      { key: 'advance-1', date: '2026-09-28', kind: 'ADVANCE', label: 'Tạm ứng: A', reference: null, amount: '6000000' },
      { key: 'ops-expense-1', date: '2026-09-28', kind: 'EXPENSE', label: 'Chi phí: Phí vệ sinh', reference: null, amount: '-90000' },
    ],
    closing: '6910000',
    walletBalance: '6910000',
    outstandingAdvanceBalance: '6910000',
    matches: true,
    period: { from: '2026-09-28', to: '2026-09-28' },
    periodOpening: '1000000',
    periodIn: '6000000',
    periodOut: '90000',
    periodClosing: '5910000',
    ...over,
  };
}

function balanceColumn(): string[] {
  const table = document.querySelector('.ops-wallet__table')!;
  const rows = [...table.querySelectorAll('tbody tr')];
  return rows.map((row) => row.querySelectorAll('td')[5].textContent!.trim());
}

describe('Sổ quỹ running balance', () => {
  it('starts the Số dư column at the window opening and lands on the closing', () => {
    useOpsFundBookMock.mockReturnValue({ data: book(), isLoading: false, isError: false, refetch: vi.fn() });
    render(<OpsFundBookSection />);

    // 1.000.000 opening + 6.000.000 advance − 90.000 expense.
    expect(balanceColumn()).toEqual(['7.000.000', '6.910.000']);
    // The column's last value IS the window closing the summary prints, which
    // is the property that broke: opening must be a term of the column.
    expect(document.body.textContent).toContain('Số dư đầu kỳ:');
    expect(document.body.textContent).toContain('1.000.000 ₫');
    expect(document.body.textContent).toContain('5.910.000 ₫');
  });

  it('keeps the unwindowed column unchanged (opening is 0, so it is still a plain cumulative sum)', () => {
    useOpsFundBookMock.mockReturnValue({
      data: book({ period: { from: null, to: null }, periodOpening: '0', periodClosing: '5910000', periodIn: '6000000', periodOut: '90000' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<OpsFundBookSection />);

    expect(balanceColumn()).toEqual(['6.000.000', '5.910.000']);
  });
});
