import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TxnType } from '@tingting/shared';

const { useCustomerStatementMock, useSupplierStatementMock, apiGetMock } = vi.hoisted(() => ({
  useCustomerStatementMock: vi.fn(),
  useSupplierStatementMock: vi.fn(),
  apiGetMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  useCustomerStatement: useCustomerStatementMock,
  useSupplierStatement: useSupplierStatementMock,
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGetMock, post: vi.fn(), getBlob: vi.fn() },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));

vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

vi.mock('../components/UI', () => ({
  Modal: () => null,
}));

vi.mock('../components/shared/Breadcrumbs', () => ({ Breadcrumbs: () => null }));

vi.mock('../components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/AssetIcon', () => ({ default: () => null }));

vi.mock('../components/billing/BillingDocumentsPanel', () => ({
  default: () => null,
}));

import DebtDetailPage from './DebtDetailPage';

function ledgerRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    timestamp: '2026-07-01T00:00:00.000Z',
    txnType: TxnType.TRIP_REVENUE,
    txnId: null,
    receiptId: null,
    entityType: 'CUSTOMER',
    entityId: 7,
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
    ...overrides,
  };
}

// Server order is oldest-first by timestamp; credits deliberately NOT in
// ascending order so a credit sort is observable.
const ledgerRows = [
  ledgerRow(1, { tripCode: 'TRIP-OLD', timestamp: '2026-07-01T00:00:00.000Z', debit: '5000000', credit: '0', balance: '5000000' }),
  ledgerRow(2, { tripCode: 'TRIP-MID', timestamp: '2026-07-10T00:00:00.000Z', debit: '3000000', credit: '0', balance: '8000000' }),
  ledgerRow(3, { tripCode: 'TRIP-PAY', timestamp: '2026-07-20T00:00:00.000Z', txnType: TxnType.PAYMENT_RECEIVED, debit: '0', credit: '9000000', balance: '0' }),
  ledgerRow(4, { tripCode: 'TRIP-NEW', timestamp: '2026-07-25T00:00:00.000Z', debit: '1000000', credit: '0', balance: '1000000' }),
];

const statement = {
  customer: {
    id: 7,
    name: 'Công ty Minh Hải',
    contactInfo: '0909123456',
    isCarrier: false,
    debitNoteMode: 'MONTHLY',
  },
  ledgerRows,
  agingBuckets: [{ range: '0-30 ngày', amount: 1_000_000 }],
  totalOutstanding: 1_000_000,
  unpaidTrips: [],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/debt/7']}>
        <Routes>
          <Route path="/debt/:id" element={<DebtDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderedTripOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.dd-detail-table tbody tr')]
    .map(row => row.querySelector('.dd-reference strong')?.textContent ?? '');
}

beforeEach(() => {
  useCustomerStatementMock.mockReset();
  useSupplierStatementMock.mockReset();
  apiGetMock.mockReset();
  useCustomerStatementMock.mockImplementation((_id: string | undefined, range?: unknown) => (
    range
      ? { data: statement, isFetching: false, refetch: vi.fn() }
      : { data: statement, isLoading: false, error: null }
  ));
  useSupplierStatementMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
    isError: false,
    refetch: vi.fn(),
  });
  apiGetMock.mockResolvedValue([]);
});

describe('DebtDetailPage AR ledger column sorting', () => {
  it('keeps the server (chronological) order and marks headers unsorted by default', () => {
    const { container } = renderPage();

    expect(renderedTripOrder(container)).toEqual(['TRIP-OLD', 'TRIP-MID', 'TRIP-PAY', 'TRIP-NEW']);
    expect(screen.getByRole('columnheader', { name: 'ĐÃ THU' }).getAttribute('aria-sort')).toBe('none');
  });

  it('sorts by the money column numerically and toggles asc → desc with aria-sort', () => {
    const { container } = renderPage();

    const paidHeader = screen.getByRole('columnheader', { name: 'ĐÃ THU' });
    fireEvent.click(screen.getByRole('button', { name: 'ĐÃ THU' }));
    // Only TRIP-PAY has credit > 0; the rest tie at 0 and keep id order.
    expect(renderedTripOrder(container)).toEqual(['TRIP-OLD', 'TRIP-MID', 'TRIP-NEW', 'TRIP-PAY']);
    expect(paidHeader.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'ĐÃ THU' }));
    expect(renderedTripOrder(container)).toEqual(['TRIP-PAY', 'TRIP-OLD', 'TRIP-MID', 'TRIP-NEW']);
    expect(paidHeader.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts by date and reference columns, with a fresh column starting ascending', () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'NGÀY' }));
    expect(renderedTripOrder(container)).toEqual(['TRIP-OLD', 'TRIP-MID', 'TRIP-PAY', 'TRIP-NEW']);

    fireEvent.click(screen.getByRole('button', { name: 'NGÀY' }));
    expect(renderedTripOrder(container)).toEqual(['TRIP-NEW', 'TRIP-PAY', 'TRIP-MID', 'TRIP-OLD']);

    fireEvent.click(screen.getByRole('button', { name: 'CHUYẾN / ĐỐI CHIẾU' }));
    expect(renderedTripOrder(container)).toEqual(['TRIP-MID', 'TRIP-NEW', 'TRIP-OLD', 'TRIP-PAY']);
  });
});

// FIN-POL-02a: secondary age buckets cannot hide the primary ledger by default.
it('keeps aging details collapsed while the balance and ledger remain available', () => {
  const { container } = renderPage();
  const disclosure = container.querySelector('.dd-aging-disclosure') as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  expect(screen.getByRole('region', { name: 'Tóm tắt công nợ' })).toBeVisible();
  expect(renderedTripOrder(container)).toEqual(['TRIP-OLD', 'TRIP-MID', 'TRIP-PAY', 'TRIP-NEW']);
  fireEvent.click(disclosure.querySelector('summary')!);
  expect(disclosure.open).toBe(true);
  fireEvent.click(disclosure.querySelector('summary')!);
  expect(disclosure.open).toBe(false);
});
