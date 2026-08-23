import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountingWorkspacePage from './AccountingWorkspacePage';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({ api: { get: getMock } }));
vi.mock('../components/UI', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header><h1>{title}</h1><p>{description}</p></header>
  ),
}));

function renderPage(initialEntry = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><AccountingWorkspacePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountingWorkspacePage', () => {
  let failReadyInbox = false;
  let emptyInbox = false;

  beforeEach(() => {
    failReadyInbox = false;
    emptyInbox = false;
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/financial/work-inbox')) {
        const view = new URLSearchParams(path.split('?')[1]).get('view');
        if (view === 'ACTION' && failReadyInbox) return Promise.reject(new Error('ready inbox unavailable'));
        const items = emptyInbox ? [] : view === 'ACTION' ? [{
          id: 'financial:9', entityType: 'trip', entityId: 9,
          title: 'C-009', subtitle: 'S-008 · Silver Sea', state: 'ACTION', priority: 10,
          dueAt: null, freshnessAt: '2026-08-22T02:00:00.000Z', blockers: [],
          advisories: [{ code: 'CUSTOMER_DISPUTE', label: 'Khách hàng báo sai lệch', ownerRole: 'CUSTOMER', ownerLabel: 'Khách hàng' }],
          nextAction: { label: 'Mở đối chiếu', targetRoute: '/accounting?view=transport&search=C-009' },
          targetRoute: '/accounting?view=transport&search=C-009', tripId: 9,
          acceptedPod: true, expenseApprovalPending: false, settlementComplete: true,
          profitabilitySnapshotReady: true,
        }] : [{
          id: 'financial:10', entityType: 'trip', entityId: 10,
          title: 'C-010', subtitle: 'S-010 · Khách hàng B', state: 'WAITING', priority: 20,
          dueAt: null, freshnessAt: '2026-08-22T01:00:00.000Z',
          blockers: [
            { code: 'POD_ACCEPTANCE', label: 'Thiếu POD đã chấp nhận', ownerRole: 'ACCOUNTANT', ownerLabel: 'Kế toán' },
            { code: 'EXPENSE_APPROVAL', label: 'Chi phí đang chờ duyệt', ownerRole: 'ACCOUNTANT', ownerLabel: 'Kế toán' },
            { code: 'SETTLEMENT', label: 'Quyết toán chưa hoàn tất', ownerRole: 'OPS', ownerLabel: 'Nhân viên vận hành' },
            { code: 'PROFITABILITY', label: 'Thiếu ảnh chụp lợi nhuận', ownerRole: 'ACCOUNTANT', ownerLabel: 'Kế toán' },
          ],
          advisories: [{ code: 'CUSTOMER_NO_RESPONSE', label: 'Khách hàng chưa phản hồi giao hàng', ownerRole: 'CUSTOMER', ownerLabel: 'Khách hàng' }],
          nextAction: { label: 'Xử lý hồ sơ', targetRoute: '/accounting?view=transport&search=C-010' },
          targetRoute: '/accounting?view=transport&search=C-010', tripId: 10,
          acceptedPod: false, expenseApprovalPending: true, settlementComplete: false,
          profitabilitySnapshotReady: false,
        }];
        return Promise.resolve({
          asOf: '2026-08-22T02:01:00.000Z', timezone: 'Asia/Ho_Chi_Minh',
          counts: { action: view === 'ACTION' ? items.length : 0, waiting: view === 'WAITING' ? items.length : 0, done: 0 },
          page: 1, limit: 100, total: items.length, totalPages: items.length ? 1 : 0, items,
        });
      }
      if (path.startsWith('/reports/receivables-summary')) {
        return Promise.resolve({
          buckets: [
            { range: '0-30', label: 'Trong hạn', count: 1, amount: 12_000_000 },
            { range: '31-60', label: '31-60 ngày', count: 1, amount: 3_000_000 },
          ],
          totalOutstanding: 15_000_000,
          totalCustomers: 2,
          overdueCustomers: 1,
          overdueAmount: 3_000_000,
        });
      }
      if (path.startsWith('/reports/payables-summary')) {
        return Promise.resolve({ totalOutstanding: '8000000', totalSuppliers: 3, overdueSuppliers: 1 });
      }
      if (path.startsWith('/finance/billing-documents/transport-register')) {
        return Promise.resolve({
          asOf: '2026-08-01T00:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh',
          filterFingerprint: 'a'.repeat(64), page: 1, limit: 25, total: 1, totalPages: 1,
          items: [{
            financialPostingId: 41, financialPostingVersion: 1,
            financialPostingEffectiveAt: '2026-08-01T00:00:00.000Z',
            tripId: 9, tripCode: 'C-009', completionDate: '2026-08-01',
            customerId: 5, customerName: 'Silver Sea', carrierId: null, carrierName: null,
            ownership: 'OWN', shipmentId: 8, shipmentCode: 'S-008', routeId: 2,
            routeName: 'Cát Lái - Long An', factoryName: null,
            containerNumbers: ['TGHU1234567'], containerTypes: ['40HC'], plateNumber: '51D-123.45',
            revenue: '40000000', directCost: '25000000', carrierPayable: '0', profit: '15000000',
            readiness: {
              status: 'READY', acceptedPodSubmissionId: 11, acceptedPodVersion: 2,
              acceptedPodAt: '2026-08-01T00:00:00.000Z', profitabilitySnapshotId: 17,
              evidence: ['COMPLETED_TRIP', 'ACCEPTED_EPOD'],
            },
          }],
        });
      }
      if (path.startsWith('/customers')) {
        return Promise.resolve({
          total: 2,
          items: [
            { id: 5, name: 'Silver Sea', isCarrier: false },
            { id: 7, name: 'Nhà xe Minh Phát', isCarrier: true },
          ],
        });
      }
      return Promise.resolve({
        totals: { revenue: 40_000_000, directCost: 25_000_000, sharedOverhead: 0, profit: 15_000_000 },
        reconciliation: { status: 'RECONCILED', note: '' },
        sourceCoverage: { missingAttribution: 0 },
        asOf: '2026-08-01T00:00:00.000Z',
      });
    });
  });

  it('uses work as the default view and keeps customer exceptions advisory', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Công việc kế toán' })).toBeTruthy();
    expect(await screen.findByText('C-009')).toBeTruthy();
    expect(screen.getByText('Khách hàng báo sai lệch')).toBeTruthy();
    expect(screen.getAllByText('Ngoại lệ tham khảo — không chặn tài chính').length).toBe(2);
    expect(screen.getByRole('link', { name: 'Mở đối chiếu' }).getAttribute('href'))
      .toBe('/accounting?view=transport&search=C-009');

    expect(screen.getByText('Thiếu POD đã chấp nhận')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chi phí đang chờ duyệt' }).getAttribute('href'))
      .toBe('/expenses?tripId=10');
    expect(screen.getByRole('link', { name: 'Quyết toán chưa hoàn tất' }).getAttribute('href'))
      .toBe('/advances?view=settlements&tripId=10');
    expect(screen.getByRole('link', { name: 'Thiếu ảnh chụp lợi nhuận' }).getAttribute('href'))
      .toBe('/profit?tripId=10');
    expect(screen.getByText(/Tạo hàng loạt chỉ thực hiện trong Đối chiếu vận tải/)).toBeTruthy();
  });

  it('shows independent empty states for ready and blocked work', async () => {
    emptyInbox = true;
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Không có hồ sơ trong nhóm này.').length).toBe(2));
  });

  it('keeps the blocked lane usable when the ready lane fails', async () => {
    failReadyInbox = true;
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải nhóm này');
    expect(await screen.findByText('C-010')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chi phí đang chờ duyệt' })).toBeTruthy();
  });

  it('retains the existing overview as a secondary workspace', async () => {
    renderPage('/?view=overview');

    // The overview is retained as the secondary tab behind the work inbox;
    // the workspace h1 stays "Tổng quan kế toán" for both views.
    const overviewTab = screen.getByRole('link', { name: 'Tổng quan' });
    expect(overviewTab.getAttribute('href')).toBe('/?view=overview');
    expect(overviewTab.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Tổng quan kế toán' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Công nợ phải thu/ }).getAttribute('href')).toBe('/debt');
    expect(screen.getByRole('link', { name: /Công nợ phải trả/ }).getAttribute('href')).toBe('/payables');
    expect(screen.getByRole('link', { name: /Báo cáo lãi lỗ/ }).getAttribute('href')).toBe('/finance');
    expect(screen.getByRole('link', { name: /Soát OCR nhiên liệu/ }).getAttribute('href')).toBe('/accounting/fuel-evidence');

    await waitFor(() => expect(screen.getAllByText('15.000.000 ₫').length).toBeGreaterThan(0));
    expect(screen.getByText('3.000.000 ₫')).toBeTruthy();
    expect(screen.getByText('8.000.000 ₫')).toBeTruthy();
    const amounts = Array.from(document.querySelectorAll('.accounting-kpi strong'))
      .map((node) => node.textContent ?? '');
    expect(amounts.every((amount) => !/\d\s*(?:tr|tỷ|M|B)\b/.test(amount))).toBe(true);
  });

  it('keeps the workspace usable when one authority fails', async () => {
    getMock.mockRejectedValueOnce(new Error('receivables unavailable'));
    renderPage('/?view=overview');

    expect((await screen.findByRole('alert')).textContent).toContain('Một phần số liệu chưa tải được');
    expect(screen.getByRole('link', { name: /Trung tâm phê duyệt/ })).toBeTruthy();
  });

  it('opens the bounded transport register inside the dedicated workspace', async () => {
    renderPage('/?view=transport');

    expect(await screen.findByRole('heading', { name: 'Sổ đối chiếu vận tải' })).toBeTruthy();
    expect((await screen.findAllByText('C-009')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(0);
    // Options live in the UUI popover — open each filter to list its options.
    fireEvent.click(screen.getByRole('button', { name: /Khách hàng/ }));
    expect(await screen.findByRole('option', { name: 'Silver Sea' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Nhà xe/ }));
    expect(await screen.findByRole('option', { name: 'Nhà xe Minh Phát' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    expect(screen.getAllByRole('link', { name: /Công nợ|Mở công nợ/ })[0].getAttribute('href')).toBe('/debt/5');
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('/finance/billing-documents/transport-register?'));

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Chọn chuyến C-009' })[0]);
    expect(screen.getByText(/Đã chọn 1 chuyến của Silver Sea/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tạo bản nháp giấy báo nợ' }).getAttribute('href'))
      .toBe('/debt/5/billing/new?selectedTripIds=9&from=2026-08-01&to=2026-08-01');

    fireEvent.click(screen.getByRole('button', { name: /Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Silver Sea' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('customerId=5')));
  });
});
