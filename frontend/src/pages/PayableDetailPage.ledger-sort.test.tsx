import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxnType } from '@tingting/shared';

const { useSupplierStatementMock, useToastMock } = vi.hoisted(() => ({
  useSupplierStatementMock: vi.fn(),
  useToastMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  useSupplierStatement: useSupplierStatementMock,
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: useToastMock }),
}));

vi.mock('../components/UI', () => ({
  Modal: () => null,
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

vi.mock('../components/billing/BillingDocumentsPanel', () => ({
  default: () => null,
}));

import PayableDetailPage from './PayableDetailPage';

function ledgerRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    timestamp: '2026-07-01T00:00:00.000Z',
    txnType: TxnType.VENDOR_EXPENSE,
    txnId: null,
    receiptId: null,
    entityType: 'VENDOR',
    entityId: 5,
    credit: '0',
    debit: '0',
    balance: '0',
    note: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    containerNumbers: null,
    tripId: null,
    tripCode: null,
    routeName: null,
    serviceFeeLabel: null,
    fuelDetails: null,
    expenseDetails: null,
    ...overrides,
  };
}

// Server order is chronological; credits deliberately not ascending so a
// credit sort is observable. Two rows carry fuel details for the fuel view.
const ledgerRows = [
  ledgerRow(1, { receiptId: 'R-100', timestamp: '2026-07-01T00:00:00.000Z', credit: '5000000' }),
  ledgerRow(2, {
    receiptId: 'R-300',
    tripCode: 'TRIP-FUEL-A',
    timestamp: '2026-07-10T00:00:00.000Z',
    credit: '9000000',
    txnType: TxnType.FUEL_EXPENSE,
    fuelDetails: {
      departureDate: '2026-07-10',
      truckPlate: '30H-111.11',
      routeName: 'Hà Nội - Hải Phòng',
      liters: '40',
      unitPrice: '22000',
      amount: '880000',
    },
  }),
  ledgerRow(3, { receiptId: 'R-200', timestamp: '2026-07-20T00:00:00.000Z', credit: '1000000' }),
  ledgerRow(4, {
    receiptId: 'R-400',
    tripCode: 'TRIP-FUEL-B',
    timestamp: '2026-07-25T00:00:00.000Z',
    credit: '3000000',
    txnType: TxnType.FUEL_EXPENSE,
    fuelDetails: {
      departureDate: '2026-07-25',
      truckPlate: '30H-222.22',
      routeName: 'Hải Phòng - Hà Nội',
      liters: '60',
      unitPrice: '22000',
      amount: '1320000',
    },
  }),
];

const statement = {
  supplier: { id: 5, name: 'NCC Nhiên liệu', phone: null },
  ledgerRows,
  agingBuckets: [{ range: '0-30 ngày', amount: 18_000_000 }],
  totalOutstanding: 18_000_000,
  periodSummary: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/payables/5']}>
        <Routes>
          <Route path="/payables/:id" element={<PayableDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderedReferenceOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.dd-detail-table tbody tr')]
    .map(row => row.querySelector('.dd-reference strong')?.textContent ?? '');
}

beforeEach(() => {
  useSupplierStatementMock.mockReset();
  useSupplierStatementMock.mockReturnValue({
    data: statement,
    isLoading: false,
    isFetching: false,
    error: null,
  });
});

describe('PayableDetailPage ledger column sorting', () => {
  it('keeps the server (chronological) order in the all-transactions view by default', () => {
    const { container } = renderPage();

    expect(renderedReferenceOrder(container)).toEqual(['R-100', 'R-300', 'R-200', 'R-400']);
    expect(screen.getByRole('columnheader', { name: 'PHÁT SINH PHẢI TRẢ' }).getAttribute('aria-sort')).toBe('none');
  });

  it('sorts by the payable column numerically and toggles asc → desc', () => {
    const { container } = renderPage();

    const payableHeader = screen.getByRole('columnheader', { name: 'PHÁT SINH PHẢI TRẢ' });
    fireEvent.click(screen.getByRole('button', { name: 'PHÁT SINH PHẢI TRẢ' }));
    expect(renderedReferenceOrder(container)).toEqual(['R-200', 'R-400', 'R-100', 'R-300']);
    expect(payableHeader.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'PHÁT SINH PHẢI TRẢ' }));
    expect(renderedReferenceOrder(container)).toEqual(['R-300', 'R-100', 'R-400', 'R-200']);
    expect(payableHeader.getAttribute('aria-sort')).toBe('descending');
  });

  it('switches to the fuel header set and resets the sort when the filter chip changes', () => {
    const { container } = renderPage();

    // Engage a sort in the all view first.
    fireEvent.click(screen.getByRole('button', { name: 'PHÁT SINH PHẢI TRẢ' }));
    expect(screen.getByRole('columnheader', { name: 'PHÁT SINH PHẢI TRẢ' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Chi phí nhiên liệu' }));

    // Fuel view headers replace the all-view set, and no column stays active.
    expect(screen.getByRole('columnheader', { name: 'SỐ LÍT DẦU' }).getAttribute('aria-sort')).toBe('none');
    expect(screen.queryByRole('columnheader', { name: 'PHÁT SINH PHẢI TRẢ' })).toBeNull();
    // Fuel rows render in server order with fuel-detail columns populated.
    expect(renderedReferenceOrder(container)).toEqual(['TRIP-FUEL-A', 'TRIP-FUEL-B']);

    fireEvent.click(screen.getByRole('button', { name: 'SỐ LÍT DẦU' }));
    expect(renderedReferenceOrder(container)).toEqual(['TRIP-FUEL-A', 'TRIP-FUEL-B']);
    fireEvent.click(screen.getByRole('button', { name: 'SỐ LÍT DẦU' }));
    expect(renderedReferenceOrder(container)).toEqual(['TRIP-FUEL-B', 'TRIP-FUEL-A']);
  });
});
