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
    // Owner 2026-10-17 (reverses card _202): the customer is the page's axis,
    // not a gate. With none picked the list is EVERY customer's, and the
    // picker's own wording says so — the "Chưa chọn khách hàng" face is gone.
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: null })));
    expect(screen.queryByText('Chưa chọn khách hàng')).toBeNull();
    // The picker rides the shared strip now (owner 2026-10-17); its own bar
    // and the "Đang xem…" caption hint are gone — the trigger's value IS the
    // wording, so nothing echoes it a second time.
    expect(container.querySelector('.shipment-debit-customer-bar')).toBeNull();
    expect(screen.queryByText(/Đang xem/)).toBeNull();
    const ribbon = container.querySelector('.shipment-debit-workspace .filter-bar.list-filter-bar') as HTMLElement;
    expect(within(ribbon).getByRole('button', { name: 'Tất cả khách hàng' })).toBeTruthy();
    // The export action is still a per-customer action, so it stays disabled —
    // aria-disabled with the reason reachable (sweep card 20261008_1).
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
    // Picking a customer narrows the scope to that numeric id — the picker is
    // the shared searchable combobox, first control of the strip.
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
    // The second lot's key rides its own row (identity chip + Số Bill).
    expect(screen.getAllByText('BL-2').length).toBeGreaterThan(0);
    // Each row names its OWN customer, so a mixed list stays readable.
    expect(screen.getAllByText('KH A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KH B').length).toBeGreaterThan(0);
  });

  // Owner copy fix (2026-10-16): the CHỨNG TỪ cell's link says only what it
  // is — "Chi tiết →". The row already sits under a lô-hàng screen, so the
  // long label just wrapped inside the narrow docs column.
  it('links the CHỨNG TỪ cell with the short "Chi tiết →" label', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1')).length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: 'Chi tiết →' });
    expect(link).toHaveAttribute('href', '/shipments/101');
    // The hover affordance still names the destination for anyone unsure.
    expect(link).toHaveAttribute('title', 'Xem chi tiết lô hàng');
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
    // Card 20260926_51: the lock filter rides the inline-label select.
    expect(screen.getByRole('button', { name: 'Khóa lô: Đã khóa' })).toBeTruthy();
  });

  it('renders the two-tier header with label-in-control ribbon (card 20260926_51)', () => {
    const { container } = renderPage();
    expect(container.querySelector('[data-component="shipment-debit-header"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Chi phí - Quyết toán' })).toBeTruthy();
    // Row 2 is the shared filter strip (card 20260927_153): the page no longer
    // declares a bar container, so the strip IS `.filter-bar.list-filter-bar`
    // and the shared sheet owns its layout.
    const ribbon = container.querySelector('.shipment-debit-workspace .filter-bar.list-filter-bar') as HTMLElement;
    expect(ribbon).not.toBeNull();
    // Label-in-control: no floating label rows remain.
    expect(screen.queryByText('Từ ngày giao')).toBeNull();
    expect(screen.queryByText('Đến ngày giao')).toBeNull();
    expect(screen.queryByText('Trạng thái khóa lô')).toBeNull();
    // Owner 2026-10-17 (reverses card _202): Khách hàng is BACK in the strip —
    // the FIRST control of the lane, a bar child (bar children never fold),
    // ahead of the delivery range, the Khóa lô criterion and Xóa lọc. The
    // picker's own bar above the strip is gone.
    within(ribbon).getByRole('button', { name: 'Tất cả khách hàng' });
    within(ribbon).getByRole('group', { name: 'Khoảng ngày giao' });
    within(ribbon).getByRole('button', { name: 'Khóa lô: Tất cả' });
    within(ribbon).getByRole('button', { name: 'Xóa lọc' });
    expect(container.querySelector('.shipment-debit-customer-bar')).toBeNull();
    // The picker is the strip's FIRST bar child: the customer axis leads the
    // lane, and a revert that re-pins the picker after the range (or back onto
    // its own bar) cannot pass while the defect is back.
    const picker = container.querySelector('.shipment-debit-ribbon__customer') as HTMLElement;
    expect(picker).not.toBeNull();
    expect(picker.closest('.filter-bar')).toBe(ribbon);
    const rangeGroup = ribbon.querySelector('.shipment-debit-ribbon__range') as HTMLElement;
    expect(rangeGroup).not.toBeNull();
    expect(picker.compareDocumentPosition(rangeGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The reorder IS the fix: in the DOM the action row renders AFTER the
    // strip (the phone band's reading order — the actions sit directly above
    // the rows they act on); desktop only re-pins the title row visually via
    // grid order. Pin the DOM order so a revert of the block order cannot
    // pass while the defect is back.
    const headerNode = container.querySelector('[data-component="shipment-debit-header"]') as HTMLElement;
    expect(ribbon.compareDocumentPosition(headerNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Row 1: Xuất Debit Note rides the title baseline, disabled without a
    // customer, with the DisabledActionTip bubble naming the prerequisite
    // (sweep card 20261008_1 — the reason is reachable on hover AND focus).
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
    // Nothing selected yet → the primary action is disabled (aria-disabled,
    // sweep card 20261008_1)…
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // …and the disabled brand-strip rule is live on the workspace section that
    // wraps the shared bar (CSS-source pin — house convention; jsdom has no
    // layout engine, so computed fills are measured in the browser wave).
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const rule = css.match(/\.shipment-debit-workspace button\.shipment-debit-export\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).toMatch(/box-shadow:\s*none;/);
    expect(rule).not.toMatch(/brand|accent/);
    // The merge action shares the exact de-brand: two inert buttons never
    // out-shout each other, and neither reads as live while nothing is picked.
    const mergeRule = css.match(/\.shipment-debit-workspace button\.shipment-debit-merge-rev\[aria-disabled="true"\],\s*\.shipment-debit-workspace button\.shipment-debit-export\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(mergeRule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(mergeRule).toMatch(/color:\s*var\(--fg-3\);/);
  });

  it('pins the phone action band: sr-only title, two-cell 40px row above the list', () => {
    // ≤640px the topbar owns the screen name, the header row is the bulk
    // actions' own line, and the DOM order (strip with the customer picker
    // first → actions → list) puts them directly above the rows they act on.
    // CSS-source pins per the house convention — jsdom has no layout engine;
    // the browser wave measures the computed result at 390.
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const phoneBand = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(phoneBand).toMatch(/\.shipment-debit-header__title \{[\s\S]*?position: absolute;/);
    expect(phoneBand).toMatch(/\.shipment-debit-header__export \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // Desktop re-pins the title row on top of the workspace grid.
    expect(css).toMatch(/\.shipment-debit-workspace > \.shipment-debit-header \{ order: -1; \}/);
  });

  it('renders money from the payload and shows Chưa xác định for unknown amounts', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ lockStatus: 'LOCKED' }),
        row({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', freightAuto: null, receivableTotal: null, profit: null, documentsSummary: null }),
      ],
      total: 2,
    });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByText('TỔNG PHẢI TRẢ')).toBeTruthy();
    // Numbers format exactly as the payload says — never a fabricated 0.
    expect(screen.getByText('4.500.000')).toBeTruthy();
    // Unknown money (freight/receivable/payable/profit on row 2, payable on
    // row 1) stays "Chưa xác định" — null never renders as 0.
    expect(screen.getAllByText('Chưa xác định').length).toBeGreaterThanOrEqual(5);
    // The locked row selects on click. FB-093 widened selection to OPEN rows
    // too (merging cước thu is a pre-lock action); the export button still
    // ignores open-only selections (see the dedicated export tests below).
    const lockedRow = screen.getAllByText('BL-1')[0].closest('tr')!;
    expect(lockedRow.getAttribute('data-locked')).toBe('');
    expect(lockedRow.getAttribute('data-selected')).toBeNull();
    fireEvent.click(lockedRow);
    expect(lockedRow.getAttribute('data-selected')).not.toBeNull();
  });

  it('renders TỔNG PHẢI TRẢ from the payableTotal wire field', async () => {
    listSummary.mockResolvedValue({ items: [row({ payableTotal: 7_500_000 })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByText('TỔNG PHẢI TRẢ')).toBeTruthy();
    expect(screen.getByText('7.500.000')).toBeTruthy();
  });

  it('enables Xuất Debit Note only while a locked lot is selected', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    // Sweep card 20261008_1: the disabled reason mounts the DisabledActionTip
    // wrapper, which remounts the button on every state flip — re-query.
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('clears the selection when filters change so stale locked picks cannot arm the export', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Khóa lô: Tất cả' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toHaveAttribute('aria-disabled', 'true'));
  });
});

describe('Chi phí - Quyết toán — L2 expansion (20260918_18)', () => {
  it('mounts the workspace under the expanded lot row and collapses on the second click', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết lô BL-1' }));
    expect(await screen.findByText('Cước vận tải')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đóng chi tiết lô BL-1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết lô BL-1' }));
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
    renderPage('/shipments-debit;customer=1'.replace(';', '?'));
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
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' });
    expect(button).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button);
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    // One POST, both locked ids, the stable per-selection key — the open lot never travels.
    // Card 191026160000 §2e: the key is now derived INSIDE the client (the
    // raw join blew the 100-char transport limit on real selections), so the
    // page passes the ids alone; the replay contract is pinned in
    // src/api/shipmentDebit.key.test.ts.
    expect(createBatch).toHaveBeenCalledWith([101, 102]);
    await waitFor(() => expect(exportFile).toHaveBeenCalledWith(101, 777));
  });

  it('replays the same key when the same selection exports again', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'BL-1', lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
    expect(createBatch.mock.calls[0][1]).toBe(createBatch.mock.calls[1][1]);
    // Same-selection replay is guaranteed by the client's internal
    // selection-hash key (shipmentDebit.key.test.ts pins it).
    expect(createBatch.mock.calls[1][0]).toEqual(createBatch.mock.calls[0][0]);
  });

  it('names the overlapping lots when the issue call rejects with a uniqueness 409', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'SHP-26-0001', lockStatus: 'LOCKED' })], total: 1 });
    createBatch.mockRejectedValue(new ApiError(409, { error: '...', overlappingLotCodes: ['101', '157'] }, 'conflict'));
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Các lô đã nằm trong Debit Note đã xuất: BL-1 +1')).toBeTruthy();
    // The selection survives the conflict so the user can adjust and retry.
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
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Các lô đã nằm trong Debit Note đã xuất: BL-1, BL-2 +3')).toBeTruthy();
  });

  it('keeps the generic failure toast when the error carries no lot codes', async () => {
    listSummary.mockResolvedValue({ items: [row({ shipmentId: 101, code: 'BL-1', lockStatus: 'LOCKED' })], total: 1 });
    createBatch.mockRejectedValue(new ApiError(409, { error: 'Trùng lô đã xuất' }, 'conflict'));
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    expect(await screen.findByText('Không xuất được Debit Note. Vui lòng thử lại.')).toBeTruthy();
  });

  it('F1 (card 20260924_2): renders the shadow line with count and sum in the filtered scope', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 2, excludedSum: '1150000' });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/2 chuyến chưa gán đầu việc vận chuyển — 1\.150\.000 ₫ chưa vào chốt/)).toBeTruthy();
    // Case 2026-10-17 skew defense: count without identities → the plain line,
    // never a toggle that opens onto nothing.
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
    // Collapsed = not rendered at all (no hidden DOM to drift).
    expect(screen.queryByText('TRP-SHADOW-1')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ẩn danh sách' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('TRP-SHADOW-1')).toBeTruthy();
    expect(screen.getByText(/BL-1 · KH A/)).toBeTruthy();
    // Scoped to the list: the status line itself also contains "100.000 ₫".
    const list = document.getElementById('shipment-debit-shadow-trips') as HTMLElement;
    expect(within(list).getByText(/100\.000 ₫/)).toBeTruthy();
    expect(within(list).getByText(/2026-10-15/)).toBeTruthy();

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
    // The status half keeps its needs-attention ink and claims no pointer.
    const line = ruleOf(/\.shipment-debit-shadow-line\s*\{([^}]*)\}/);
    expect(line).toMatch(/color:\s*var\(--danger/);
    expect(line).not.toMatch(/cursor:\s*pointer/);
  });
});

describe('L1 mobile-390 presentation (card 20260924_9)', () => {
  const cssSource = () => readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
  const rule = (re: RegExp) => cssSource().match(re)?.[1] ?? '';

  it('keeps the red shadow line out of the horizontal-scroll wrap', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 2, excludedSum: '1150000' });
    const { container } = renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/2 chuyến chưa gán đầu việc vận chuyển/)).toBeTruthy();
    const wrap = container.querySelector('.shipment-debit-table-wrap');
    const line = container.querySelector('.shipment-debit-shadow-line');
    expect(wrap).not.toBeNull();
    expect(line).not.toBeNull();
    // Inside the wrap the line is sized to the scroll box and rides away with
    // the table — it now lives beside the wrap and keeps its own rule.
    expect(wrap!.contains(line!)).toBe(false);
    const r = rule(/\.shipment-debit-shadow-line\s*\{([^}]*)\}/);
    expect(r).toMatch(/white-space:\s*normal/);
    expect(r).toMatch(/overflow-wrap:\s*break-word/);
    expect(r).toMatch(/padding:/);
    expect(r).toMatch(/color:\s*var\(--danger/);
    expect(r).toMatch(/font-weight:\s*600/);
  });

  it('cues the sideways scroll exactly where the table renders but cannot fit', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    const cue = screen.getByText('Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.');
    // card 191026100030: the cue must NOT ride `ledger-desktop` — that class
    // hides it with `display: none !important` at ≤640, exactly where the OLD
    // reveal lived, so the cue could never show (and ≤640 renders the phone
    // record cards anyway — there is no table to cue there).
    expect(cue.className).not.toMatch(/ledger-desktop/);
    // Hidden by default; revealed in the 641–1107 band where the L1 table
    // renders (window > 640) but cannot fit its 1108px floor.
    expect(rule(/\.shipment-debit-scroll-hint\s*\{([^}]*)\}/)).toMatch(/display:\s*none/);
    expect(cssSource()).toMatch(/@media \(min-width: 641px\) and \(max-width: 1107px\)\s*\{[^}]*\.shipment-debit-scroll-hint\s*\{[^}]*display:\s*block/);
  });

  it('card 191026100030: money cells wrap instead of spilling, inert rows claim no click, header actions hold the 40px ceiling', () => {
    const money = rule(/\.shipment-debit-row__money\s*\{([^}]*)\}/);
    // Fixed layout + nowrap let a ten-digit sum ride over the neighbour cell;
    // the value now wraps inside its own right-aligned cell instead.
    expect(money).not.toMatch(/white-space:\s*nowrap/);
    expect(money).toMatch(/overflow-wrap:\s*break-word/);
    expect(money).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // The row-click alias is interactive only when the row carries its
    // tooltip ([title] — the canManage marker); a read-only locked row is
    // inert and must not advertise a pointer.
    expect(rule(/\.shipment-debit-row\[data-locked\]\[title\]\s*\{([^}]*)\}/)).toMatch(/cursor:\s*pointer/);
    expect(rule(/\.shipment-debit-row\[data-locked\]\s*\{([^}]*)\}/)).not.toMatch(/cursor:/);
    // UUI size="sm" carries max-md:min-h-11 (44px); the header actions are
    // ordinary controls and hold the owner's ≤40px ceiling below 768px.
    expect(cssSource()).toMatch(/@media \(max-width: 768px\)\s*\{[^}]*\.shipment-debit-header \.shipment-debit-merge-rev[^}]*min-height:\s*var\(--control-h\)/);
  });

  it('wraps headers by whole word — never clipped mid-word', () => {
    const r = rule(/\.shipment-debit-table th\s*\{([^}]*)\}/);
    expect(r).toMatch(/white-space:\s*normal/);
    expect(r).toMatch(/word-break:\s*keep-all/);
    expect(r).toMatch(/overflow-wrap:\s*normal/);
  });

  it('holds a word-wrap floor under the identity column so the code chip never slivers', () => {
    // The identity cell is the table's only unmeasured column: at 390 the old
    // 900px floor left it ~60px and overflow-wrap:anywhere shredded
    // QA0915-138-EXC into a per-character column. Card 161026232359 widened
    // the lead column 56 → 76px for the row tick, so the honest sum of the
    // nine columns is now 884 measured + 224 identity = 1108.
    expect(rule(/\.shipment-debit-table\s*\{([^}]*)\}/)).toMatch(/min-width:\s*1108px/);
    const chip = rule(/\.shipment-debit-row__code\s*\{([^}]*)\}/);
    expect(chip).toMatch(/overflow-wrap:\s*break-word/);
    expect(chip).not.toMatch(/anywhere/);
    expect(rule(/\.shipment-debit-row__identity > \*\s*\{([^}]*)\}/)).not.toMatch(/anywhere/);
  });

  it('puts each docs label on its own line so the value reads whole', () => {
    expect(rule(/\.shipment-debit-row__docs small\s*\{([^}]*)\}/)).toMatch(/display:\s*block/);
    expect(rule(/\.shipment-debit-row__docs > span\s*\{([^}]*)\}/)).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('uses the shared40px control budget on the expand control', () => {
    const source = cssSource();
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-row__expand-button\s*\{[^}]*width:\s*var\(--control-max-h\)/);
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-row__expand-button\s*\{[^}]*height:\s*var\(--control-max-h\)/);
    // Card 161026232359: the lead column now funds the tick PLUS the shared
    // control — 16px tick + 6px gap + 40px coarse control + 2×6px insets = 74px,
    // deliberately rounded to 76px so the tick can never clip in a fixed layout.
    expect(rule(/\.shipment-debit-table th\.shipment-debit-col--lead\s*\{([^}]*)\}/)).toMatch(/width:\s*76px/);
    expect(rule(/\.shipment-debit-table td\.shipment-debit-row__lead\s*\{([^}]*)\}/)).toMatch(/padding-inline:\s*6px/);
    // The tick is a real design-system control: the pair rides a wrapper rule
    // (never a flex on the <td>) and the accent rides the brand token.
    expect(rule(/\.shipment-debit-row__lead-controls\s*\{([^}]*)\}/)).toMatch(/display:\s*inline-flex/);
    expect(rule(/\.shipment-debit-row__lead-controls\s*\{([^}]*)\}/)).toMatch(/gap:\s*6px/);
    const tick = rule(/\.shipment-debit-row__select\s*\{([^}]*)\}/);
    expect(tick).toMatch(/accent-color:\s*var\(--brand\)/);
    expect(tick).toMatch(/width:\s*16px/);
    expect(tick).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('marks a picked row with the house surface + ink bar, never a lone accent hex (card 161026232359)', () => {
    // The highlight used to be the app's ONLY blue selection hex
    // (rgba(37,99,235,.08) / #2563eb) — a second accent inside a row that now
    // carries the brand-green tick. Card 161026232359 aligned it with the
    // convention five sibling tables already share (ExpenseAccounting,
    // LedgerRecordList — this screen's own phone list — CustomersPage,
    // AccountingDebitClosePage, AccountingWorkspacePage). Pin BOTH new
    // declarations so the rule cannot silently drift back to a lone hex.
    const selected = rule(/\.shipment-debit-row\[data-selected\]\s*\{([^}]*)\}/);
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

it('QA-AUDIT-UI-39 phone selection is explicit, expansion preserves it, and filters reset the20-row page', async () => {
  phoneViewport();
  listSummary.mockResolvedValue({ items: Array.from({ length: 21 }, (_, i) => row({ shipmentId: 101 + i, billOrBookNumber: `BL-${i + 1}`, lockStatus: 'LOCKED' })), total: 21 });
  getDetail.mockResolvedValue({ shipmentId: 101, freightRows: [], chiHoRows: [], unattachedTrips: [], payables: { chiHoTotal: null }, thuKhachTotal: null });
  renderPage('/shipments-debit?customer=1');
  const record = await screen.findByRole('article', { name: 'BL-1' });
  expect(screen.getAllByRole('article')).toHaveLength(20);
  expect(screen.queryByRole('table')).toBeNull();
  const checkbox = within(record).getByRole('checkbox', { name: 'Chọn BL-1' });
  fireEvent.click(checkbox); expect(checkbox).toBeChecked();
  fireEvent.click(within(record).getByText('Chi tiết'));
  fireEvent.click(within(record).getByRole('button', { name: 'Mở chi tiết lô BL-1' }));
  expect((await screen.findByText('Cước vận tải')).closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
  expect(checkbox).toBeChecked();
  fireEvent.click(within(record).getByRole('button', { name: 'Đóng chi tiết lô BL-1' }));
  expect(checkbox).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByRole('article', { name: 'BL-21' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Khóa lô: Tất cả' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
  expect(await screen.findByRole('article', { name: 'BL-1' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Chọn BL-1' })).not.toBeChecked();
  expect(createBatch).not.toHaveBeenCalled();
});
