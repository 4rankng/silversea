import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';

import { expenseKey } from './expense-accounting-model';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';

const entry = {
  sourceKind: 'OPS', sourceId: 164, status: 'RECORDED', locked: true,
  feeName: 'Chi phí QA', shipmentCode: 'QA-EXP-164', amount: 3000,
  customerChargeAmount: 3000, expenseDate: '2026-09-16',
} as ExpenseAccountingEntry;

/** Selectable rows are the ones the per-row checkbox enables: status RECORDED
 *  (VOIDED rows can never join a confirm batch — same predicate as
 *  ExpenseBoard's "Chọn trang này"). */
const row = (sourceId: number, status: ExpenseAccountingEntry['status'] = 'RECORDED') => ({
  sourceKind: 'OPS', sourceId, status, locked: false,
  feeName: `Phí ${sourceId}`, shipmentCode: `QA-EXP-${sourceId}`, amount: 3000,
  customerChargeAmount: 3000, expenseDate: '2026-09-16',
}) as ExpenseAccountingEntry;

function renderRows(rows: ExpenseAccountingEntry[], selected: Set<string>, onSelectAll = vi.fn()) {
  render(
    <ExpenseRegisterRows
      rows={rows}
      selected={selected}
      selectable
      canViewPayments
      onSelect={vi.fn()}
      onOpen={vi.fn()}
      onSelectAll={onSelectAll}
    />,
  );
  return {
    onSelectAll,
    header: screen.getByRole('checkbox', { name: 'Chọn tất cả' }) as HTMLInputElement,
  };
}

describe('ExpenseRegisterRows', () => {
  it('describes a generic source lock without claiming that the accounting period is locked', () => {
    render(<ExpenseRegisterRows rows={[entry]} selected={new Set()} selectable={false} canViewPayments={false} onSelect={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.getByText('Đã khóa chỉnh sửa')).toBeInTheDocument();
    expect(screen.queryByText('Khóa kỳ')).not.toBeInTheDocument();
  });
});

describe('ExpenseRegisterRows — header Chọn tất cả (20260922_7)', () => {
  it('renders the Chọn tất cả control in the selection column header', () => {
    const { header } = renderRows([row(1), row(2)], new Set());
    expect(header.closest('th')).toBeTruthy();
    expect(header.checked).toBe(false);
    expect(header.indeterminate).toBe(false);
  });

  it('opt-in: hosts without onSelectAll keep the plain Chọn header (work drawer, shipment panel)', () => {
    render(<ExpenseRegisterRows rows={[row(1)]} selected={new Set()} selectable canViewPayments onSelect={vi.fn()} onOpen={vi.fn()} />);
    const th = [...document.querySelectorAll('th')].find(cell => cell.textContent.trim() === 'Chọn');
    expect(th).toBeTruthy();
    expect(th?.querySelector('input[type=checkbox]')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Chọn tất cả' })).not.toBeInTheDocument();
  });

  it('AC1: checking the header selects every selectable row on the table', () => {
    const { header, onSelectAll } = renderRows([row(1), row(2, 'VOIDED'), row(3)], new Set());
    fireEvent.click(header);
    expect(onSelectAll).toHaveBeenCalledWith(true);
  });

  it('AC2: unchecking the header clears the selection', () => {
    const rows = [row(1), row(2)];
    const { header, onSelectAll } = renderRows(rows, new Set(rows.map(expenseKey)));
    expect(header.checked).toBe(true);
    fireEvent.click(header);
    expect(onSelectAll).toHaveBeenCalledWith(false);
  });

  it('requirement 3: a partial selection renders the header mixed (indeterminate)', () => {
    const rows = [row(1), row(2)];
    const { header } = renderRows(rows, new Set([expenseKey(rows[0])]));
    expect(header.checked).toBe(false);
    expect(header.indeterminate).toBe(true);
  });

  it('requirement 3: per-row toggles stay live next to the header control', () => {
    const onSelect = vi.fn();
    render(
      <ExpenseRegisterRows
        rows={[row(7)]}
        selected={new Set()}
        selectable
        canViewPayments
        onSelect={onSelect}
        onOpen={vi.fn()}
        onSelectAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn Phí 7/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 7 }), true);
  });

  it('AC1 scope: "all" means selectable rows — a complete selectable set reads checked beside a VOIDED row', () => {
    const selectable = row(1);
    const { header } = renderRows([selectable, row(2, 'VOIDED')], new Set([expenseKey(selectable)]));
    expect(header.checked).toBe(true);
    expect(header.indeterminate).toBe(false);
  });

  it('AC1 scope: a page with no selectable rows keeps the header empty and steady', () => {
    const { header, onSelectAll } = renderRows([row(1, 'VOIDED')], new Set());
    expect(header.checked).toBe(false);
    expect(header.indeterminate).toBe(false);
    fireEvent.click(header);
    expect(onSelectAll).toHaveBeenCalledWith(true);
  });
});
