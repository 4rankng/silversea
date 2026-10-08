import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { apiGet, authState } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  authState: { role: 'OPS' as string, capabilities: [] as string[] },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

vi.mock('../hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAuth')>('../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: {
        userId: 7,
        username: 'ops1',
        email: null,
        phone: null,
        role: authState.role,
        fullName: 'Ops Tổng quan',
        capabilities: authState.capabilities,
      },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: true,
      loading: false,
      sessionExpired: false,
    }),
  };
});

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div>,
}));

vi.mock('../pages/AccountingWorkspacePage', () => ({
  default: () => <div>accounting home</div>,
}));

import OpsOverviewPage from './OpsOverviewPage';
import { localDateInputValue } from '../features/ops/opsStatus';
import { formatMoney } from '../lib/format';
import { AppRoutes } from '../App';

// ── payload builders — shapes match api/opsClient.ts ─────────────────────────

const order = (id: number, status: string | null) => ({
  id,
  shipmentCode: `SS-${id}`,
  status,
  tradeDirection: 'EXPORT',
  billRef: `BL-${id}`,
  customerName: 'Khách A',
  routeName: 'Tuyến A',
  pinned: false,
  pinnedAt: null,
  containerCount: 1,
  containerNumbers: [`TSTU000000${id}`],
  containerIds: [id],
});

const truck = (id: number, status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | null) => ({
  truckId: id,
  licensePlate: `51C-000${id}`,
  trailerPlate: null,
  tripId: status === null ? null : id,
  tripCode: `TR-${id}`,
  shipmentCode: null,
  billRef: null,
  driverName: 'Tài xế A',
  status,
  lastEventType: null,
  updatedAt: '2026-10-08T01:00:00.000Z',
});

const summary = (balance = '1560000') => ({
  totalAdvance: '2000000',
  approved: '350000',
  pending: '90000',
  rejected: '0',
  returned: '0',
  balance,
});

const advanceEnvelope = (statusCounts: Record<string, number>) => ({
  items: [],
  total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
  page: 1,
  limit: 50,
  statusCounts,
});

type MockTarget = 'orders' | 'fleet' | 'walletSummary' | 'advanceRequests';

type MockData = {
  orders?: unknown;
  fleet?: unknown;
  walletSummary?: unknown;
  advanceRequests?: unknown;
  fail?: MockTarget[];
};

function mockApi({ orders, fleet, walletSummary, advanceRequests, fail = [] }: MockData) {
  apiGet.mockImplementation((url: string) => {
    const target: MockTarget | null = url.startsWith('/ops/orders')
      ? 'orders'
      : url.startsWith('/ops/fleet')
        ? 'fleet'
        : url.startsWith('/ops/wallet/summary')
          ? 'walletSummary'
          : url.startsWith('/ops/wallet/advance-requests')
            ? 'advanceRequests'
            : null;
    if (target && fail.includes(target)) {
      return Promise.reject(new Error(`mock failure: ${url}`));
    }
    if (target === 'orders') return Promise.resolve({ date: localDateInputValue(), items: orders ?? [] });
    if (target === 'fleet') return Promise.resolve({ items: fleet ?? [] });
    if (target === 'walletSummary') return Promise.resolve(walletSummary ?? summary());
    if (target === 'advanceRequests') {
      return Promise.resolve(advanceRequests ?? advanceEnvelope({}));
    }
    return Promise.resolve({ items: [] });
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OpsOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function kpiCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('.kpi');
  if (!(card instanceof HTMLElement)) throw new Error(`no KPI card for ${label}`);
  return card;
}

function kpiValue(label: string): string | null | undefined {
  return kpiCard(label).querySelector('.kpi__value')?.textContent;
}

function kpiMeta(label: string): string | null | undefined {
  return kpiCard(label).querySelector('.kpi__meta')?.textContent;
}

function RouteProbe({ log }: { log: string[] }) {
  const location = useLocation();
  log[0] = location.pathname;
  return null;
}

function renderRoute(path: string, log: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <RouteProbe log={log} />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ORDERS_LABEL = 'Kế hoạch làm hàng chờ xử lý';
const FLEET_LABEL = 'Xe đang chạy';
const WALLET_LABEL = 'Số dư quỹ tạm ứng';

describe('OpsOverviewPage — metric cards from the existing Ops endpoints', () => {
  beforeEach(() => {
    apiGet.mockReset();
    authState.role = Role.OPS;
    authState.capabilities = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('counts unfinished plan lots, running trucks and the fund balance + pending requests', async () => {
    mockApi({
      // NEW / DISPATCHED / null stay pending; COMPLETED is done.
      orders: [order(1, 'NEW'), order(2, 'DISPATCHED'), order(3, null), order(4, 'COMPLETED')],
      // IN_TRANSIT = "đang chạy"; CREATED and idle trucks do not count.
      fleet: [truck(1, 'IN_TRANSIT'), truck(2, 'IN_TRANSIT'), truck(3, 'CREATED'), truck(4, null)],
      walletSummary: summary('1560000'),
      advanceRequests: advanceEnvelope({ DRAFT: 3, RECORDED: 2, VOIDED: 1 }),
    });
    renderPage();

    expect(await screen.findByText(ORDERS_LABEL)).toBeTruthy();
    // "chờ xử lý" = status khác COMPLETED → 3 trong 4 lô của ngày.
    // Each widget resolves on its own query — settle each before asserting it.
    await waitFor(() => expect(kpiValue(ORDERS_LABEL)).toMatch(/^3\s*lô$/));
    expect(kpiMeta(ORDERS_LABEL)).toContain('4 lô trong ngày giao dự kiến');
    // "đang chạy" = IN_TRANSIT → 2 trong 4 xe đang theo dõi.
    await waitFor(() => expect(kpiValue(FLEET_LABEL)).toMatch(/^2\s*xe$/));
    expect(kpiMeta(FLEET_LABEL)).toBe('đang vận chuyển · 4 xe đang theo dõi');
    // Số dư from /ops/wallet/summary; chờ duyệt = statusCounts.DRAFT ("chưa ghi sổ").
    await waitFor(() => expect(kpiValue(WALLET_LABEL)).toBe(`${formatMoney('1560000')}₫`));
    expect(kpiMeta(WALLET_LABEL)).toBe('3 yêu cầu chờ duyệt (chưa ghi sổ)');
    // The plan metric reads the same date default the /ops/orders screen uses.
    expect(apiGet).toHaveBeenCalledWith(`/ops/orders?date=${localDateInputValue()}`);
  });

  it('states the empty day, the unfleeted account and no pending requests instead of fake zeros', async () => {
    mockApi({
      orders: [],
      fleet: [],
      walletSummary: summary('0'),
      advanceRequests: advanceEnvelope({}),
    });
    renderPage();

    expect(await screen.findByText(ORDERS_LABEL)).toBeTruthy();
    await waitFor(() => expect(kpiValue(ORDERS_LABEL)).toMatch(/^0\s*lô$/));
    expect(kpiMeta(ORDERS_LABEL)).toBe('Không có lô hàng trong ngày này.');
    await waitFor(() => expect(kpiValue(FLEET_LABEL)).toMatch(/^0\s*xe$/));
    expect(kpiMeta(FLEET_LABEL)).toBe('Chưa có xe nào được giao cho bạn quản lý.');
    await waitFor(() => expect(kpiValue(WALLET_LABEL)).toBe(`${formatMoney('0')}₫`));
    expect(kpiMeta(WALLET_LABEL)).toBe('Chưa có yêu cầu chờ duyệt.');
  });

  it('says the day is finished when the plan still has lots but none pending', async () => {
    mockApi({
      orders: [order(1, 'COMPLETED'), order(2, 'COMPLETED')],
      fleet: [truck(1, 'IN_TRANSIT')],
    });
    renderPage();

    expect(await screen.findByText(ORDERS_LABEL)).toBeTruthy();
    await waitFor(() => expect(kpiValue(ORDERS_LABEL)).toMatch(/^0\s*lô$/));
    expect(kpiMeta(ORDERS_LABEL)).toBe('Tất cả 2 lô trong ngày đã hoàn thành.');
  });

  it('degrades a failed widget to a dash with a retry while the other widgets stay live', async () => {
    mockApi({
      orders: [order(1, 'NEW')],
      fleet: [truck(1, 'IN_TRANSIT'), truck(2, 'IN_TRANSIT')],
      walletSummary: summary('1560000'),
      advanceRequests: advanceEnvelope({ DRAFT: 3 }),
      fail: ['orders', 'walletSummary'],
    });
    renderPage();

    expect(await screen.findByText('Không tải được kế hoạch làm hàng. Vui lòng thử lại.')).toBeTruthy();
    expect(await screen.findByText('Không tải được số dư. Vui lòng thử lại.')).toBeTruthy();
    // A failure never reads as a zero — the value degrades to an em dash.
    await waitFor(() => expect(kpiValue(ORDERS_LABEL)).toBe('—'));
    expect(kpiValue(WALLET_LABEL)).toBe('—');
    // Per-widget isolation: the fleet widget and the request count keep working.
    await waitFor(() => expect(kpiValue(FLEET_LABEL)).toMatch(/^2\s*xe$/));
    await waitFor(() => expect(kpiMeta(WALLET_LABEL)).toBe('3 yêu cầu chờ duyệt (chưa ghi sổ)'));
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(2);
  });
});

describe('OpsOverviewPage — quick links', () => {
  beforeEach(() => {
    apiGet.mockReset();
    authState.role = Role.OPS;
    mockApi({});
  });

  it('links to the three existing Ops destinations', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Kế hoạch làm hàng/ })).toHaveAttribute('href', '/ops/orders');
    expect(screen.getByRole('link', { name: /Theo dõi phương tiện/ })).toHaveAttribute('href', '/ops/fleet-tracking');
    expect(screen.getByRole('link', { name: /Quỹ tạm ứng/ })).toHaveAttribute('href', '/ops/wallet');
  });
});

describe('OpsOverviewPage — route registration and guard', () => {
  beforeEach(() => {
    apiGet.mockReset();
    authState.capabilities = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders the /ops route for OPS with the three metric cards and three quick links', async () => {
    authState.role = Role.OPS;
    mockApi({});
    const log: string[] = [];
    renderRoute('/ops', log);

    expect(await screen.findByText('Tổng quan Ops')).toBeTruthy();
    expect(screen.getByText(ORDERS_LABEL)).toBeTruthy();
    expect(screen.getByText(FLEET_LABEL)).toBeTruthy();
    expect(screen.getByText(WALLET_LABEL)).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(3);
    await waitFor(() => expect(log[0]).toBe('/ops'));
  });

  it('follows the existing opsOnly guard: a non-OPS role is sent to its own home', async () => {
    authState.role = Role.ACCOUNTANT;
    mockApi({});
    const log: string[] = [];
    renderRoute('/ops', log);

    await waitFor(() => expect(log[0]).toBe('/accounting'));
  });
});
