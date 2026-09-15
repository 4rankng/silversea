import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoverableCost } from '../api/customerServiceFinanceClient';
import RecoverableCostsPage from './RecoverableCostsPage';

const { listRecoverableCostsMock, requestRecoverableCostMock } = vi.hoisted(() => ({
  listRecoverableCostsMock: vi.fn(),
  requestRecoverableCostMock: vi.fn(),
}));

vi.mock('../api/customerServiceFinanceClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/customerServiceFinanceClient')>();
  return {
    ...actual,
    customerServiceFinanceClient: {
      ...actual.customerServiceFinanceClient,
      listRecoverableCosts: listRecoverableCostsMock,
      requestRecoverableCost: requestRecoverableCostMock,
    },
  };
});

function makeCost(overrides: Partial<RecoverableCost> = {}): RecoverableCost {
  return {
    id: 41,
    version: 7,
    tripId: 12,
    tripCode: 'CH-2608-012',
    shipmentId: 18,
    shipmentCode: 'DNKM13333',
    customerId: 4,
    customerName: 'Công ty Long Minh',
    expenseType: 'LIFT_ON',
    expenseTypeName: 'Phí nâng container',
    expenseDate: '2026-07-30',
    buyAmount: 1_500_000,
    sellAmount: 2_200_000,
    recoverablePrincipalAmount: 1_500_000,
    serviceFeeAmount: 700_000,
    approvalStatus: 'RECORDED',
    invoiceNumber: '14578',
    invoiceDate: '2026-07-30',
    noInvoiceEvidenceTypes: [],
    eligibility: { state: 'ELIGIBLE', blockedReason: null },
    claim: null,
    updatedAt: '2026-07-30T08:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(<MemoryRouter><RecoverableCostsPage /></MemoryRouter>);
}

const { activeRole } = vi.hoisted(() => ({ activeRole: { value: null as string | null } }));

vi.mock('../hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAuth')>('../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => activeRole.value === null
      ? null
      : {
          user: {
            userId: 1,
            id: 1,
            username: 'tester',
            email: null,
            phone: null,
            fullName: 'Test',
            role: activeRole.value,
            capabilities: [],
          },
          isAuthenticated: true,
          loading: false,
          sessionExpired: false,
        },
  };
});

function renderPageWithRole(role: 'CUS' | 'ACCOUNTANT' | 'ADMIN' | 'MANAGER' | null) {
  activeRole.value = role;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecoverableCostsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecoverableCostsPage', () => {
  beforeEach(() => {
    activeRole.value = null;
    listRecoverableCostsMock.mockReset();
    requestRecoverableCostMock.mockReset();
    listRecoverableCostsMock.mockResolvedValue({ items: [makeCost()], total: 1, page: 1, limit: 25 });
    requestRecoverableCostMock.mockResolvedValue({ id: 901 });
  });

  it('renders the reconciliation ledger with full VND values and truthful existing fields', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Chi phí cần kiểm tra' })).toBeTruthy();
    expect(screen.getByTestId('recoverable-cost-ledger')).toBeTruthy();
    expect(screen.getByTestId('recoverable-cost-records')).toBeTruthy();
    expect(screen.getAllByText('Công ty Long Minh').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DNKM13333').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.500.000 ₫').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2.200.000 ₫').length).toBeGreaterThan(0);
    expect(screen.getAllByText('700.000 ₫').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\b2,2\s*(tr|M)\b/i)).toBeNull();
  });

  it('filters by recorded status and resets the requested page to one', async () => {
    listRecoverableCostsMock.mockResolvedValue({ items: Array.from({ length: 25 }, (_, index) => makeCost({ id: index + 1 })), total: 30, page: 1, limit: 25 });
    renderPage();
    await screen.findAllByText('Công ty Long Minh');

    // The workspace now renders one Pagination per responsive record owner
    // (desktop ledger + mobile records). Scope the click to a single owner so
    // `getByRole` does not match both paginations.
    fireEvent.click(within(screen.getByTestId('recoverable-cost-ledger')).getByRole('button', { name: '2' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenCalledWith({ page: 2, limit: 25, approvalStatus: undefined }));

    fireEvent.click(screen.getByRole('button', { name: /Trạng thái khoản chi/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Đã ghi nhận' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenCalledWith({ page: 1, limit: 25, approvalStatus: 'RECORDED' }));
  });

  it('keeps pagination with each responsive record owner', async () => {
    listRecoverableCostsMock.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, index) => makeCost({ id: index + 1 })),
      total: 30,
      page: 1,
      limit: 25,
    });
    const { container } = renderPage();

    await screen.findAllByText('Công ty Long Minh');
    const paginations = container.querySelectorAll('.ds-pagination');
    expect(paginations).toHaveLength(2);
    expect(screen.getByTestId('recoverable-cost-records').contains(paginations[0])).toBe(true);
    expect(screen.getByTestId('recoverable-cost-ledger').contains(paginations[1])).toBe(true);
  });

  it('keeps blocker text visible and removes review actions from ineligible costs', async () => {
    listRecoverableCostsMock.mockResolvedValue({
      items: [makeCost({
        approvalStatus: 'REJECTED',
        eligibility: { state: 'BLOCKED', blockedReason: 'Khoản chi chưa được ghi nhận hợp lệ.' },
      })],
      total: 1,
      page: 1,
      limit: 25,
    });
    renderPage();

    expect((await screen.findAllByText('Khoản chi chưa được ghi nhận hợp lệ.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Hoàn thiện khoản chi' })[0].getAttribute('href')).toBe('/trips/12');
  });

  it('uses a Vietnamese fallback instead of exposing an internal expense enum', async () => {
    listRecoverableCostsMock.mockResolvedValue({
      items: [makeCost({ expenseType: 'LIFT_ON', expenseTypeName: null })],
      total: 1,
      page: 1,
      limit: 25,
    });
    renderPage();

    expect((await screen.findAllByText('Khoản chi khác')).length).toBeGreaterThan(0);
    expect(screen.queryByText('LIFT_ON')).toBeNull();
  });

  it('opens the original expense context without creating an internal review request', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'Xem khoản chi' });
    expect(links[0].getAttribute('href')).toBe('/trips/12');
    expect(screen.queryByRole('button', { name: /duyệt|Kiểm tra|Gửi yêu cầu/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requestRecoverableCostMock).not.toHaveBeenCalled();
  });

  it('renders useful loading, error retry, and filtered-empty states', async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    listRecoverableCostsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    const { unmount } = renderPage();
    expect(screen.getByRole('status').textContent).toContain('Đang tải danh sách chi phí cần kiểm tra');
    resolveList?.({ items: [makeCost()], total: 1, page: 1, limit: 25 });
    await screen.findAllByText('Công ty Long Minh');
    unmount();

    listRecoverableCostsMock.mockReset();
    listRecoverableCostsMock.mockRejectedValueOnce(new Error('Mất kết nối'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải danh sách chi phí cần kiểm tra');
    listRecoverableCostsMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 25 });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không có chi phí phù hợp')).toBeTruthy();
  });

  it('lets ledger text wrap so long invoice evidence is not clipped by the global table nowrap', async () => {
    renderPage();
    await screen.findAllByText('Công ty Long Minh');

    // The global tbody td rule (components/Table.css) sets white-space: nowrap;
    // the ledger must reset it so narrow columns wrap instead of clipping content.
    const ledgerStyles = readFileSync(resolve(process.cwd(), 'src/features/recoverable-costs/RecoverableCostsWorkspace.css'), 'utf8');
    expect(ledgerStyles).toMatch(/__ledger th,\.recoverable-costs__ledger td\{[^}]*white-space:normal/);
    expect(ledgerStyles).toMatch(/__evidence span\{overflow-wrap:anywhere;min-width:0\}/);
    // Money cells stay nowrap — VND figures must not wrap.
    expect(ledgerStyles).toMatch(/__ledger td\.num,\.recoverable-costs__ledger td \.recoverable-costs__money\{white-space:nowrap\}/);
  });

  // 15s budget (default 5s): five sequential async waits + double 25-row
  // table renders exceed the default under full-suite CPU contention — the
  // 2026-09-10 load-flake (timed out twice in the suite, never isolated).
  // Assertions untouched; only the budget grows.
  it('sends sortBy/sortDir on header clicks, toggles asc → desc, and resets to page 1', async () => {
    listRecoverableCostsMock.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, index) => makeCost({ id: index + 1 })),
      total: 30,
      page: 1,
      limit: 25,
    });
    renderPage();
    await screen.findAllByText('Công ty Long Minh');

    // Initial load carries no sort params.
    expect(listRecoverableCostsMock).toHaveBeenLastCalledWith({ page: 1, limit: 25, approvalStatus: undefined, sortBy: undefined, sortDir: undefined });

    const ledger = screen.getByTestId('recoverable-cost-ledger');
    const varianceHeader = within(ledger).getByRole('columnheader', { name: 'Chênh lệch thu/chi' });
    fireEvent.click(within(ledger).getByRole('button', { name: 'Chênh lệch thu/chi' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenLastCalledWith({ page: 1, limit: 25, approvalStatus: undefined, sortBy: 'variance', sortDir: 'asc' }));
    expect(varianceHeader.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(within(ledger).getByRole('button', { name: 'Chênh lệch thu/chi' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenLastCalledWith({ page: 1, limit: 25, approvalStatus: undefined, sortBy: 'variance', sortDir: 'desc' }));
    expect(varianceHeader.getAttribute('aria-sort')).toBe('descending');

    // A fresh column starts ascending; engaging it from page 2 restarts at 1.
    fireEvent.click(within(ledger).getByRole('button', { name: '2' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenLastCalledWith({ page: 2, limit: 25, approvalStatus: undefined, sortBy: 'variance', sortDir: 'desc' }));

    fireEvent.click(within(ledger).getByRole('button', { name: 'Trạng thái' }));
    await waitFor(() => expect(listRecoverableCostsMock).toHaveBeenLastCalledWith({ page: 1, limit: 25, approvalStatus: undefined, sortBy: 'eligibility', sortDir: 'asc' }));
    expect(within(ledger).getByRole('columnheader', { name: 'Trạng thái' }).getAttribute('aria-sort')).toBe('ascending');
  }, 15_000);

  // P0-W4: per-role page framing. CUS sees the per-shipment collection list
  // ("Chi phí thu hộ cần đối soát"); Accountant/Admin/Manager see the
  // per-record verification ledger ("Chi phí cần kiểm tra"). The same
  // component renders both; only the header eyebrow + H1 + subtitle branch.
  it('branches the header to the CUS collection framing when the signed-in user is CUS', async () => {
    renderPageWithRole('CUS');
    expect(await screen.findByRole('heading', { name: 'Chi phí thu hộ cần đối soát' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Chi phí cần kiểm tra' })).toBeNull();
    expect(screen.getByText('Đối soát chi phí thu hộ')).toBeTruthy();
  });

  it('keeps the accountant verification framing for non-CUS office roles', async () => {
    renderPageWithRole('ACCOUNTANT');
    expect(await screen.findByRole('heading', { name: 'Chi phí cần kiểm tra' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Chi phí thu hộ cần đối soát' })).toBeNull();
    expect(screen.getByText('Đối soát chi phí lô hàng')).toBeTruthy();
  });

  it('falls back to the accountant framing when no auth context is present (test default)', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Chi phí cần kiểm tra' })).toBeTruthy();
  });
});
