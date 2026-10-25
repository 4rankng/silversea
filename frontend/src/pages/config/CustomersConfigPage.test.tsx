import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer, TripDetail } from '@tingting/shared';

const getAllCustomers = vi.fn();
const fetchAllTrips = vi.fn();
const getCustomerAging = vi.fn();

vi.mock('../../api/configClient', () => ({
  configClient: { getAllCustomers: (...args: unknown[]) => getAllCustomers(...args) },
}));

vi.mock('../../api/tripClient', () => ({
  tripClient: { fetchAllTrips: (...args: unknown[]) => fetchAllTrips(...args) },
}));

// SIL-169: the header metrics read the EXISTING receivables-aging projection
// (mocked here with one overdue high-risk customer) and the ledger feed (one
// customer idle for 40 days).
vi.mock('../../api/financialClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/financialClient')>();
  return {
    ...original,
    financialClient: { ...original.financialClient, getCustomerAging: (...args: unknown[]) => getCustomerAging(...args) },
  };
});

const ledgerEntries = vi.fn();

vi.mock('../../hooks/useQueries', () => ({
  useCustomerLedgerEntries: () => ({ data: ledgerEntries() }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useBackShortcut', () => ({
  useBackShortcut: () => {},
}));

vi.mock('../../hooks/useDropdownDismiss', () => ({
  useDropdownDismiss: () => {},
}));

// Auth identity is mutable per test: null (no provider, full mode) by
// default; the dispatcher-mode tests point it at a DISPATCHER user.
const authState = vi.hoisted(() => ({ context: null as null | { user: { userId: number; username: string; role: string } } }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => authState.context,
}));

vi.mock('../../hooks/useCRUD', () => ({
  useCRUD: () => ({
    editingId: null,
    showAddForm: false,
    saving: false,
    deleting: null,
    error: null,
    setShowAddForm: vi.fn(),
    setEditingId: vi.fn(),
    cancelForm: vi.fn(),
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
  }),
}));

import CustomersConfigPage from './CustomersConfigPage';

function makeCustomer(id: number, name: string, creditLimit: string): Customer {
  return {
    id,
    name,
    // Card 20260922_22 fixtures keep every field populated; SIL-169 stores
    // the legal name in ALL CAPS (catalog reality) — the table renders it
    // title-case.
    shortName: `TCT-${id}`,
    code: `KH-${String(id).padStart(3, '0')}`,
    taxCode: `010${String(id).padStart(8, '0')}`,
    address: `Số ${id} đường Trần Phú`,
    contactPerson: `Người liên hệ ${id}`,
    phone: `09010000${String(id).padStart(2, '0')}`,
    accountantName: `Kế toán ${id}`,
    accountantPhone: `09020000${String(id).padStart(2, '0')}`,
    contactInfo: 'Zalo / email',
    agencyFeePaymentTermDays: 30,
    paymentTermDays: 45,
    creditLimit,
    creditWarningThreshold: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Customer;
}

// Fixture order is NOT sorted on any column: limits run 30M, 10M, 20M.
const customers = [
  makeCustomer(1, 'KHÁCH HÀNG AN', '30000000'),
  makeCustomer(2, 'KHÁCH HÀNG BÌNH', '10000000'),
  makeCustomer(3, 'KHÁCH HÀNG CƯỜNG', '20000000'),
];

const IDLE_SINCE_ISO = new Date(Date.now() - 40 * 86_400_000).toISOString();

const agingResponse = () => ({
  customers: [
    {
      customerId: 1, customerName: 'KHÁCH HÀNG AN', contactInfo: null,
      linkedSupplierId: null, linkedSupplierApBalance: 0, netBalance: 0,
      totalOutstanding: 120_000_000,
      aging: { current: 40_000_000, d30: 80_000_000, d60: 0, over90: 0 },
      maxOverdueDays: 12,
    },
  ],
  page: 1, limit: 200, total: 1, totalPages: 1,
  totals: {
    total: 120_000_000, current: 40_000_000, d30: 80_000_000, d60: 0, over90: 0,
    currentCusts: 0, d30Custs: 1, d60Custs: 0, over90Custs: 0,
    overdueCount: 1, highRiskCount: 1,
  },
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomersConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function nameOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.cfg-customer-table tbody .row-strong'))
    .map((el) => el.textContent ?? '');
}

beforeEach(() => {
  authState.context = { user: { userId: 1, username: 'admin', role: 'ADMIN' } };
  getAllCustomers.mockReset().mockResolvedValue(customers);
  fetchAllTrips.mockReset().mockResolvedValue({ items: [] as TripDetail[], total: 0 });
  getCustomerAging.mockReset().mockResolvedValue(agingResponse());
  ledgerEntries.mockReset().mockReturnValue([
    { entityType: 'CUSTOMER', entityId: 2, timestamp: IDLE_SINCE_ISO },
    { entityType: 'CUSTOMER', entityId: 1, timestamp: new Date().toISOString() },
  ]);
});

describe('CustomersConfigPage client-side sorting', () => {
  it('renders the three inline header metrics from the aging + ledger feeds (SIL-169)', async () => {
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    // Metric ①: d30+d60+over90 = 80tr, 1 KH overdue, red tone via the token.
    const overdue = screen.getByTestId('cus-metric-overdue');
    expect(overdue.textContent).toContain('80');
    expect(overdue.textContent).toContain('tr');
    expect(overdue.textContent).toContain('1 KH');
    expect(overdue.querySelector('.cus-metric__value')).toHaveAttribute('data-tone', 'overdue');
    // Metric ②: customer 2 last posted 40 days ago; customer 3 never posted
    // and anchors at its 2026-01-01 creation (QA wave 8cea1a6b) — 2 KH idle,
    // oldest anchor 01/01.
    const idle = screen.getByTestId('cus-metric-idle30');
    expect(idle.textContent).toContain('2 KH');
    expect(idle.textContent).toContain('từ 01/01');
    // Metric ③: one high-risk row per the aging classification.
    expect(screen.getByTestId('cus-metric-risk').textContent).toContain('1 KH');
  });

  it('metrics degrade to the honest em-dash when the feeds are unavailable', async () => {
    getCustomerAging.mockRejectedValue(new Error('403'));
    ledgerEntries.mockReturnValue(undefined);
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    for (const testId of ['cus-metric-overdue', 'cus-metric-idle30', 'cus-metric-risk']) {
      expect(screen.getByTestId(testId).textContent).toContain('—');
    }
    // The debt column reads '—' too — never an invented number.
    const row = screen.getByText('Khách Hàng An', { selector: '.cfg-customer-full-name' }).closest('tr');
    expect(row?.querySelector('.cus-debt-cell')?.textContent).toBe('—');
  });

  it('keeps the fetch order until a header is used', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    expect(nameOrder(container)).toEqual(['Khách Hàng An', 'Khách Hàng Bình', 'Khách Hàng Cường']);
  });

  it('sorts by name via the Vietnamese collation', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    expect(nameOrder(container)).toEqual(['Khách Hàng An', 'Khách Hàng Bình', 'Khách Hàng Cường']);
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    expect(nameOrder(container)).toEqual(['Khách Hàng Cường', 'Khách Hàng Bình', 'Khách Hàng An']);
  });
});

describe('CustomersConfigPage dispatcher edit/delete access', () => {
  beforeEach(() => {
    authState.context = { user: { userId: 5, username: 'dispatch', role: 'DISPATCHER' } };
  });

  it('shows the create button and per-row action menu for DISPATCHER', async () => {
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    expect(screen.getByRole('button', { name: /Thêm khách hàng/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thao tác khách hàng TCT-1' })).toBeTruthy();
  });

  it('renders the action column for full catalog editors', async () => {
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    expect(screen.getAllByRole('button', { name: /Thao tác khách hàng/ })).toHaveLength(3);
  });
});

describe('UI-CD-09 catalog query whitespace', () => {
  it('normalizes API queries while preserving the typed search', async () => {
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm khách hàng/ }), { target: { value: '  An  ' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('An'));
  });
});

describe('SIS-ROLE-01/02 optional customer trip statistics', () => {
  it('does not request unavailable trip statistics for CUS', async () => {
    authState.context = { user: { userId: 2, username: 'cus', role: 'CUS' } };
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    expect(fetchAllTrips).not.toHaveBeenCalled();
    expect(screen.getByText('Tài khoản không xem doanh thu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm khách hàng/ }), { target: { value: 'An' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('An'));
    expect(fetchAllTrips).not.toHaveBeenCalled();
  });

  it('loads the catalog independently and does not refetch statistics for search', async () => {
    let resolveTrips!: (value: { items: TripDetail[]; total: number }) => void;
    fetchAllTrips.mockImplementation(() => new Promise(resolve => { resolveTrips = resolve; }));
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    expect(screen.getByText('Đang tải doanh thu…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeDisabled();
    expect(fetchAllTrips).toHaveBeenCalledTimes(1);
    expect(fetchAllTrips).toHaveBeenCalledWith({ dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/), dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    fireEvent.change(screen.getByRole('textbox', { name: /Tìm khách hàng/ }), { target: { value: 'Bình' } });
    await waitFor(() => expect(getAllCustomers).toHaveBeenLastCalledWith('Bình'));
    expect(fetchAllTrips).toHaveBeenCalledTimes(1);
    resolveTrips({ items: [], total: 0 });
    await screen.findByText('Chưa có doanh thu tháng này');
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
  });

  it('keeps customers visible when statistics fail and retries only statistics', async () => {
    fetchAllTrips.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    await screen.findByText('Không thể tải doanh thu.');
    expect(screen.queryByText('Chưa có doanh thu tháng này')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeDisabled();
    const catalogCalls = getAllCustomers.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Chưa có doanh thu tháng này');
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeEnabled();
    expect(getAllCustomers).toHaveBeenCalledTimes(catalogCalls);
    expect(fetchAllTrips).toHaveBeenCalledTimes(2);
  });
});

describe('ListFilterBar adoption (card 20260922_38 + SIL-169 tabs)', () => {
  it('renders the shared bar with search and the tab segment, no duplicate filter select', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The hand-rolled toolbar and its duplicate mobile filter select are gone.
    expect(container.querySelector('.cfg-customer-toolbar, .cfg-customer-filter-chips, .cfg-customer-search, .cfg-customer-filter-select')).toBeNull();
    const group = screen.getByRole('group', { name: 'Lọc khách hàng' });
    // SIL-169: the boxed tab segment — Tất cả / Rủi ro cao / Hoạt động; the
    // all-ACTIVE fixture (locked = 0) must NOT render a Tạm khoá tab.
    const tabs = within(group).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Tất cả3', 'Rủi ro cao1', 'Hoạt động3']);
    within(bar).getByRole('textbox', { name: 'Tìm khách hàng theo tên, tên ngắn, mã số thuế, điện thoại hoặc người liên hệ' });
  });

  it('routes the empty face through the shared EmptyState', async () => {
    getAllCustomers.mockResolvedValue([]);
    renderPage();
    const face = await screen.findByText('Chưa có khách hàng');
    expect(face.closest('.ds-empty-state')).not.toBeNull();
  });
});

describe('SIL-169 seven-column table contract', () => {
  it('renders the verdict headers with the fixed width budget', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    const headers = Array.from(container.querySelectorAll('.cfg-customer-table thead th'))
      .map((th) => (th.textContent ?? '').trim());
    expect(headers).toEqual(['Khách hàng', 'MST', 'Địa chỉ', 'Liên hệ', 'Hạn thanh toán', 'Công nợ', 'Thao tác']);
    // The verdict's widths ride the colgroup (260/110/180/180/96/120); the
    // kebab column rides the .cus-col-action class (no inline width — it
    // must answer the coarse-pointer media query). The term header reads the
    // full "HẠN THANH TOÁN" (QA wave 8cea1a6b ④) and wraps unclipped.
    const widths = Array.from(container.querySelectorAll('.cfg-customer-table colgroup col'))
      .map((col) => col.getAttribute('style'));
    expect(widths).toEqual([
      'width: 260px;', 'width: 110px;', 'width: 180px;', 'width: 180px;',
      'width: 96px;', 'width: 120px;', null,
    ]);
    expect(container.querySelector('.cfg-customer-table colgroup col.cus-col-action')).not.toBeNull();
  });

  it('renders identity, contact stack, term and the aging debt signal per row', async () => {
    const { container } = renderPage();
    await screen.findByText('Khách Hàng An', { selector: '.cfg-customer-full-name' });
    const row = screen.getByText('Khách Hàng An', { selector: '.cfg-customer-full-name' }).closest('tr');
    expect(row).not.toBeNull();
    // Identity: risk dot + title-case name + chip + code sub-line.
    expect(row!.querySelector('.cus-dot--high')).not.toBeNull();
    expect(row!.textContent).toContain('TCT-1');
    expect(row!.textContent).toContain('KH-001');
    // Contact: main line + muted accountant line. The stored catalog value is
    // cased as typed; the cell renders it title-case (QA wave 8cea1a6b ②).
    expect(row!.textContent).toContain('Người Liên Hệ 1');
    expect(row!.textContent).toContain('Kế toán 1');
    // Payment term: cước first ("45 ngày").
    expect(row!.querySelector('.cus-term-cell')?.textContent).toContain('45');
    // Debt: aging outstanding, red + overdue sub-line (12 days).
    const debt = row!.querySelector('.cus-debt-cell');
    expect(debt).toHaveAttribute('data-overdue', 'true');
    expect(debt?.textContent).toContain('tr');
    expect(debt?.textContent).toContain('quá hạn 12 ngày');
    // The old two-tier group bands and presence-driven columns are gone.
    expect(container.querySelector('.cfg-customer-group-row')).toBeNull();
    expect(container.querySelector('.cfg-customer-details')).toBeNull();
  });

  it('keeps the seven columns for a sparse row — placeholders, not missing cells', async () => {
    const sparse = {
      ...makeCustomer(9, 'KHÁCH HÀNG SPARSE', '0'),
      shortName: '', code: '', taxCode: '', address: '', contactPerson: '', phone: '',
      accountantName: '', accountantPhone: '', contactInfo: '',
      paymentTermDays: null, agencyFeePaymentTermDays: null,
    } as unknown as Customer;
    getAllCustomers.mockResolvedValue([sparse]);
    const { container } = renderPage();
    await screen.findByText('Khách Hàng Sparse', { selector: '.cfg-customer-full-name' });
    const row = container.querySelector('.cfg-customer-table tbody tr');
    expect(row?.querySelectorAll('td')).toHaveLength(7);
    expect(row?.textContent).toContain('—');
  });
});
