import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('requires the customer pick before any list fetch happens', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Chưa chọn khách hàng')).toBeTruthy();
    // Card 20260922_31: the empty face is the shared design-system EmptyState
    // (illustration included) — never a hand-rolled two-line block — and the
    // primary export action is disabled while nothing is selected.
    const emptyState = container.querySelector('.ds-empty-state');
    expect(emptyState).not.toBeNull();
    expect(emptyState?.querySelector('.ds-empty-state__title')?.textContent).toBe('Chưa chọn khách hàng');
    expect(emptyState?.querySelector<HTMLImageElement>('.ds-empty-state__illustration')?.src)
      .toContain('/assets/illustrations/empty-4.png');
    expect((screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement).disabled).toBe(true);
    expect(listSummary).not.toHaveBeenCalled();
    // Picking the customer fires the summary fetch with the numeric id.
    fireEvent.click(await screen.findByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1 })));
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
    // 3 options stay below the search threshold → the select renders a button trigger.
    expect(screen.getByRole('button', { name: /Trạng thái khóa lô/ })).toHaveTextContent('Đã khóa');
  });

  it('adopts the shared ListFilterBar contract (card 20260922_38)', () => {
    const { container } = renderPage();
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The hand-rolled bar is gone — no page-local filter chrome remains.
    expect(container.querySelector('.shipment-debit-filters, .shipment-debit-toolbar')).toBeNull();
    // Customer + delivery range + lock filter in row order, export action on
    // the right side of the same row (the bar's spacer is its hook).
    expect(bar.querySelector('.filter-bar__spacer')).not.toBeNull();
    within(bar).getByRole('combobox', { name: 'Khách hàng' });
    within(bar).getByText('Từ ngày giao');
    within(bar).getByText('Đến ngày giao');
    within(bar).getByRole('button', { name: /Trạng thái khóa lô/ });
    within(bar).getByRole('button', { name: 'Xuất Debit Note' });
  });

  it('keeps the disabled export CTA off its brand fill (card 20260922_31)', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    // Nothing selected yet → the primary action is disabled…
    expect(button.disabled).toBe(true);
    // …and the disabled brand-strip rule is live on the workspace section that
    // wraps the shared bar (CSS-source pin — house convention; jsdom has no
    // layout engine, so computed fills are measured in the browser wave).
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    const rule = css.match(/\.shipment-debit-workspace button\.shipment-debit-export:disabled\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--surface-2\);/);
    expect(rule).toMatch(/box-shadow:\s*none;/);
    expect(rule).not.toMatch(/brand|accent/);
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
    // The locked row selects on click; the open row ignores clicks.
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
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    expect(button.disabled).toBe(true);
  });

  it('clears the selection when filters change so stale locked picks cannot arm the export', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Trạng thái khóa lô/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement).disabled).toBe(true));
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
    expect(screen.queryByText('Bảng 2.1 — Cước vận tải')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết lô BL-1' }));
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đóng chi tiết lô BL-1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết lô BL-1' }));
    await waitFor(() => expect(screen.queryByText('Bảng 2.1 — Cước vận tải')).toBeNull());
  });
});

describe('L2 open-state reload persistence (card _11)', () => {
  it('restores the open workspace from sessionStorage on mount', async () => {
    sessionStorage.setItem('shipment-debit.expanded-lot', '101');
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    getDetail.mockResolvedValue({ shipmentId: 101, freightRows: [], chiHoRows: [], payables: { chiHoTotal: null }, thuKhachTotal: null });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    sessionStorage.removeItem('shipment-debit.expanded-lot');
  });

  it('keeps nothing open when no lot id is stored', async () => {
    sessionStorage.removeItem('shipment-debit.expanded-lot');
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit;customer=1'.replace(';', '?'));
    await screen.findAllByText('BL-1');
    expect(screen.queryByText('Bảng 2.1 — Cước vận tải')).toBeNull();
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
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    // One POST, both locked ids, the stable per-selection key — the open lot never travels.
    expect(createBatch).toHaveBeenCalledWith([101, 102], 'debit-note-101-102');
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
    expect(createBatch.mock.calls[1][1]).toBe('debit-note-101');
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
    expect(await screen.findByText(/2 chuyến chưa gán fulfillment — 1\.150\.000 ₫ chưa vào chốt/)).toBeTruthy();
  });

  it('F1 (card 20260924_2): keeps the shadow line hidden when nothing is excluded', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 0, excludedSum: '0' });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.queryByText(/chưa gán fulfillment/)).toBeNull();
  });
});

describe('L1 mobile-390 presentation (card 20260924_9)', () => {
  const cssSource = () => readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
  const rule = (re: RegExp) => cssSource().match(re)?.[1] ?? '';

  it('keeps the red shadow line out of the horizontal-scroll wrap', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1, excludedCount: 2, excludedSum: '1150000' });
    const { container } = renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText(/2 chuyến chưa gán fulfillment/)).toBeTruthy();
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

  it('cues the sideways scroll on phones only', async () => {
    listSummary.mockResolvedValue({ items: [row()], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect((await screen.findAllByText('BL-1'))[0]).toBeTruthy();
    expect(screen.getByText('Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.')).toBeTruthy();
    // Hidden at desktop widths; revealed inside the phone media block, which
    // is the LAST block of the sheet (the pin spans from @media to the rule).
    expect(rule(/\.shipment-debit-scroll-hint\s*\{([^}]*)\}/)).toMatch(/display:\s*none/);
    const source = cssSource();
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-scroll-hint\s*\{[^}]*display:\s*block/);
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
    // QA0915-138-EXC into a per-character column.
    expect(rule(/\.shipment-debit-table\s*\{([^}]*)\}/)).toMatch(/min-width:\s*1064px/);
    const chip = rule(/\.shipment-debit-row__code\s*\{([^}]*)\}/);
    expect(chip).toMatch(/overflow-wrap:\s*break-word/);
    expect(chip).not.toMatch(/anywhere/);
    expect(rule(/\.shipment-debit-row__identity > \*\s*\{([^}]*)\}/)).not.toMatch(/anywhere/);
  });

  it('puts each docs label on its own line so the value reads whole', () => {
    expect(rule(/\.shipment-debit-row__docs small\s*\{([^}]*)\}/)).toMatch(/display:\s*block/);
    expect(rule(/\.shipment-debit-row__docs > span\s*\{([^}]*)\}/)).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('meets the 44px touch floor on the expand control', () => {
    const source = cssSource();
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-row__expand-button\s*\{[^}]*width:\s*44px/);
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-row__expand-button\s*\{[^}]*height:\s*44px/);
    // The 56px lead row gives the 44px button its 6px cell padding on each side.
    expect(source).toMatch(/@media \(max-width: 640px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.shipment-debit-col--lead\s*\{[^}]*width:\s*56px/);
  });
});
