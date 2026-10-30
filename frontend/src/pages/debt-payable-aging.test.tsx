import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useCustomerStatementMock,
  useSupplierStatementMock,
  apiGetMock,
  apiPostMock,
  toastMock,
  financialAgingMock,
} = vi.hoisted(() => ({
  useCustomerStatementMock: vi.fn(),
  useSupplierStatementMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  toastMock: vi.fn(),
  financialAgingMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  useCustomerStatement: useCustomerStatementMock,
  useSupplierStatement: useSupplierStatementMock,
}));

vi.mock('../api/financialClient', () => ({
  financialClient: { getCustomerAging: financialAgingMock },
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
  // No matching aging row by default → the pill rides the unpaidTrips rule.
  financialAgingMock.mockReset().mockResolvedValue({ customers: [] });
});

describe('AR/AP aging grid characterization', () => {
  it('DebtDetailPage renders the four aging ranges with amounts and active highlight', () => {
    renderAt('/debt/7');
    const grid = document.querySelector('.dd-aging-grid');
    expect(grid).not.toBeNull();

    const cells = Array.from(grid!.querySelectorAll<HTMLElement>('.dd-aging-cell'));
    expect(cells).toHaveLength(4);
    // SIL-599 C1 — AR slots are TUỔI NỢ (recording-date age), the labels no
    // longer masquerade as due status over age data.
    expect(within(cells[0]).getByText('TUỔI NỢ 0–30 NGÀY')).toBeTruthy();
    expect(within(cells[1]).getByText('TUỔI NỢ 31–60 NGÀY')).toBeTruthy();
    expect(within(cells[2]).getByText('TUỔI NỢ 61–90 NGÀY')).toBeTruthy();
    expect(within(cells[3]).getByText('TUỔI NỢ TRÊN 90 NGÀY')).toBeTruthy();

    // Entire outstanding balance sits in bucket 0 → only cell 0 is active.
    expect(cells[0].className).toContain('dd-aging-cell--active');
    expect(cells.filter((cell) => cell.className.includes('dd-aging-cell--active'))).toHaveLength(1);
    // Card 071026141540: the aging value rides plain formatCurrency — digits,
    // space, ₫ in one text node — never the old glued 'đ' form.
    expect(within(cells[0]).getByText('1.500.000 ₫')).toBeTruthy();
    expect(within(cells[0]).getByText('100% tổng công nợ')).toBeTruthy();
    expect(within(cells[1]).getByText('Không phát sinh')).toBeTruthy();
  });

  it('PayableDetailPage keeps the AP contractual labels over the same slots (SIL-580 out-of-scope)', () => {
    renderAt('/payables/5');
    const grid = document.querySelector('.dd-aging-grid');
    expect(grid).not.toBeNull();

    const cells = Array.from(grid!.querySelectorAll<HTMLElement>('.dd-aging-cell'));
    expect(cells).toHaveLength(4);
    // AP wording is deliberately unchanged — the AP re-anchor needs its own
    // ticket (SIL-580 out-of-scope note).
    expect(within(cells[0]).getByText('CHƯA ĐẾN HẠN')).toBeTruthy();
    expect(within(cells[1]).getByText('QUÁ HẠN 1–30 NGÀY')).toBeTruthy();
    expect(within(cells[2]).getByText('QUÁ HẠN 31–90 NGÀY')).toBeTruthy();
    expect(within(cells[3]).getByText('QUÁ HẠN TRÊN 90 NGÀY')).toBeTruthy();

    // 100 of 175 outstanding → active bucket 0 at 57%; the zero bucket stays inert.
    expect(cells[0].className).toContain('dd-aging-cell--active');
    expect(within(cells[0]).getByText('57% tổng công nợ')).toBeTruthy();
    expect(within(cells[2]).getByText('Không phát sinh')).toBeTruthy();
  });
});

// SIL-599 (id 699) — the detail pill must tell the SAME story the /debt list
// tells, and both AR faces carry their rule tooltip.
describe('SIL-599 detail pill + rule tooltips (C2/C3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('C3: an overdue open debt settles to "Còn nợ quá hạn · N ngày" (fallback due = recording date)', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    financialAgingMock.mockReturnValue(promise);
    useCustomerStatementMock.mockReturnValue({
      data: {
        ...customerStatement,
        totalOutstanding: 3_000_000,
        unpaidTrips: [{
          tripId: 1,
          date: '2026-10-24',
          issueTimestamp: '2026-10-24T08:00:00Z',
          outstanding: 3_000_000,
          note: 'Chuyến 24/10',
          originalDueDate: null,
          processingDueDate: null,
        }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt('/debt/7');
    // Review F1 residual fix: in flight the pill claims nothing.
    expect(document.querySelector<HTMLElement>('.dd-tag')?.textContent).toBe('Còn nợ');
    resolve({ customers: [] });
    // QA's own repro numbers: recorded 24/10, reference 30/10 → 6 days.
    const pill = await screen.findByText('Còn nợ quá hạn · 6 ngày');
    expect(pill.getAttribute('title')).toContain('hạn thanh toán');
    expect(pill.getAttribute('title')).toContain('đến hạn tại ngày ghi nhận');
  });

  it('C3: the pill prints the LIST row\'s own maxOverdueDays over any local rule (review F1)', async () => {
    financialAgingMock.mockResolvedValue({
      customers: [{
        customerId: 7,
        customerName: 'Công ty Minh Hải',
        contactInfo: null,
        linkedSupplierId: null,
        linkedSupplierApBalance: 0,
        netBalance: 3_000_000,
        totalOutstanding: 3_000_000,
        aging: { current: 3_000_000, d30: 0, d60: 0, over90: 0 },
        maxOverdueDays: 9,
      }],
    });
    useCustomerStatementMock.mockReturnValue({
      data: {
        ...customerStatement,
        totalOutstanding: 3_000_000,
        unpaidTrips: [{
          tripId: 1,
          date: '2026-10-24',
          issueTimestamp: '2026-10-24T08:00:00Z',
          outstanding: 3_000_000,
          note: '',
          originalDueDate: null,
          processingDueDate: null,
        }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt('/debt/7');
    // The list figure (9) wins over the narrower unpaidTrips rule (6) — the
    // pill can never contradict the list row that links here.
    expect(await screen.findByText('Còn nợ quá hạn · 9 ngày')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Còn nợ quá hạn · 6 ngày')).toBeNull());
  });

  it('C3: a resolved list row wins even at zero (?? not ||)', async () => {
    financialAgingMock.mockResolvedValue({
      customers: [{
        customerId: 7,
        customerName: 'Công ty Minh Hải',
        contactInfo: null,
        linkedSupplierId: null,
        linkedSupplierApBalance: 0,
        netBalance: 3_000_000,
        totalOutstanding: 3_000_000,
        aging: { current: 3_000_000, d30: 0, d60: 0, over90: 0 },
        maxOverdueDays: 0,
      }],
    });
    useCustomerStatementMock.mockReturnValue({
      data: {
        ...customerStatement,
        totalOutstanding: 3_000_000,
        unpaidTrips: [{
          tripId: 1,
          date: '2026-10-24',
          issueTimestamp: '2026-10-24T08:00:00Z',
          outstanding: 3_000_000,
          note: '',
          originalDueDate: null,
          processingDueDate: null,
        }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt('/debt/7');
    expect(await screen.findByText('Còn nợ trong hạn')).toBeTruthy();
    expect(screen.queryByText(/6 ngày/)).toBeNull();
  });

  it('C3: a debt still inside its payment term prints "Còn nợ trong hạn"', async () => {
    useCustomerStatementMock.mockReturnValue({
      data: {
        ...customerStatement,
        totalOutstanding: 1_500_000,
        unpaidTrips: [{
          tripId: 2,
          date: '2026-10-28',
          issueTimestamp: '2026-10-28T09:00:00Z',
          outstanding: 1_500_000,
          note: '',
          originalDueDate: '2026-11-05',
          processingDueDate: null,
        }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt('/debt/7');
    expect(await screen.findByText('Còn nợ trong hạn')).toBeTruthy();
  });

  it('C3: a settled customer prints "Đã thanh toán đủ"', () => {
    useCustomerStatementMock.mockReturnValue({
      data: { ...customerStatement, totalOutstanding: 0, unpaidTrips: [] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderAt('/debt/7');
    expect(screen.getByText('Đã thanh toán đủ')).toBeTruthy();
  });

  it('C2: the aging grid carries the age-rule tooltip', () => {
    renderAt('/debt/7');
    const grid = document.querySelector<HTMLElement>('.dd-aging-grid');
    expect(grid?.getAttribute('title')).toContain('ngày ghi nhận');
    expect(grid?.getAttribute('title')).toContain('31–60');
  });
});
