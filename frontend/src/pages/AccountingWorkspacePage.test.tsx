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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AccountingWorkspacePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountingWorkspacePage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
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

  it('composes finance authorities without duplicating their workflows', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Tổng Quan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Công nợ phải thu/ }).getAttribute('href')).toBe('/debt');
    expect(screen.getByRole('link', { name: /Công nợ phải trả/ }).getAttribute('href')).toBe('/payables');
    expect(screen.getByRole('link', { name: /Báo cáo lãi lỗ/ }).getAttribute('href')).toBe('/finance');

    await waitFor(() => expect(screen.getAllByText('15.000.000 ₫').length).toBeGreaterThan(0));
    expect(screen.getByText('3.000.000 ₫')).toBeTruthy();
    expect(screen.getByText('8.000.000 ₫')).toBeTruthy();
    const amounts = Array.from(document.querySelectorAll('.accounting-kpi strong'))
      .map((node) => node.textContent ?? '');
    expect(amounts.every((amount) => !/\d\s*(?:tr|tỷ|M|B)\b/.test(amount))).toBe(true);
  });

  it('keeps the workspace usable when one authority fails', async () => {
    getMock.mockRejectedValueOnce(new Error('receivables unavailable'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Một phần số liệu chưa tải được');
    expect(screen.getByRole('link', { name: /Trung tâm phê duyệt/ })).toBeTruthy();
  });

  it('opens the bounded transport register inside the dedicated workspace', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('link', { name: 'Đối chiếu vận tải' })[0]);

    expect(await screen.findByRole('heading', { name: 'Sổ đối chiếu vận tải' })).toBeTruthy();
    expect((await screen.findAllByText('C-009')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'Silver Sea' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nhà xe Minh Phát' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Công nợ|Mở công nợ/ })[0].getAttribute('href')).toBe('/debt/5');
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('/finance/billing-documents/transport-register?'));

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Chọn chuyến C-009' })[0]);
    expect(screen.getByText(/Đã chọn 1 chuyến của Silver Sea/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tạo bản nháp giấy báo nợ' }).getAttribute('href'))
      .toBe('/debt/5/billing/new?selectedTripIds=9&from=2026-08-01&to=2026-08-01');

    fireEvent.change(screen.getByLabelText('Khách hàng'), { target: { value: '5' } });
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('customerId=5')));
  });
});
