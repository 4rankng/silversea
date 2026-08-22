import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { driverOfflineCommandQueue } from '../../features/driver/useOfflineCommandQueue';
import { RoleWorkInbox } from './RoleWorkInbox';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  api: { get: apiGet, post: apiPost },
}));

const now = new Date().toISOString();
const base = {
  entityType: 'trip',
  entityId: 41,
  priority: 90,
  dueAt: null,
  freshnessAt: now,
  advisories: [],
  targetRoute: '/my-forwarder-trips/41',
};

function response(items: Array<Record<string, unknown>>, asOf = now) {
  return {
    asOf,
    timezone: 'Asia/Ho_Chi_Minh',
    counts: {
      action: items.filter((item) => item.state === 'ACTION').length,
      waiting: items.filter((item) => item.state === 'WAITING').length,
      done: items.filter((item) => item.state === 'DONE').length,
    },
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    items,
  };
}

const operationsItem = {
  ...base,
  id: 'shipment:14:trip:41',
  title: 'SHP-14',
  subtitle: 'MSBU1245657 · Long Minh · Nguyễn Văn An',
  state: 'ACTION',
  blockers: [{ code: 'PAPER_ORDER', label: 'Chưa bàn giao lệnh giấy', ownerRole: 'OPS', ownerLabel: 'Vận hành' }],
  nextAction: { label: 'Bàn giao lệnh gốc', targetRoute: '/my-forwarder-trips/41' },
  shipmentId: 14,
  shipmentVersion: 5,
  tripId: 41,
  containerSummary: 'MSBU1245657',
  driverName: 'Nguyễn Văn An',
  truckPlate: '15C-123.45',
  paperOrderState: 'IN_PROGRESS',
  orderExchangeState: 'COMPLETED',
  expenseEvidenceComplete: false,
};

const customerItem = {
  ...base,
  id: 'shipment:14',
  entityType: 'shipment',
  entityId: 14,
  title: 'SHP-14',
  subtitle: 'Tài xế đã báo giao; đang chờ phản hồi của khách hàng',
  state: 'ACTION',
  blockers: [],
  nextAction: { label: 'Phản hồi giao hàng', targetRoute: '/portal/shipments/14' },
  targetRoute: '/portal/shipments/14',
  shipmentId: 14,
  containerSummary: 'MSBU1245657',
  deliveryTruth: 'DRIVER_REPORTED',
  deliveryResponseRequired: true,
  deliveryEventId: 81,
  deliveryEventVersion: 3,
};

describe('RoleWorkInbox', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    driverOfflineCommandQueue.clear();
  });

  it('renders loading, populated desktop table facts, tabs, and empty state', async () => {
    let resolve!: (value: unknown) => void;
    apiGet.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce(response([]));
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    expect(screen.getByText('Đang tải công việc…')).toBeTruthy();
    resolve(response([operationsItem]));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Nguyễn Văn An')).toBeTruthy();
    expect(within(table).getByText('MSBU1245657')).toBeTruthy();
    expect(within(table).getByText('Còn thiếu')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Đang chờ/ }));
    expect(await screen.findByText('Không có việc trong nhóm này.')).toBeTruthy();
  });

  it('shows a full error, retries, preserves data on a partial refresh error, and flags stale data', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline'));
    apiGet.mockResolvedValueOnce(response([operationsItem], '2026-01-01T00:00:00.000Z'));
    apiGet.mockRejectedValueOnce(new Error('offline again'));
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    expect(await screen.findByText('Không thể tải công việc.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Dữ liệu đã cũ. Hãy làm mới trước khi xử lý.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    expect(await screen.findByText('Không thể làm mới; đang hiển thị dữ liệu gần nhất.')).toBeTruthy();
    expect(screen.getByText('SHP-14')).toBeTruthy();
  });

  it('shows the offline truth and never reports a queued role command as complete', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    apiGet.mockResolvedValue(response([operationsItem]));
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    expect(await screen.findByText(/chỉ hiển thị hoàn tất sau khi máy chủ xác nhận/)).toBeTruthy();
  });

  it('isolates customer reads and submits a versioned confirmation with a stable idempotency key', async () => {
    apiGet.mockResolvedValue(response([customerItem]));
    apiPost.mockResolvedValue({ replayed: false });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    render(<MemoryRouter><RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={7} /></MemoryRouter>);
    expect(await screen.findByText('Tài xế báo đã giao')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/portal/work-inbox?view=ACTION&page=1&limit=100&customerId=7');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã nhận hàng' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/portal/shipments/14/customer-events/81/delivery-response?customerId=7',
      { expectedVersion: 3, decision: 'CONFIRMED', reason: undefined },
      { idempotencyKey: '11111111-1111-4111-8111-111111111111' },
    ));
    expect(await screen.findByText('Đã đồng bộ xác nhận nhận hàng.')).toBeTruthy();
  });

  it('requires a dispute reason and preserves the draft on a 409 conflict', async () => {
    apiGet.mockResolvedValue(response([customerItem]));
    apiPost.mockRejectedValue(new ApiError(409, { error: 'version' }, 'Phiên bản đã thay đổi'));
    render(<MemoryRouter><RoleWorkInbox role="customer" title="Theo dõi lô hàng" description="Mô tả" customerId={7} /></MemoryRouter>);
    await screen.findByText('Tài xế báo đã giao');
    fireEvent.click(screen.getByRole('button', { name: 'Báo sai lệch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi báo sai lệch' }));
    expect(screen.getByText('Vui lòng nêu lý do sai lệch.')).toBeTruthy();
    const draft = screen.getByLabelText('Lý do sai lệch');
    fireEvent.change(draft, { target: { value: 'Thiếu một kiện hàng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi báo sai lệch' }));
    expect(await screen.findByText(/Dữ liệu nháp vẫn được giữ/)).toBeTruthy();
    expect((draft as HTMLTextAreaElement).value).toBe('Thiếu một kiện hàng');
  });

  it('loads each tab from its server-scoped page and supports Arrow, Home, and End keyboard navigation', async () => {
    apiGet.mockResolvedValue(response([]));
    render(<MemoryRouter><RoleWorkInbox role="driver" title="Việc hôm nay" description="Mô tả" /></MemoryRouter>);
    const first = await screen.findByRole('tab', { name: /Cần làm/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const waiting = screen.getByRole('tab', { name: /Đang chờ/ });
    await waitFor(() => expect(waiting.getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/driver/me/work-inbox?view=WAITING&page=1&limit=100'));
    fireEvent.keyDown(waiting, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Hoàn tất/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Hoàn tất/ }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: /Cần làm/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('paginates a state instead of silently hiding work beyond the first 100 rows', async () => {
    apiGet.mockResolvedValueOnce({ ...response([operationsItem]), total: 101, totalPages: 2 }).mockResolvedValueOnce({ ...response([]), page: 2, total: 101, totalPages: 2 });
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    await screen.findByText('SHP-14');
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/forwarder/me/work-inbox?view=ACTION&page=2&limit=100'));
  });

  it('keeps pre-trip Operations exchange work actionable and only confirms after the matching command succeeds', async () => {
    const preTrip = { ...operationsItem, id: 'shipment:14:pretrip', entityType: 'shipment_order_exchange', entityId: 14, tripId: null, targetRoute: '/my-orders', nextAction: { label: 'Bắt đầu đổi lệnh', targetRoute: '/my-orders' }, orderExchangeState: 'PENDING', paperOrderState: 'PENDING' };
    apiGet.mockResolvedValue(response([preTrip]));
    apiPost.mockResolvedValue({ version: 6 });
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu đổi lệnh' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/forwarder/me/shipments/14/order-exchange/start', { expectedVersion: 5 }, expect.objectContaining({ idempotencyKey: expect.any(String) })));
    expect(await screen.findByText('Máy chủ đã xác nhận bắt đầu đổi lệnh.')).toBeTruthy();
  });

  it('ignores an older tab response that resolves after the active state request', async () => {
    let resolveAction!: (value: unknown) => void;
    let resolveWaiting!: (value: unknown) => void;
    apiGet.mockImplementation((path: string) => new Promise((resolve) => {
      if (path.includes('view=WAITING')) resolveWaiting = resolve;
      else resolveAction = resolve;
    }));
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: /Đang chờ/ }));
    const waitingItem = { ...operationsItem, id: 'shipment:15:trip:42', title: 'SHP-WAITING', state: 'WAITING' };
    await act(async () => { resolveWaiting(response([waitingItem])); });
    expect(await screen.findByText('SHP-WAITING')).toBeTruthy();
    await act(async () => { resolveAction(response([operationsItem])); });
    expect(screen.getByText('SHP-WAITING')).toBeTruthy();
    expect(screen.queryByText('SHP-14')).toBeNull();
  });

  it('does not loop role-level replay after a persistent network failure', async () => {
    const preTrip = { ...operationsItem, id: 'shipment:14:pretrip', entityType: 'shipment_order_exchange', entityId: 14, tripId: null, targetRoute: '/my-orders', nextAction: { label: 'Bắt đầu đổi lệnh', targetRoute: '/my-orders' }, orderExchangeState: 'PENDING', paperOrderState: 'PENDING' };
    apiGet.mockResolvedValue(response([preTrip]));
    apiPost.mockRejectedValue(new TypeError('offline'));
    render(<MemoryRouter><RoleWorkInbox role="operations" title="Công việc vận hành" description="Mô tả" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu đổi lệnh' }));
    await screen.findByText('Đã lưu lệnh ngoại tuyến; chưa được xem là hoàn tất.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
