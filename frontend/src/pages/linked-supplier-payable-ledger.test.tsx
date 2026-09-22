import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';
import { LinkedSupplierPayableLedger } from '../features/accounting/linked-supplier-payable';
import { DualEntityLookupError } from '../features/accounting/receivable-ledger';
import { matchLinkedSupplierStatement } from './linked-supplier-statement';

function ledgerRow(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 41,
    timestamp: '2026-07-20T08:30:00.000Z',
    txnType: TxnType.VENDOR_EXPENSE,
    txnId: null,
    receiptId: 'CP-20260720-01',
    entityType: 'VENDOR',
    entityId: 7,
    credit: '5300000',
    debit: '1800000',
    balance: '3500000',
    note: 'Cước thuê ngoài tháng 7',
    createdAt: '2026-07-20T08:30:00.000Z',
    ...overrides,
  };
}

describe('linked supplier payable ledger', () => {
  it('surfaces a failed linked-identity lookup instead of hiding AP', () => {
    const onRetry = vi.fn();
    render(<DualEntityLookupError onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain('công nợ phải trả liên kết');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  const requiredProps = {
    isError: false,
    onRetry: () => {},
  };

  it('never reuses placeholder rows from a previously viewed supplier', () => {
    const previous = { supplier: { id: 6 }, ledgerRows: [ledgerRow({ entityId: 6 })] };

    expect(matchLinkedSupplierStatement(previous, 7)).toBeUndefined();
    expect(matchLinkedSupplierStatement(previous, 6)).toBe(previous);
  });

  it.each([
    { isCompact: false, presentation: 'desktop' },
    { isCompact: true, presentation: 'compact' },
  ])('shows itemized payable rows in the $presentation presentation', ({ isCompact }) => {
    render(
      <LinkedSupplierPayableLedger
        supplierId={7}
        supplierName="Nhà xe Minh Long"
        rows={[ledgerRow()]}
        isCompact={isCompact}
        isLoading={false}
        arBalance={9200000}
        apBalance={3500000}
        {...requiredProps}
      />,
    );

    const ledger = screen.getByRole('region', {
      name: 'Chi tiết công nợ phải trả của Nhà xe Minh Long',
    });
    expect(within(ledger).getByText('20/07/2026')).toBeTruthy();
    expect(within(ledger).getByText('CP-20260720-01')).toBeTruthy();
    expect(within(ledger).getByText('Ghi nhận chi phí')).toBeTruthy();
    expect(within(ledger).getByText('Cước thuê ngoài tháng 7')).toBeTruthy();
    expect(within(ledger).getByText('Phải trả')).toBeTruthy();
    expect(within(ledger).getByText('Đã trả')).toBeTruthy();
    expect(within(ledger).getByText('Số dư')).toBeTruthy();
    expect(within(ledger).getByRole('link', { name: 'Mở trang công nợ nhà cung cấp' }).getAttribute('href'))
      .toBe('/payables/7');
  });

  it('shows an empty state after a linked supplier statement loads without rows', () => {
    render(
      <LinkedSupplierPayableLedger
        supplierId={7}
        supplierName="Nhà xe Minh Long"
        rows={[]}
        isCompact
        isLoading={false}
        arBalance={0}
        apBalance={0}
        {...requiredProps}
      />,
    );

    expect(screen.getByText('Chưa có giao dịch công nợ phải trả')).toBeTruthy();
  });

  it('labels supplier commission entries', () => {
    render(
      <LinkedSupplierPayableLedger
        supplierId={7}
        supplierName="Nhà xe Minh Long"
        rows={[ledgerRow({ txnType: TxnType.COMMISSION })]}
        isCompact={false}
        isLoading={false}
        arBalance={0}
        apBalance={3500000}
        {...requiredProps}
      />,
    );

    expect(screen.getByText('Hoa hồng')).toBeTruthy();
  });

  it('surfaces a load failure and lets the accountant retry', () => {
    const onRetry = vi.fn();
    render(
      <LinkedSupplierPayableLedger
        supplierId={7}
        supplierName="Nhà xe Minh Long"
        rows={[]}
        isCompact={false}
        isLoading={false}
        isError
        onRetry={onRetry}
        arBalance={0}
        apBalance={3500000}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Không thể tải');
    expect(screen.queryByText('Chưa có giao dịch công nợ phải trả')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
