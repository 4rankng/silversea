import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useCustomerStatementMock,
  useSupplierStatementMock,
  apiGetMock,
  apiPostMock,
  toastMock,
  refetchMock,
  randomUuidMock,
} = vi.hoisted(() => ({
  useCustomerStatementMock: vi.fn(),
  useSupplierStatementMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  toastMock: vi.fn(),
  refetchMock: vi.fn(),
  randomUuidMock: vi.fn(),
}));

vi.mock('../hooks/useQueries', () => ({
  useCustomerStatement: useCustomerStatementMock,
  useSupplierStatement: useSupplierStatementMock,
}));

vi.mock('../lib/api', () => ({
  api: {
    get: apiGetMock,
    post: apiPostMock,
    getBlob: vi.fn(),
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

vi.mock('../components/UI', () => ({
  Modal: ({ isOpen, title, children, footer }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => (isOpen ? (
    <div role="dialog" aria-label={title}>
      <div>{children}</div>
      <div>{footer}</div>
    </div>
  ) : null),
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

vi.mock('../components/billing/BillingDocumentsPanel', () => ({
  default: () => null,
}));

import DebtDetailPage from './DebtDetailPage';

const statement = {
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
  unpaidTrips: [
    {
      tripId: 11,
      date: '2026-07-20',
      issueTimestamp: '2026-07-20T08:00:00.000Z',
      outstanding: 1_500_000,
      note: 'Hải Phòng - Hà Nội',
      originalDueDate: '2026-07-25',
      processingDueDate: '2026-07-25',
      dueDateAdjusted: false,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

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

describe('DebtDetailPage payment flow', () => {
  beforeEach(() => {
    useCustomerStatementMock.mockReset();
    useSupplierStatementMock.mockReset();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    toastMock.mockReset();
    refetchMock.mockReset();
    randomUuidMock.mockReset();
    let uuidCounter = 0;
    randomUuidMock.mockImplementation(() => {
      uuidCounter += 1;
      return `retry-key-${uuidCounter}`;
    });
    vi.stubGlobal('crypto', { randomUUID: randomUuidMock });

    useCustomerStatementMock.mockImplementation((_id: string | undefined, range?: unknown) => (
      range
        ? { data: statement, isFetching: false, refetch: refetchMock }
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

  it('submits amount-only with a stable retry key, does not cap overpayment, and shows allocated/unapplied copy', async () => {
    apiPostMock
      .mockRejectedValueOnce(new Error('Mạng chập chờn, vui lòng thử lại.'))
      .mockResolvedValueOnce({
        replayed: false,
        result: {
          id: 91,
          receiptId: 'PT-20260727-01',
          customerId: 7,
          receivedAmount: 2_000_000,
          allocations: [
            {
              tripId: 11,
              amount: 1_500_000,
              processingDueDate: '2026-07-25',
              issueTimestamp: '2026-07-20T08:00:00.000Z',
            },
          ],
          allocatedTotal: 1_500_000,
          unappliedAmount: 500_000,
          allocationMethod: 'OLDEST_DUE',
          createdAt: '2026-07-27T09:00:00.000Z',
        },
      });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi nhận thanh toán' })[0]);
    fireEvent.change(screen.getByLabelText(/Số tiền nhận/), { target: { value: '2000000' } });
    fireEvent.change(screen.getByLabelText(/Mã biên lai/), { target: { value: 'PT-20260727-01' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
    await waitFor(() => expect(screen.getByText(/Mạng chập chờn/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/payments/receive',
      {
        customerId: 7,
        receiptId: 'PT-20260727-01',
        amount: 2_000_000,
      },
      {
        headers: { 'Idempotency-Key': 'retry-key-4' },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/payments/receive',
      {
        customerId: 7,
        receiptId: 'PT-20260727-01',
        amount: 2_000_000,
      },
      {
        headers: { 'Idempotency-Key': 'retry-key-4' },
      },
    );

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'success',
        message: expect.stringContaining('còn 500.000'),
      })),
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('rotates the retry key when the user edits the amount after a failed submit', async () => {
    apiPostMock
      .mockRejectedValueOnce(new Error('Mạng chập chờn, vui lòng thử lại.'))
      .mockResolvedValueOnce({
        replayed: false,
        result: {
          id: 92,
          receiptId: 'PT-20260727-02',
          customerId: 7,
          receivedAmount: 2_500_000,
          allocations: [
            {
              tripId: 11,
              amount: 1_500_000,
              processingDueDate: '2026-07-25',
              issueTimestamp: '2026-07-20T08:00:00.000Z',
            },
          ],
          allocatedTotal: 1_500_000,
          unappliedAmount: 1_000_000,
          allocationMethod: 'OLDEST_DUE',
          createdAt: '2026-07-27T09:05:00.000Z',
        },
      });

    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi nhận thanh toán' })[0]);
    fireEvent.change(screen.getByLabelText(/Số tiền nhận/), { target: { value: '2000000' } });
    fireEvent.change(screen.getByLabelText(/Mã biên lai/), { target: { value: 'PT-20260727-02' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
    await waitFor(() => expect(screen.getByText(/Mạng chập chờn/)).toBeTruthy());

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Số tiền nhận/), { target: { value: '2500000' } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/payments/receive',
      {
        customerId: 7,
        receiptId: 'PT-20260727-02',
        amount: 2_000_000,
      },
      {
        headers: { 'Idempotency-Key': 'retry-key-4' },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/payments/receive',
      {
        customerId: 7,
        receiptId: 'PT-20260727-02',
        amount: 2_500_000,
      },
      {
        headers: { 'Idempotency-Key': 'retry-key-5' },
      },
    );
  });

  it('renders the credit strip from authoritative exposure fields instead of the statement balance', () => {
    const creditAwareStatement = {
      ...statement,
      customer: {
        ...statement.customer,
        creditLimit: '100000000',
        creditWarningThreshold: '0.8',
      },
      totalOutstanding: 70_000_000,
      approvedUncollected: 20_000_000,
      totalExposure: 90_000_000,
      utilization: 0.9,
      availableCapacity: 10_000_000,
    };

    useCustomerStatementMock.mockImplementation((_id: string | undefined, range?: unknown) => (
      range
        ? { data: creditAwareStatement, isFetching: false, refetch: refetchMock }
        : { data: creditAwareStatement, isLoading: false, error: null }
    ));

    renderPage();

    const creditStrip = screen.getByLabelText('Hạn mức công nợ');
    expect(within(creditStrip).getByText('Tổng dư nợ kiểm hạn')).toBeTruthy();
    expect(within(creditStrip).getByText('Đã ghi nhận, chưa thu')).toBeTruthy();
    expect(within(creditStrip).getByText('Tỷ lệ sử dụng')).toBeTruthy();
    expect(within(creditStrip).getByText('Hạn mức còn lại')).toBeTruthy();
    expect(within(creditStrip).getByText('100.000.000đ')).toBeTruthy();
    expect(within(creditStrip).getByText('90.000.000đ')).toBeTruthy();
    expect(within(creditStrip).getByText('20.000.000đ')).toBeTruthy();
    expect(within(creditStrip).getByText('90%')).toBeTruthy();
    expect(within(creditStrip).getByText('10.000.000đ')).toBeTruthy();
    expect(within(creditStrip).queryByText('Dư nợ hiện tại')).toBeNull();
  });
});
