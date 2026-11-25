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
  let failThuReport = false;
  let emptyWorkCards = false;

  beforeEach(() => {
    failThuReport = false;
    emptyWorkCards = false;
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/expense-accounting/phoi-phieu/report/party-lots')) {
        const kind = new URLSearchParams(path.split('?')[1] ?? '').get('kind');
        if (emptyWorkCards) return Promise.resolve({ items: [] });
        return Promise.resolve({
          items: [{
            tripId: 9, shipmentId: 8, billOrBooking: 'YMJAI226573788',
            containerNumber: 'TGHU1234567', departureDate: '2026-08-01',
            tienNang: 0, tienHa: 500000, psKhac: 0, total: 500000,
            daThuTra: 0, conLai: 500000,
            party: kind === 'THU' ? 'LONG MINH' : 'NHA XE MINH PHAT',
            entries: [],
          }],
        });
      }
      if (path.startsWith('/expense-accounting/phoi-phieu/report')) {
        const kind = new URLSearchParams(path.split('?')[1] ?? '').get('kind');
        if (kind === 'THU' && failThuReport) return Promise.reject(new Error('report unavailable'));
        const row = {
          party: kind === 'THU' ? 'LONG MINH' : 'NHA XE MINH PHAT',
          partyShortName: null, partyId: kind === 'THU' ? 5 : 7,
          partyKind: kind === 'THU' ? 'customer' : 'carrier',
          tienNang: 0, tienHa: 500000, psKhac: 0, tongPhaiThuTra: 500000,
          daThuTra: 0, conLai: emptyWorkCards ? 0 : 500000,
          ghiChu: null, soLuong: 1, phaiThu: 0, phaiTra: 0,
        };
        return Promise.resolve({
          rows: emptyWorkCards ? [] : [row],
          grand: { ...row, party: 'TỔNG', conLai: emptyWorkCards ? 0 : 500000 },
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
          adjustmentCounts: { none: 1, pending: 0, confirmed: 0 },
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
            adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
          }],
        });
      }
      if (path.startsWith('/customers')) {
        // The two populations are separate requests now: the khách hàng filter
        // reads the (non-carrier) customer list, the nhà xe filter asks for
        // `?isCarrier=true`. A mock that ignored the flag would hide exactly the
        // regression this file guards — carriers leaking into the customer
        // dropdown.
        const wantsCarriers = new URLSearchParams(path.split('?')[1] ?? '').get('isCarrier') === 'true';
        const items = wantsCarriers
          ? [{ id: 7, name: 'Nhà xe Minh Phát', isCarrier: true }]
          : [{ id: 5, name: 'Silver Sea', isCarrier: false }];
        return Promise.resolve({ total: items.length, items });
      }
      return Promise.resolve({
        totals: { revenue: 40_000_000, directCost: 25_000_000, sharedOverhead: 0, profit: 15_000_000 },
        reconciliation: { status: 'RECONCILED', note: '' },
        sourceCoverage: { missingAttribution: 0 },
        asOf: '2026-08-01T00:00:00.000Z',
      });
    });
  });

  it('uses work as the default view and renders the three work cards (K6.42)', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Công việc kế toán' })).toBeTruthy();
    for (const title of ['Phải thu', 'Phải trả', 'Đối chiếu']) {
      expect(await screen.findByRole('region', { name: title }), title).toBeTruthy();
    }
    expect((await screen.findAllByText('LONG MINH')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Tạo phiếu thanh toán' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Tạo phiếu chi' }).length).toBeGreaterThan(0);
  });

  it('shows the compact empty line per card when the window has nothing open', async () => {
    emptyWorkCards = true;
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Chưa có khoản nào.').length).toBe(3));
  });

  it('keeps the other cards usable when one report fails', async () => {
    failThuReport = true;
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải phải thu');
    expect((await screen.findAllByText('NHA XE MINH PHAT')).length).toBeGreaterThan(0);
  });

  it('retains the existing overview as a secondary workspace', async () => {
    renderPage('/?view=overview');

    // The overview is retained as the secondary tab behind the work inbox;
    // the workspace h1 stays "Tổng quan kế toán" for both views.
    const overviewTab = screen.getByRole('tab', { name: 'Tổng quan' });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Tổng quan kế toán' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Công nợ phải thu/ }).getAttribute('href')).toBe('/debt');
    expect(screen.getByRole('link', { name: /Công nợ phải trả/ }).getAttribute('href')).toBe('/payables');
    expect(screen.getByRole('link', { name: /Báo cáo lãi lỗ/ }).getAttribute('href')).toBe('/finance');
    expect(screen.getByRole('link', { name: /Soát OCR nhiên liệu/ }).getAttribute('href')).toBe('/accounting/fuel-evidence');

    await waitFor(() => expect(screen.getAllByText('15.000.000 ₫').length).toBeGreaterThan(0));
    expect(screen.getByText('3.000.000 ₫')).toBeTruthy();
    expect(screen.getByText('8.000.000 ₫')).toBeTruthy();
    const amounts = Array.from(document.querySelectorAll('.summary-rail dd'))
      .map((node) => node.textContent ?? '');
    expect(amounts.every((amount) => !/\d\s*(?:tr|tỷ|M|B)\b/.test(amount))).toBe(true);
  });

  it('routes the Phơi phiếu / tiền đường shortcut to the dedicated control page (20260922_5)', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Phơi phiếu / tiền đường' }).getAttribute('href')).toBe('/accounting/phoi-phieu');
  });

  it('keeps the workspace usable when one authority fails', async () => {
    getMock.mockRejectedValueOnce(new Error('receivables unavailable'));
    renderPage('/?view=overview');

    expect((await screen.findByRole('alert')).textContent).toContain('Một phần số liệu chưa tải được');
  });

  // 2026-09-22 fix-forward (kanban run, card 20260922_5 landing): this body runs
  // ~4.3s in jsdom (three UUI listbox popover round-trips) and blew the 5s
  // default whenever the machine carried concurrent lane load. Timeout raised;
  // assertions untouched.
  it('opens the bounded transport register inside the dedicated workspace', async () => {
    renderPage('/?view=transport');

    // The filter triggers share their names with the register's new sort
    // headers — disambiguate by the listbox popup hint only the filters carry.
    const popoverTrigger = (name: RegExp) => screen.getAllByRole('button', { name })
      .find((el) => el.getAttribute('aria-haspopup') === 'listbox')!;

    expect(await screen.findByRole('heading', { name: 'Sổ đối chiếu vận tải' })).toBeTruthy();
    expect((await screen.findAllByText('C-009')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(0);
    // Options live in the UUI popover — open each filter to list its options.
    fireEvent.click(popoverTrigger(/Khách hàng/));
    expect(await screen.findByRole('option', { name: 'Silver Sea' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    fireEvent.click(popoverTrigger(/Nhà xe/));
    expect(await screen.findByRole('option', { name: 'Nhà xe Minh Phát' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    expect(screen.getAllByRole('link', { name: /Công nợ|Mở công nợ/ })[0].getAttribute('href')).toBe('/debt/5');
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('/finance/billing-documents/transport-register?'));

    // Card 20260929_207: the checkbox column is gone — the row is the control,
    // so a press on the trip itself picks it (same case, new affordance).
    fireEvent.click(screen.getAllByText('C-009')[0].closest('tr')!);
    expect(screen.getByText(/Đã chọn 1 chuyến của Silver Sea/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tạo bản nháp giấy báo nợ' }).getAttribute('href'))
      .toBe('/debt/5/billing/new?selectedTripIds=9&from=2026-08-01&to=2026-08-01');

    fireEvent.click(popoverTrigger(/Khách hàng/));
    fireEvent.click(await screen.findByRole('option', { name: 'Silver Sea' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('customerId=5')));
  }, 20_000);
});
