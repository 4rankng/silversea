/**
 * Card 20260927_152 — `/debt/:id` and `/customers/:id` ride the shared
 * the `FilterBar` band: the period control is the bar's primary criterion and the
 * ledger's txn-type chips are its one secondary criterion.
 *
 * The page-local `.dd-filters` row is gone, so these pin the BEHAVIOUR it drove
 * — the ledger narrowed by txn type — through the shared slots. In jsdom the bar
 * measures zero width, so `FilterDropdown` renders its criteria INLINE (the
 * `inline` mode of the measured ladder); the folded `Bộ lọc` dialog is covered
 * by `components/FilterDropdown.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as ApiModule from '../lib/api';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { get: apiGetMock, post: vi.fn(), getBlob: vi.fn() } };
});

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

const statement = {
  customer: {
    id: 7,
    name: 'Công ty Minh Hải',
    contactInfo: '0909123456',
    isCarrier: false,
    debitNoteMode: 'MONTHLY',
  },
  ledgerRows: [
    ledgerRow(1, { tripCode: 'TRIP-REV', debit: '5000000', balance: '5000000' }),
    ledgerRow(2, {
      tripCode: 'TRIP-PAY',
      txnType: TxnType.PAYMENT_RECEIVED,
      credit: '9000000',
      balance: '0',
    }),
  ],
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

beforeEach(() => {
  useCustomerStatementMock.mockReset();
  useSupplierStatementMock.mockReset();
  apiGetMock.mockReset();
  useCustomerStatementMock.mockImplementation(() => ({
    data: statement,
    isFetching: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }));
  useSupplierStatementMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
    isError: false,
    refetch: vi.fn(),
  });
  apiGetMock.mockResolvedValue([]);
});

describe('DebtDetailPage filter strip', () => {
  it('hosts the period control and the txn-type chips on ONE shared bar', () => {
    const { container } = renderPage();

    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The page-local chip row is gone.
    expect(container.querySelector('.dd-filters')).toBeNull();

    // Primary criterion: the period control, as one bar item.
    expect(within(bar).getByRole('group', { name: 'Bộ lọc thời gian' })).toBeInTheDocument();

    // Secondary criterion: the ledger's txn-type chips (inline at this width).
    // Scoped to the chip class: the bar also hosts the period group's own
    // controls (`Áp dụng` / `Lọc dữ liệu`).
    const chips = [...bar.querySelectorAll('button.filter-chip')];
    expect(chips.map(chip => chip.textContent)).toEqual(['Tất cả', 'Thu tiền', 'Điều chỉnh', 'Doanh thu', 'Phí chi hộ']);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows the ledger from a txn-type chip and reports the applied count', () => {
    const { container } = renderPage();
    expect(container.querySelector('.dd-cnt')?.textContent).toBe('2 giao dịch');

    fireEvent.click(screen.getByRole('button', { name: 'Thu tiền' }));

    expect(screen.getByRole('button', { name: 'Thu tiền' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.dd-cnt')?.textContent).toBe('1 giao dịch');
    const references = [...container.querySelectorAll('.dd-detail-table tbody tr .dd-reference strong')]
      .map(el => el.textContent);
    expect(references).toEqual(['TRIP-PAY']);
  });

  it('keeps the page stylesheet free of the deleted filter plane', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/DebtDetailPage.css'), 'utf8');
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DebtDetailPage.tsx'), 'utf8');

    expect(css).not.toMatch(/\.dd-filters\b/);
    expect(css).not.toMatch(/\.dd-filter-chip\b/);
    expect(css).not.toMatch(/\.dd-ledger-toolbar\b/);
    expect(page).not.toContain('className="dd-filters"');
    expect(page).toContain('<FilterBar>');
  });
});
