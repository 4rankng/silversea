import { render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useCustomerStatementMock,
  useSupplierStatementMock,
  apiGetMock,
  apiPostMock,
  toastMock,
} = vi.hoisted(() => ({
  useCustomerStatementMock: vi.fn(),
  useSupplierStatementMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  useCustomerStatement: useCustomerStatementMock,
  useSupplierStatement: useSupplierStatementMock,
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGetMock, post: apiPostMock, getBlob: vi.fn() },
  ApiError: class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: vi.fn(),
}));

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

vi.mock('../hooks/useClickOutside', () => ({
  useClickOutside: vi.fn(),
}));

vi.mock('../components/UI', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock('../components/debt/PeriodFilter', () => ({
  PeriodFilter: () => null,
  resolvePeriodRange: () => ({ from: null, to: null }),
  initialPeriodState: () => ({ mode: 'month', month: 7, year: 2026 }),
  applyModeSwitch: () => ({ mode: 'month', month: 7, year: 2026 }),
}));

vi.mock('../components/debt/PeriodSummaryCards', () => ({
  PeriodSummaryCards: () => null,
}));

vi.mock('../components/billing/BillingDocumentsPanel', () => ({
  default: () => null,
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/AssetIcon', () => ({
  default: () => null,
}));

vi.mock('../hooks/useAgentOpenable', () => ({
  useAgentOpenable: vi.fn(),
}));

import DebtDetailPage from './DebtDetailPage';
import PayableDetailPage from './PayableDetailPage';

const customerStatement = {
  customer: {
    id: 7,
    name: 'Công ty Minh Hải',
    contactInfo: '0909123456',
    isCarrier: false,
    debitNoteMode: 'MONTHLY',
  },
  ledgerRows: [],
  agingBuckets: [
    { range: '0-30 ngày', amount: 1_500_000 },
    { range: '31-60 ngày', amount: 0 },
    { range: '61-90 ngày', amount: 0 },
    { range: 'Trên 90 ngày', amount: 0 },
  ],
  totalOutstanding: 1_500_000,
  unpaidTrips: [],
};

const supplierStatement = {
  supplier: { id: 5, name: 'NCC Ánh Dương', phone: '0912345678', contactPerson: 'An' },
  ledgerRows: [],
  agingBuckets: [
    { range: '0-30 ngày', amount: 100 },
    { range: '31-60 ngày', amount: 50 },
    { range: '61-90 ngày', amount: 0 },
    { range: 'Trên 90 ngày', amount: 25 },
  ],
  totalOutstanding: 175,
  periodSummary: null,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/debt/:id" element={<DebtDetailPage />} />
          <Route path="/payables/:id" element={<PayableDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCustomerStatementMock.mockReturnValue({
    data: customerStatement, isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  });
  useSupplierStatementMock.mockReturnValue({
    data: supplierStatement, isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  });
});

describe('AR/AP aging grid characterization', () => {
  it('DebtDetailPage renders the four aging ranges with amounts and active highlight', () => {
    renderAt('/debt/7');
    const grid = document.querySelector('.dd-aging-grid');
    expect(grid).not.toBeNull();

    const cells = Array.from(grid!.querySelectorAll('.dd-aging-cell'));
    expect(cells).toHaveLength(4);
    expect(within(cells[0] as HTMLElement).getByText('0–30 NGÀY')).toBeTruthy();
    expect(within(cells[1] as HTMLElement).getByText('31–60 NGÀY')).toBeTruthy();
    expect(within(cells[2] as HTMLElement).getByText('61–90 NGÀY')).toBeTruthy();
    expect(within(cells[3] as HTMLElement).getByText('TRÊN 90 NGÀY')).toBeTruthy();

    // Entire outstanding balance sits in bucket 0 → only cell 0 is active.
    expect(cells[0].className).toContain('dd-aging-cell--active');
    expect(cells.filter((cell) => cell.className.includes('dd-aging-cell--active'))).toHaveLength(1);
    expect(within(cells[0] as HTMLElement).getByText('1.500.000đ')).toBeTruthy();
    expect(within(cells[0] as HTMLElement).getByText('100% tổng công nợ')).toBeTruthy();
    expect(within(cells[1] as HTMLElement).getByText('Không phát sinh')).toBeTruthy();
  });

  it('PayableDetailPage renders the same four ranges with proportional shares', () => {
    renderAt('/payables/5');
    const grid = document.querySelector('.dd-aging-grid');
    expect(grid).not.toBeNull();

    const cells = Array.from(grid!.querySelectorAll('.dd-aging-cell'));
    expect(cells).toHaveLength(4);
    expect(within(cells[0] as HTMLElement).getByText('0–30 NGÀY')).toBeTruthy();
    expect(within(cells[1] as HTMLElement).getByText('31–60 NGÀY')).toBeTruthy();
    expect(within(cells[2] as HTMLElement).getByText('61–90 NGÀY')).toBeTruthy();
    expect(within(cells[3] as HTMLElement).getByText('TRÊN 90 NGÀY')).toBeTruthy();

    // 100 of 175 outstanding → active bucket 0 at 57%; the zero bucket stays inert.
    expect(cells[0].className).toContain('dd-aging-cell--active');
    expect(within(cells[0] as HTMLElement).getByText('57% tổng công nợ')).toBeTruthy();
    expect(within(cells[2] as HTMLElement).getByText('Không phát sinh')).toBeTruthy();
  });
});
