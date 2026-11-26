import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  api: { get: apiGetMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import AuditLogPage from './AuditLogPage';

function entry(id: number, userName: string) {
  return {
    id,
    timestamp: `2026-08-2${id}T08:00:00.000Z`,
    userName,
    userEmail: `${userName.toLowerCase()}@example.com`,
    action: 'ENTITY_UPDATED',
    category: 'config',
    message: `Cập nhật cấu hình ${id}`,
    payload: {},
    ipAddress: '10.0.0.8',
  };
}

beforeEach(() => {
  apiGetMock.mockReset().mockResolvedValue({ items: [entry(1, 'An'), entry(2, 'Bình')], total: 2 });
  // The page wires an IntersectionObserver for infinite scroll on the last row.
  vi.stubGlobal('IntersectionObserver', class {
    observe() { /* jsdom stub */ }
    unobserve() { /* jsdom stub */ }
    disconnect() { /* jsdom stub */ }
  });
});

function lastUrl(): string {
  const calls = apiGetMock.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? '');
}

function renderAuditPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogPage />
    </QueryClientProvider>,
  );
}

describe('AuditLogPage server-side column sort', () => {
  it('queries without sort params by default (newest-first server order)', async () => {
    renderAuditPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Người dùng' })).toBeTruthy());
    expect(lastUrl()).toBe('/audit-logs?page=1&limit=10');
    expect(lastUrl()).not.toContain('sortBy');
  });

  it('header click sends sortBy/sortDir asc then desc', async () => {
    renderAuditPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Người dùng' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Người dùng' }));
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&sortBy=userName&sortDir=asc'));
    expect(screen.getByRole('columnheader', { name: 'Người dùng' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Người dùng' }));
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&sortBy=userName&sortDir=desc'));
    expect(screen.getByRole('columnheader', { name: 'Người dùng' }).getAttribute('aria-sort')).toBe('descending');
  });
});

describe('AuditLogPage filter strip (card 20260927_152)', () => {
  it('keeps the category labels and writes the picked category as the one query param', async () => {
    renderAuditPage();
    const tablist = await screen.findByRole('tablist', { name: 'Lọc theo nhóm hoạt động' });
    for (const label of ['Tất cả', 'Chuyến đi', 'Cấu hình', 'Tài chính', 'Xác thực', 'Kỷ luật']) {
      expect(within(tablist).getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
    // The mock returns total: 2 for every category, so the numeral rides the
    // selected tab only — the same one number the page printed before, now as
    // `Tabs`' plain count slot instead of a pill. It arrives with the query.
    await waitFor(() => expect(within(tablist).getByRole('tab', { name: /^Tất cả\s*2$/ })).toBeTruthy());

    fireEvent.click(within(tablist).getByRole('tab', { name: /^Chuyến đi$/ }));
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&category=trip'));
  });

  it('keeps the shared search cell wired to the query', async () => {
    renderAuditPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tìm trong nhật ký người dùng' }), { target: { value: 'An' } });
    await waitFor(() => expect(lastUrl()).toBe('/audit-logs?page=1&limit=10&search=An'));
  });
});

// SIL-851 round 4, defect A: the write side records changes old→new and the
// query side returns them, but the page never rendered the diff — the QA
// repro opened 'Chi tiết hoạt động' and saw only actor/action/description/
// time. Both surfaces (list-row expansion and the modal) must show the
// changed field with its old → new values; rows the API redacted (finance
// payload stripped) render no diff block at all.
describe('AuditLogPage field-level old→new diff (SIL-851 r4)', () => {
  const diffEntry = {
    ...entry(3, 'Tiệp'),
    action: 'SHIPMENT_UPDATED',
    category: 'trip',
    message: 'Chứng từ Vũ Văn Tiệp đã cập nhật thông tin lô hàng SHP-2611-00312',
    payload: { changes: [{ field: 'blNumber', before: 'R3P-677-R', after: 'R3P-677-R-QA3' }] },
  };

  beforeEach(() => {
    // jsdom has no <dialog> runtime: the page drives showModal()/close().
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
    }
    apiGetMock.mockReset().mockResolvedValue({ items: [diffEntry, entry(1, 'An')], total: 2 });
  });

  it('renders blNumber old→new on the row and inside the detail modal', async () => {
    renderAuditPage();
    const rowDiff = await screen.findByTestId('audit-row-changes-3');
    expect(within(rowDiff).getByText('blNumber')).toBeTruthy();
    expect(within(rowDiff).getByText('R3P-677-R')).toBeTruthy();
    expect(within(rowDiff).getByText('R3P-677-R-QA3')).toBeTruthy();

    fireEvent.click(screen.getByRole('row', { name: /Xem chi tiết hoạt động của Tiệp/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hoạt động' });
    const modalDiff = within(dialog).getByTestId('audit-detail-changes-3');
    expect(within(modalDiff).getByText('Dữ liệu thay đổi')).toBeTruthy();
    expect(within(modalDiff).getByText('blNumber')).toBeTruthy();
    expect(within(modalDiff).getByText('R3P-677-R')).toBeTruthy();
    expect(within(modalDiff).getByText('R3P-677-R-QA3')).toBeTruthy();
  });

  it('renders no diff block for rows the API redacted (finance strip)', async () => {
    renderAuditPage();
    await screen.findByTestId('audit-row-changes-3');
    expect(screen.queryByTestId('audit-row-changes-1')).toBeNull();

    fireEvent.click(screen.getByRole('row', { name: /Xem chi tiết hoạt động của An/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hoạt động' });
    expect(within(dialog).queryByTestId('audit-detail-changes-1')).toBeNull();
    expect(within(dialog).queryByText('Dữ liệu thay đổi')).toBeNull();
  });
});

// SIL-1012 — the deposit-amount edit row stores the old→new FLAT
// (payload.before/after, NO changes array) and its bill code lives only on
// the tracker (the API surfaces it as entry.billNumber). The detail drawer
// owed both: QA opened 'Chi tiết hoạt động' on the sửa-tiền-cược rows and saw
// neither the số cũ → số mới nor any FES… code to search by.
describe('AuditLogPage deposit-edit flat old→new + bill code (SIL-1012)', () => {
  const depositEntry = {
    ...entry(4, 'hoapt'),
    action: '',
    category: 'finance',
    message: 'DEPOSIT_TRACKER_UPDATED',
    payload: { before: '4000000', after: '4500000' },
    billNumber: 'FES26090766BSAV',
  };

  beforeEach(() => {
    // jsdom has no <dialog> runtime: the page drives showModal()/close().
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
    }
    apiGetMock.mockReset().mockResolvedValue({ items: [depositEntry], total: 1 });
  });

  it('renders the flat payload before→after as an old→new diff (no changes array)', async () => {
    renderAuditPage();
    fireEvent.click(await screen.findByRole('row', { name: /Xem chi tiết hoạt động của hoapt/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hoạt động' });
    const diff = within(dialog).getByTestId('audit-detail-changes-4');
    expect(within(diff).getByText('Số tiền cược')).toBeTruthy();
    expect(within(diff).getByText('4000000')).toBeTruthy();
    expect(within(diff).getByText('4500000')).toBeTruthy();
  });

  it('shows the tracker bill code in the drawer and the flat diff on the row', async () => {
    renderAuditPage();
    fireEvent.click(await screen.findByRole('row', { name: /Xem chi tiết hoạt động của hoapt/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết hoạt động' });
    expect(within(dialog).getByTestId('audit-detail-bill').textContent).toBe('FES26090766BSAV');
    // The list surface feeds from the same normalized changes.
    const rowDiff = screen.getByTestId('audit-row-changes-4');
    expect(within(rowDiff).getByText('4500000')).toBeTruthy();
  });
});
