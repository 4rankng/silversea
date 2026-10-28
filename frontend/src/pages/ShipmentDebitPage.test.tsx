import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary, getDetail, createBatch, exportFile } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listSummary: vi.fn(), getDetail: vi.fn(), createBatch: vi.fn(), exportFile: vi.fn() }));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: getDetail,
  createDebitNoteBatch: createBatch,
  exportDebitNoteFile: exportFile,
}));

vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: createBatch,
  exportDebitNoteFile: exportFile,
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';
import { ApiError } from '../lib/api';

function renderPage(initialEntry = '/shipments-debit') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** SIL-538 (PRD 261023110000 §2) — the ticks ride the on-demand [Gộp hàng]
 *  mode again: a selection flow flips the mode on first (only when OFF — the
 *  ON face reads 'Thoát gộp hàng' per SIL-592), then clicks the row
 *  select-alias. `pressed: false` pins the OFF face so the floating bar's own
 *  [Gộp hàng] CTA can never match once a pick exists. */
function enableMergeMode() {
  const toggle = screen.queryByRole('button', { name: 'Gộp hàng', pressed: false });
  if (toggle) fireEvent.click(toggle);
}

function clickRow(labelText: string) {
  enableMergeMode();
  fireEvent.click(screen.getAllByText(labelText)[0].closest('tr')!);
}

/** Open the row's ⋯ kebab and pick an item — L2 expansion lives there now. */
function openRowMenu(labelText: string) {
  const row = screen.getAllByText(labelText)[0].closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: `Hành động lô ${labelText}` }));
}

const row = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  factoryName: 'NM A',
  factoryAddress: 'Bình Dương',
  billOrBookNumber: 'BL-1',
  customsNumber: 'TK-1',
  documentsSummary: '5/6',
  freightAuto: 4_500_000,
  chiHoTotal: 2_000_000,
  receivableTotal: 9_000_000,
  payableTotal: null,
  profit: 2_500_000,
  lockStatus: 'OPEN',
  lockedAt: null,
  // SIL-549: the real wire always carries the cargo mode (the summary service
  // computes it) — the tickable default here is an LCL lot, same as production.
  cargoMode: 'LCL',
  ...over,
  // After the spread, so an explicit `customerId: null` (a lot with no
  // customer) survives instead of collapsing back to the default.
  customerId: over.customerId ?? 1,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
  getDetail.mockReset();
  createBatch.mockReset();
  exportFile.mockReset();
  createBatch.mockResolvedValue({ id: 777 });
  exportFile.mockResolvedValue(new Blob(['x']));
});

describe('Chi phí - Quyết toán — L1 lot list (20260918_17)', () => {
  it('keeps manager summaries read-only even with a restored expanded lot', async () => {
    authRole.value = 'MANAGER';
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    sessionStorage.setItem('shipment-debit.expanded-lot', '101');
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByText(/Chế độ chỉ xem tổng hợp/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mở chi tiết|Đóng chi tiết/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xuất Debit Note' })).toBeNull();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    expect(getDetail).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
    sessionStorage.removeItem('shipment-debit.expanded-lot');
  });

  it('loads every customer when none is picked — the screen never opens empty', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: null })));
    expect(screen.queryByText('Chưa chọn khách hàng')).toBeNull();
    expect(container.querySelector('.shipment-debit-customer-bar')).toBeNull();
    expect(screen.queryByText(/Đang xem/)).toBeNull();
    const ribbon = container.querySelector('.shipment-debit-workspace .filter-bar.list-filter-bar') as HTMLElement;
    expect(within(ribbon).getByRole('button', { name: 'Tất cả khách hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(ribbon).getByRole('button', { name: 'Tất cả khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1 })));
    expect(within(ribbon).getByRole('button', { name: 'KH A' })).toBeTruthy();
  });

  it('renders every customer the summary returns when no customer is picked', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ customerId: 1, customerName: 'KH A', billOrBookNumber: 'BL-1', code: 'SHP-1' }),
        row({ customerId: 2, customerName: 'KH B', billOrBookNumber: 'BL-2', code: 'SHP-2' }),
      ],
      total: 2,
    });
    renderPage();
    expect((await screen.findAllByText('BL-1')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('BL-2').length).toBeGreaterThan(0);
    // Redesign 23/10 (b): each customer's name rides ONE group header in
    // Title Case — never repeated per row, never ALL-CAPS.
    expect(screen.getByText('Kh A')).toBeTruthy();
    expect(screen.getByText('Kh B')).toBeTruthy();
    expect(screen.queryByText('KH A')).toBeNull();
    expect(screen.queryByText('KH B')).toBeNull();
  });

  it('keeps customer, delivery-date range and lock status in the URL', async () => {
    listSummary.mockResolvedValue({ items: [], total: 0 });
    renderPage('/shipments-debit?customer=1&from=2026-09-01&to=2026-09-30&lock=LOCKED');
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 1,
      deliveryDateFrom: '2026-09-01',
      deliveryDateTo: '2026-09-30',
      lockStatus: 'LOCKED',
    })));
    expect(screen.getByRole('button', { name: 'Khóa lô: Đã khóa' })).toBeTruthy();
  });

  it('renders the two-tier header with the unified picker ribbon (redesign 23/10)', () => {
    const { container } = renderPage();
    expect(container.querySelector('[data-component="shipment-debit-header"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Chi phí - Quyết toán' })).toBeTruthy();
    const ribbon = container.querySelector('.shipment-debit-workspace .filter-bar.list-filter-bar') as HTMLElement;
    expect(ribbon).not.toBeNull();
    // Owner redesign 23/10 (d): ONE date mechanism — the unified range picker
    // (trigger + popover), no separate Từ/Đến pair, no preset pills on the bar.
    within(ribbon).getByRole('button', { name: /Khoảng ngày quyết toán/ });
    expect(within(ribbon).queryByRole('group', { name: 'Khoảng ngày giao' })).toBeNull();
    expect(within(ribbon).queryByRole('group', { name: 'Khoảng ngày nhanh' })).toBeNull();
    within(ribbon).getByRole('button', { name: 'Khóa lô: Tất cả' });
    // Nothing applied → the clear action explains itself; with criteria the
    // label carries the count.
    within(ribbon).getByRole('button', { name: 'Xóa bộ lọc' });
    const headerNode = container.querySelector('[data-component="shipment-debit-header"]') as HTMLElement;
    expect(ribbon.compareDocumentPosition(headerNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const header = container.querySelector('[data-component="shipment-debit-header"]') as HTMLElement;
    const exportButton = within(header).getByRole('button', { name: 'Xuất Debit Note' });
    expect(exportButton).toHaveAttribute('aria-disabled', 'true');
    const exportReasonId = exportButton.getAttribute('aria-describedby');
    expect(exportReasonId).toBeTruthy();
    expect(document.getElementById(exportReasonId!)?.textContent).toBe('Chọn khách hàng để xuất Debit Note.');
  });

  it('keeps the disabled export CTA off its brand fill (card 20260922_31)', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const rule = css.match(/\.shipment-debit-workspace button\.shipment-debit-export\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).toMatch(/box-shadow:\s*none;/);
    const mergeRule = css.match(/\.shipment-debit-workspace button\.shipment-debit-merge-rev\[aria-disabled="true"\],\s*\.shipment-debit-workspace button\.shipment-debit-export\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(mergeRule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(mergeRule).toMatch(/color:\s*var\(--fg-3\);/);
  });

  it('pins the phone action band: sr-only title, two-cell 40px row above the list', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const phoneBand = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(phoneBand).toMatch(/\.shipment-debit-header__title \{[\s\S]*?position: absolute;/);
    expect(phoneBand).toMatch(/\.shipment-debit-header__export \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.shipment-debit-workspace > \.shipment-debit-header \{ order: -1; \}/);
  });

  it('renders the money states — numbers, a real 0, and a BLANK pending cell (redesign 23/10 (c) + 24/10)', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ lockStatus: 'LOCKED', carrierCostTotal: '1500000', opsCostTotal: '500000', payableTotal: 2000000 }),
        row({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', receivableTotal: 0, profit: null, carrierCostTotal: null, opsCostTotal: null }),
      ],
      total: 2,
    });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    // Numbers format exactly as the payload says — never a fabricated 0.
    // (Each value also rides its group subtotal and the totals foot, so the
    // row copy is ONE of several — assert presence, not uniqueness.)
    expect(screen.getAllByText('9.000.000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.500.000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500.000').length).toBeGreaterThan(0);
    // A real computed zero renders '0' with its own tooltip.
    const zero = screen.getByTitle('Phát sinh nhưng tổng bằng 0');
    expect(zero.textContent).toBe('0');
    // Unknown money reads as an EMPTY cell (owner 24/10): the amber pill
    // repeated ~5×/row and buried the figures. 'Chưa xác định' stays banned,
    // and only group/foot sums may answer '—'.
    const bl2Row = screen.getAllByText('BL-2')[0].closest('tr')!;
    expect(bl2Row.querySelector('td[data-col="profit"]')?.textContent ?? '').toBe('');
    expect(screen.queryByText('Chờ số liệu')).toBeNull();
    expect(screen.queryByText('Chưa xác định')).toBeNull();
    // The locked row selects on click (row = selection alias, redesign 23/10).
    const lockedRow = screen.getAllByText('BL-1')[0].closest('tr')!;
    expect(lockedRow.getAttribute('data-locked')).toBe('');
    expect(lockedRow.getAttribute('data-selected')).toBeNull();
    clickRow('BL-1');
    expect(lockedRow.getAttribute('data-selected')).not.toBeNull();
  });

  it('renders Tổng chi from the payableTotal wire field', async () => {
    listSummary.mockResolvedValue({ items: [row({ payableTotal: 7_500_000 })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Tổng chi/ })).toBeTruthy();
    expect(screen.getAllByText('7.500.000').length).toBeGreaterThan(0);
  });

  it('enables Xuất Debit Note only while a locked lot is selected', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
    clickRow('BL-1');
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).not.toHaveAttribute('aria-disabled');
    clickRow('BL-1');
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('clears the selection when filters change so stale locked picks cannot arm the export', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Khóa lô: Tất cả' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true'));
  });
});

describe('Chi phí - Quyết toán — L2 expansion (20260918_18; kebab since 23/10)', () => {
  it('mounts the workspace under the expanded lot row and collapses on the second open', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    getDetail.mockResolvedValue({
      shipmentId: 101,
      freightRows: [],
      chiHoRows: [],
      payables: { chiHoTotal: null },
      thuKhachTotal: null,
    });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.queryByText('Cước vận tải')).toBeNull();
    // Redesign 23/10: expansion lives in the ⋯ menu.
    openRowMenu('BL-1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mở chi tiết lô BL-1' }));
    expect(await screen.findByText('Cước vận tải')).toBeTruthy();
    openRowMenu('BL-1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đóng chi tiết lô BL-1' }));
    await waitFor(() => expect(screen.queryByText('Cước vận tải')).toBeNull());
  });
});

describe('L2 open-state reload persistence (card _11)', () => {
  it('restores the open workspace from sessionStorage on mount', async () => {
    sessionStorage.setItem('shipment-debit.expanded-lot', '101');
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    getDetail.mockResolvedValue({ shipmentId: 101, freightRows: [], chiHoRows: [], payables: { chiHoTotal: null }, thuKhachTotal: null });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('Cước vận tải')).toBeTruthy();
    sessionStorage.removeItem('shipment-debit.expanded-lot');
  });

  it('keeps nothing open when no lot id is stored', async () => {
    sessionStorage.removeItem('shipment-debit.expanded-lot');
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    await screen.findAllByText('BL-1');
    expect(screen.queryByText('Cước vận tải')).toBeNull();
  });
});

describe('Xuất Debit Note — batched issue (ruling: one POST per selection)', () => {
  it('issues one batched call with all selected locked ids and downloads the union document', async () => {
    listSummary.mockResolvedValue({
      items: [row({ shipmentId: 101, code: 'BL-1', lockStatus: 'LOCKED' }), row({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'BL-2', lockStatus: 'LOCKED' }), row({ shipmentId: 103, billOrBookNumber: 'BL-3', code: 'BL-3', lockStatus: 'OPEN' })],
      total: 3,
    });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    clickRow('BL-2');
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button);
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    expect(createBatch).toHaveBeenCalledWith([101, 102]);
    await waitFor(() => expect(exportFile).toHaveBeenCalledWith(101, 777));
  });

  it('replays the same key when the same selection exports again', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'BL-1', lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
    expect(createBatch.mock.calls[0][1]).toBe(createBatch.mock.calls[1][1]);
    expect(createBatch.mock.calls[1][0]).toEqual(createBatch.mock.calls[0][0]);
  });

  it('names the overlapping lots when the issue call rejects with a uniqueness 409', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'SHP-26-0001', lockStatus: 'LOCKED' })], total: 1 });
    createBatch.mockRejectedValue(new ApiError(409, { error: '...', overlappingLotCodes: ['101', '157'] }, 'conflict'));
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Các lô đã nằm trong Debit Note đã xuất: BL-1 +1')).toBeTruthy();
    expect(screen.getAllByText('BL-1')[0].closest('tr')!.getAttribute('data-selected')).not.toBeNull();
  });

  it('caps the conflict toast at three business keys plus a count', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ shipmentId: 101, lockStatus: 'LOCKED' }),
        row({ shipmentId: 102, billOrBookNumber: 'BL-2', lockStatus: 'LOCKED' }),
      ],
      total: 2,
    });
    createBatch.mockRejectedValue(new ApiError(409, { error: '...', overlappingLotCodes: ['101', '102', '201', '301', '401'] }, 'conflict'));
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    clickRow('BL-2');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Các lô đã nằm trong Debit Note đã xuất: BL-1, BL-2 +3')).toBeTruthy();
  });

  it('keeps the generic failure toast when the error carries no lot codes', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'BL-1', lockStatus: 'LOCKED' })], total: 1 });
    createBatch.mockRejectedValue(new ApiError(409, { error: 'Trùng lô đã xuất' }, 'conflict'));
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    clickRow('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Không xuất được Debit Note. Vui lòng thử lại.')).toBeTruthy();
  });

  it('F1 (card 20260924_2): renders the shadow line with count and sum in the filtered scope', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 2, excludedSum: '1150000' });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/2 chuyến chưa gán đầu việc vận chuyển — 1\.150\.000 ₫ chưa vào chốt/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Xem danh sách/ })).toBeNull();
  });

  it('F1 (card 20260924_2): keeps the shadow line hidden when nothing is excluded', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 0, excludedSum: '0' });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.queryByText(/chưa gán đầu việc vận chuyển/)).toBeNull();
  });

  it('case 2026-10-17: the line expands to the trips it names, for any role', async () => {
    listSummary.mockResolvedValue({
      items: [row()], total: 1, excludedCount: 1, excludedSum: '100000',
      excludedTrips: [{
        tripId: 501, tripCode: 'TRP-SHADOW-1', shipmentId: 101, lotLabel: 'BL-1',
        customerName: 'KH A', departureDate: '2026-10-15', feeSum: '100000',
      }],
    });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/1 chuyến chưa gán đầu việc vận chuyển — 100\.000 ₫ chưa vào chốt/)).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Xem danh sách (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('TRP-SHADOW-1')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ẩn danh sách' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('TRP-SHADOW-1')).toBeTruthy();
    const list = document.getElementById('shipment-debit-shadow-trips') as HTMLElement;
    expect(within(list).getByText(/100\.000 ₫/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn danh sách' }));
    expect(screen.queryByText('TRP-SHADOW-1')).toBeNull();
  });

  it('case 2026-10-17: the toggle is a house link action while the status text stays static red', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const ruleOf = (re: RegExp) => css.match(re)?.[1] ?? '';
    const toggle = ruleOf(/\.shipment-debit-shadow-line__toggle\s*\{([^}]*)\}/);
    expect(toggle).toMatch(/color:\s*var\(--color-primary/);
    expect(toggle).toMatch(/text-decoration:\s*underline/);
    expect(toggle).toMatch(/min-height:\s*var\(--control-h\)/);
    expect(toggle).toMatch(/background:\s*none/);
    const line = ruleOf(/\.shipment-debit-shadow-line\s*\{([^}]*)\}/);
    expect(line).toMatch(/color:\s*var\(--danger/);
    expect(line).not.toMatch(/cursor:\s*pointer/);
  });
});

describe('Redesign 23/10 — group theo khách + sticky totals + chứng từ + copy', () => {
  it('(b) groups rows under one sticky customer header with aligned subtotals and a collapse chevron', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ customerId: 1, customerName: 'CÔNG TY LONG MINH', billOrBookNumber: 'BL-1', receivableTotal: 1_000_000, payableTotal: 400_000, profit: 100_000 }),
        row({ shipmentId: 102, code: 'SHP-2', customerId: 1, customerName: 'CÔNG TY LONG MINH', billOrBookNumber: 'BL-2', receivableTotal: 2_000_000, payableTotal: 600_000, profit: 200_000 }),
        row({ shipmentId: 103, code: 'SHP-3', customerId: 2, customerName: 'KH B', billOrBookNumber: 'BL-3' }),
      ],
      total: 3,
    });
    const { container } = renderPage();
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    // One Title-Case group header per customer with the lot count.
    const header = screen.getByRole('button', { name: 'Đóng nhóm khách hàng Công Ty Long Minh' }).closest('tr')!;
    expect(within(header).getByText('Công Ty Long Minh')).toBeTruthy();
    expect(within(header).getByText('2 lô')).toBeTruthy();
    // The group's subtotal aligns under the Doanh thu column and sums the
    // KNOWN values only (BL-3's group has nothing known → '—').
    // KH B's group (row 103) has nothing known → its subtotals read '—'
    // with the pending tooltip; Long Minh's group sums its KNOWN values.
    const khbHeader = screen.getByRole('button', { name: /nhóm khách hàng Kh B/ }).closest('tr')!;
    expect(within(khbHeader).getAllByTitle('Chưa chốt — đang chờ số liệu đối soát').length).toBeGreaterThan(0);
    expect(within(header).getAllByText('3.000.000').length).toBeGreaterThan(0);
    expect(within(header).getAllByText('1.000.000').length).toBeGreaterThan(0);
    // Collapse hides the group's rows (and only that group's).
    fireEvent.click(within(header).getByRole('button', { name: 'Đóng nhóm khách hàng Công Ty Long Minh' }));
    expect(await screen.findByRole('button', { name: 'Mở nhóm khách hàng Công Ty Long Minh' })).toBeTruthy();
    expect(screen.queryByText('BL-1')).toBeNull();
    expect(screen.queryByText('BL-2')).toBeNull();
    expect(screen.getByText('BL-3')).toBeTruthy();
    // RECORDED LAW (review follow-up): the totals foot is the GRAND TOTAL of
    // the filtered list — collapsing a group is a view fold, never a scope
    // change — so 'Tổng cộng (N lô)' keeps counting every filtered lot.
    expect(within(container.querySelector('[data-testid="shipment-debit-totals"]')!).getByText('Tổng cộng (3 lô)')).toBeTruthy();
  });

  it('(a) the sticky totals foot equals the sum of the rendered money cells', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ receivableTotal: 1_111_111, payableTotal: 400_000, profit: 100_000, carrierCostTotal: '250000', opsCostTotal: '150000' }),
        row({ shipmentId: 102, code: 'SHP-2', billOrBookNumber: 'BL-2', receivableTotal: 2_222_222, payableTotal: 0, profit: -50_000, carrierCostTotal: '0', opsCostTotal: null }),
        row({ shipmentId: 103, code: 'SHP-3', billOrBookNumber: 'BL-3', receivableTotal: null, payableTotal: null, profit: null }),
      ],
      total: 3,
    });
    const { container } = renderPage();
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    const foot = container.querySelector('[data-testid="shipment-debit-totals"]') as HTMLElement;
    expect(foot).not.toBeNull();
    expect(within(foot).getByText('Tổng cộng (3 lô)')).toBeTruthy();
    const sumColumn = (col: string) => {
      // BODY ROW cells only — the group subtotals and the foot itself carry
      // the same data-col, so scope to the lot rows.
      const cells = [...container.querySelectorAll(`.shipment-debit-row td[data-col="${col}"]`)] as HTMLElement[];
      let sum = 0;
      for (const cell of cells) {
        const text = cell.textContent ?? '';
        if (text === '' || text === 'Chờ số liệu') continue;
        sum += Number(text.replace(/\./g, '').replace(/[^0-9-]/g, ''));
      }
      return sum;
    };
    // tfoot carries the same data-col cells — the assertion compares the
    // foot value with the sum of the BODY cells of the same column.
    const footValue = (col: string) => {
      const cell = foot.querySelector(`td[data-col="${col}"]`) as HTMLElement | null;
      expect(cell).not.toBeNull();
      return Number((cell!.textContent ?? '').replace(/\./g, ''));
    };
    expect(footValue('receivable')).toBe(sumColumn('receivable'));
    expect(footValue('payable')).toBe(sumColumn('payable'));
    expect(footValue('profit')).toBe(sumColumn('profit'));
    // A negative profit reads in the rose voice.
    expect(container.querySelector('td[data-col="profit"][data-negative]')?.textContent).toBe('-50.000');
  });

  it('(e) the CHỨNG TỪ badge warns on missing docs and the popover checklist names them', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ billOrBookNumber: 'BL-1', customsNumber: 'TK-1' }),
        row({ shipmentId: 102, code: 'SHP-2', billOrBookNumber: 'BL-2', customsNumber: null }),
      ],
      total: 2,
    });
    renderPage();
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    // Complete docs → the neutral count badge.
    expect(screen.getByRole('button', { name: /Chứng từ \(đủ 2\)/ })).toBeTruthy();
    // Missing tờ khai → the rose warning badge…
    expect(screen.getByRole('button', { name: /Chứng từ \(thiếu 1 \/ 2\)/ })).toBeTruthy();
    // …and clicking it opens the checklist naming what is missing.
    fireEvent.click(screen.getByRole('button', { name: /Chứng từ \(thiếu 1 \/ 2\)/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Chứng từ lô BL-2' });
    expect(within(dialog).getByText('Bill/Booking')).toBeTruthy();
    expect(within(dialog).getByText('BL-2')).toBeTruthy();
    expect(within(dialog).getByText('Chưa đính kèm')).toBeTruthy();
    // M1 review finding: the badge is informational — its click must never
    // leak into the row's select-alias and flip a pick.
    expect(screen.getAllByText('BL-2')[0].closest('tr')!.getAttribute('data-selected')).toBeNull();
  });

  it('(a) tờ khai copies to the OS clipboard on one click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    listSummary.mockResolvedValue({ items: [row()], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('TK-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy số tờ khai TK-1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('TK-1'));
    expect(await screen.findByText('Đã copy số tờ khai TK-1')).toBeTruthy();
  });
});

describe('L1 mobile-390 presentation (card 20260924_9 + redesign 23/10)', () => {
  const cssSource = () => readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
  const rule = (re: RegExp) => cssSource().match(re)?.[1] ?? '';

  it('keeps the red shadow line out of the scroll pane', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 2, excludedSum: '1150000' });
    const { container } = renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/2 chuyến chưa gán đầu việc vận chuyển/)).toBeTruthy();
    const pane = container.querySelector('.shipment-debit-pane');
    const line = container.querySelector('.shipment-debit-shadow-line');
    expect(pane).not.toBeNull();
    expect(line).not.toBeNull();
    expect(pane!.contains(line!)).toBe(false);
  });

  it('cues the sideways scroll exactly where the table renders but cannot fit', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    const cue = screen.getByText('Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.');
    expect(cue.className).not.toMatch(/ledger-desktop/);
    expect(rule(/\.shipment-debit-scroll-hint\s*\{([^}]*)\}/)).toMatch(/display:\s*none/);
    expect(cssSource()).toMatch(/@media \(min-width: 641px\) and \(max-width: 1347px\)\s*\{[^}]*\.shipment-debit-scroll-hint\s*\{[^}]*display:\s*block/);
  });

  it('redesign 23/10 (a): fixed 11-column board, nowrap headers, 52px rows, sticky bands', () => {
    // The honest sum of the eleven measured columns (44+130+160+144+130+130
    // +120+130+130+140+90 = 1348) floors the table; below that width the
    // pane scrolls sideways.
    expect(rule(/\.shipment-debit-table\s*\{([^}]*)\}/)).toMatch(/min-width:\s*1348px/);
    expect(rule(/\.shipment-debit-table\s*\{([^}]*)\}/)).toMatch(/table-layout:\s*fixed/);
    expect(rule(/\.shipment-debit-table\s*\{([^}]*)\}/)).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // Headers: one nowrap uppercase line; money headers match the data edge.
    const th = rule(/\.shipment-debit-table thead th\s*\{([^}]*)\}/);
    expect(th).toMatch(/white-space:\s*nowrap/);
    expect(th).toMatch(/position:\s*sticky/);
    expect(th).toMatch(/height:\s*40px/);
    expect(rule(/\.shipment-debit-table th\.shipment-debit-col--money\s*\{([^}]*)\}/)).toMatch(/text-align:\s*right/);
    // Rows: 52px, one baseline, no vertical cell borders.
    const td = rule(/\.shipment-debit-table td\s*\{([^}]*)\}/);
    expect(td).toMatch(/height:\s*52px/);
    expect(td).toMatch(/vertical-align:\s*middle/);
    // The pane is bounded on both axes — the sticky contract rests on the
    // max-height (the dispatch grids' 23/10 lesson).
    const pane = rule(/\.shipment-debit-pane\s*\{([^}]*)\}/);
    expect(pane).toMatch(/overflow:\s*auto/);
    expect(pane).toMatch(/max-height:/);
    // The group header pins under the 40px header; the totals foot pins to
    // the pane's bottom with the upward shadow.
    expect(rule(/\.shipment-debit-group td\s*\{([^}]*)\}/)).toMatch(/position:\s*sticky/);
    expect(rule(/\.shipment-debit-group td\s*\{([^}]*)\}/)).toMatch(/top:\s*40px/);
    const foot = rule(/\.shipment-debit-totals td\s*\{([^}]*)\}/);
    expect(foot).toMatch(/position:\s*sticky/);
    expect(foot).toMatch(/bottom:\s*0/);
    expect(foot).toMatch(/box-shadow:/);
    // Money cells: right-aligned tabular; the pending pill is a pill.
    expect(rule(/\.shipment-debit-money\s*\{([^}]*)\}/)).toMatch(/text-align:\s*right/);
  });

  it('marks a picked row with the house surface + ink bar, never a lone accent hex (card 161026232359)', () => {
    const selected = rule(/\.shipment-debit-row\[data-selected\] td\s*\{([^}]*)\}/);
    expect(selected).toMatch(/background:\s*var\(--surface\)/);
    expect(selected).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--ink\)/);
    expect(selected).not.toMatch(/#[0-9a-fA-F]{3,6}|rgba?\(/);
  });
});

const originalMedia = window.matchMedia;
function phoneViewport() {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('max-width: 640px'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

it('QA-AUDIT-UI-39 phone selection is explicit, row-tap expansion preserves it, and filters reset the20-row page', async () => {
  phoneViewport();
  listSummary.mockResolvedValue({ items: Array.from({ length: 21 }, (_, i) => row({ shipmentId: 101 + i, billOrBookNumber: `BL-${i + 1}`, lockStatus: 'LOCKED' })), total: 21 });
  getDetail.mockResolvedValue({ shipmentId: 101, freightRows: [], chiHoRows: [], unattachedTrips: [], payables: { chiHoTotal: null }, thuKhachTotal: null });
  renderPage('/shipments-debit?customer=1');
  const record = await screen.findByRole('article', { name: 'BL-1' });
  expect(screen.getAllByRole('article')).toHaveLength(20);
  expect(screen.queryByRole('table')).toBeNull();
  // Redesign 23/10 — the phone totals strip rides above the rows.
  expect(screen.getByTestId('shipment-debit-totals-mobile')).toBeTruthy();
  // SIL-538 — the tick rides the on-demand [Gộp hàng] mode: flip it on
  // (SIL-592's clean accessible name; pressed=false pins the OFF face).
  fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng', pressed: false }));
  const checkbox = within(record).getByRole('checkbox', { name: 'Chọn BL-1' });
  fireEvent.click(checkbox); expect(checkbox).toBeChecked();
  // SIL-478 (b) — the row tap is the expand control; no per-row button left.
  const toggle = within(record).getByRole('button', { name: 'Chi tiết BL-1' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect((await screen.findByText(/Cước vận tải/)).closest('.ledger-glist__fact')).toBeTruthy();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(checkbox).toBeChecked();
  fireEvent.click(within(record).getByRole('button', { name: 'Chi tiết BL-1' }));
  expect(within(record).getByRole('button', { name: 'Chi tiết BL-1' }).getAttribute('aria-expanded')).toBe('false');
  expect(checkbox).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByRole('article', { name: 'BL-21' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Khóa lô: Tất cả' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
  expect(await screen.findByRole('article', { name: 'BL-1' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Chọn BL-1' })).not.toBeChecked();
  expect(createBatch).not.toHaveBeenCalled();
});
