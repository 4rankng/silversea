/**
 * /shipments-debit — REBUILT contract (ticket 18/11 Task 2.3 + Task 1.2).
 * The page renders the ONE DebitMergeGrid (6 groups shared with
 * /accounting/ghep-bo-debit) and carries the team toggle, pagination,
 * Khóa lô / Chọn Debit actions. The old flat board (ribbon, merge bar,
 * Debit Note export, phone records) retired with it — the accountant board
 * (/accounting/chot-debit) keeps pinning those laws.
 *
 * Laws pinned here:
 *  - Task 1.2: the toggle's EXACT label 'Hiện thông tin lô hàng team',
 *    default OFF; OFF → own-only data call, ON → team=1 on BOTH calls and
 *    the NV phụ trách column appears;
 *  - Khóa lô rides ShipmentDebitWorkspace's canLock law (ADMIN|ACCOUNTANT|CUS)
 *    through the existing cost-lock channel;
 *  - Chọn Debit arms only when every picked lot's costs are complete (the
 *    ACTIVE cost-lock signal); CUS runs the same channel as accounting
 *    (ticket 2.3) alongside the office trio;
 *  - SIL-776 REV2: the surface carries NO giá vốn — no cost column exists
 *    on the grid, and the summary response still renders its revenue cells
 *    with the null-is-blank law;
 *  - the quick filters (Khách hàng / Tuyến đường) thread into the grid.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listMerge, listSummary, lockCost, unlockCost, createRound } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listMerge: vi.fn(),
  listSummary: vi.fn(),
  lockCost: vi.fn(),
  unlockCost: vi.fn(),
  createRound: vi.fn(),
}));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentDebit', () => ({
  listShipmentDebitSummary: listSummary,
  listDebitMergeBoard: listMerge,
  lockShipmentCost: lockCost,
  unlockShipmentCost: unlockCost,
  adjustShipmentCost: vi.fn(),
  listShipmentCostAdjustments: vi.fn().mockResolvedValue([]),
  listShipmentCostLockHistory: vi.fn().mockResolvedValue([]),
  getShipmentDebitDetail: vi.fn().mockResolvedValue({}),
  saveShipmentDebitEdits: vi.fn(),
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
}));
vi.mock('../api/shipmentClient', () => ({
  getShipmentDebitDetail: vi.fn().mockResolvedValue({}),
  lockShipmentCost: lockCost,
  unlockShipmentCost: unlockCost,
  adjustShipmentCost: vi.fn(),
  listShipmentCostAdjustments: vi.fn().mockResolvedValue([]),
  listShipmentCostLockHistory: vi.fn().mockResolvedValue([]),
  saveShipmentDebitEdits: vi.fn(),
}));
vi.mock('../api/accountingDebitClient', () => ({
  createSettlementRound: createRound,
}));
vi.mock('../api/dispatchPlanningClient', () => ({
  mergeLclRevGroup: vi.fn(),
  unmergeLclLot: vi.fn(),
  unmergeLclGroup: vi.fn(),
  updateLclTruck: vi.fn(),
  assignLclCostGroup: vi.fn(),
}));
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage, TEAM_TOGGLE_LABEL } from './ShipmentDebitPage';
import type { DebitMergeItem } from '../api/shipmentDebit';

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

const mergeRow = (over: Partial<DebitMergeItem> = {}): DebitMergeItem => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: 1,
  customerName: 'KH A',
  factoryName: 'NM A',
  routeName: 'Hải Phòng → Bắc Ninh',
  deliveryDate: '2026-11-18',
  billOrBookNumber: 'BL-1',
  creatorName: 'Lê Văn Tài',
  creatorCode: 'NV001',
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  localStorage.clear();
  getBootstrap.mockReset().mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
  lockCost.mockReset();
  unlockCost.mockReset();
  createRound.mockReset();
});

describe('Task 2.3 — /shipments-debit renders the Ghép bộ Debit grid', () => {
  it('renders the 6 group headers on the CUS surface', async () => {
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    for (const header of ['Container', 'Cước phải thu', 'PHÍ CHI HỘ (Có hóa đơn)', 'PHÍ KHÔNG HÓA ĐƠN', 'KIỂM SOÁT']) {
      expect(screen.getByText(header)).toBeTruthy();
    }
  });

  it('SIL-776 REV2: NO giá vốn column exists on the surface', async () => {
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    const headers = [...document.querySelectorAll('th')].map((th) => th.textContent ?? '');
    for (const banned of ['Giá vốn', 'Cước trả', 'Tổng chi', 'Lợi nhuận', 'Chi nội địa']) {
      expect(headers.some((header) => header.includes(banned))).toBe(false);
    }
  });

  it('threads the customer quick filter into the merge call', async () => {
    renderPage('/shipments-debit?customer=7');
    await screen.findByText('Thông tin Lô hàng');
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith({ customerId: 7, team: false }));
    expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7, team: false }));
  });
});

describe('Task 1.2 — Hiện thông tin lô hàng team', () => {
  it('the toggle renders its EXACT label and defaults OFF — own-only calls', async () => {
    renderPage();
    const toggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(false);
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith(expect.objectContaining({ team: false })));
    // NV phụ trách column hidden while OFF.
    await screen.findByText('Thông tin Lô hàng');
    expect(document.querySelector('th[data-col="creator"]')).toBeNull();
  });

  it('ON → team=1 rides BOTH data calls and the NV phụ trách column appears', async () => {
    listMerge.mockResolvedValue({ items: [mergeRow({ creatorName: 'Trần Thị B', creatorCode: 'NV002' })], total: 1 });
    renderPage();
    const toggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    fireEvent.click(toggle);
    const afterToggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    expect(afterToggle.checked).toBe(true);
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith(expect.objectContaining({ team: true })));
    expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ team: true }));
    await screen.findByText('Trần Thị B');
    expect(document.querySelector('th[data-col="creator"]')?.textContent).toBe('NV phụ trách');
  });
});

describe('Khóa lô — the canLock law over the grid selection', () => {
  it('locks the picked lots through the existing cost-lock channel', async () => {
    authRole.value = 'CUS';
    listMerge
      .mockResolvedValueOnce({
        items: [mergeRow({ shipmentId: 101, control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null } })],
        total: 1,
      })
      .mockResolvedValue({
        items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-24T00:00:00.000Z' } })],
        total: 1,
      });
    lockCost.mockResolvedValue({});
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Khóa lô' })[0]!);
    await waitFor(() => expect(lockCost).toHaveBeenCalledWith(101, expect.any(String)));
    // SIL-923 + 24/11 (mục 11) — the board refresh reads back LOCKED and the
    // selection STAYS; the toolbar slot shows the CUS viewer the read-only
    // Đã khóa face (no ticketing; the unlock trio would see [Mở khóa lô]).
    await waitFor(() => expect(document.querySelector<HTMLElement>('.debit-merge__action--locked-state')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Khóa lô' })).toBeNull();
  });

  it('the unlock trio gets [Mở khóa lô] on a locked pick — mandatory reason, direct unlock (ruling 24/11)', async () => {
    authRole.value = 'ACCOUNTANT';
    listMerge.mockResolvedValue({
      items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } })],
      total: 1,
    });
    unlockCost.mockResolvedValue({});
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mở khóa lô' })[0]!);

    // The reason prompt gates the POST: empty reason keeps confirm disabled.
    const dialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    const confirm = within(dialog).getByRole('button', { name: 'Mở khóa lô' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(unlockCost).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Lý do mở khóa (bắt buộc)'), { target: { value: 'Khóa nhầm lô' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(unlockCost).toHaveBeenCalledWith(101, { reason: 'Khóa nhầm lô' }, expect.any(String)));
    // The rejected ticketing flow is gone — no request button anywhere.
    expect(screen.queryByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeNull();
  });

  it('Chọn Debit arms for CUS on a locked pick — same channel as accounting (ticket 2.3)', async () => {
    listMerge.mockResolvedValue({
      items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    const choose = document.querySelector('button.debit-merge__action--primary') as HTMLButtonElement;
    expect(choose.getAttribute('aria-disabled')).not.toBe('true');
    expect(document.getElementById('debit-merge-choose-disabled-reason')).toBeNull();
    fireEvent.click(choose);
    expect(await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' })).toBeTruthy();
    expect(createRound).not.toHaveBeenCalled();
  });

  it('a refused chốt surfaces the server error INSIDE the still-open dialog — never silent (SIL-970)', async () => {
    listMerge.mockResolvedValue({
      items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } })],
      total: 1,
    });
    createRound.mockRejectedValue(new Error('Không có quyền truy cập'));
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    const choose = document.querySelector('button.debit-merge__action--primary') as HTMLButtonElement;
    fireEvent.click(choose);
    const dialog = await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '0%' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chốt đợt' }));

    await waitFor(() => expect(createRound).toHaveBeenCalledTimes(1));
    // The refusal (403 im lặng repro) must read verbatim INSIDE the popup
    // and the popup stays open — the operator sees the failed act.
    expect(await within(dialog).findByText('Không có quyền truy cập')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' })).toBeInTheDocument();
  });
});

describe('SIL-1238 — the per-lot settlement band (lớp tổng: thu / trả / chênh lệch)', () => {
  const summaryRow = (over: Record<string, unknown> = {}) => ({
    shipmentId: 101,
    code: 'SHP-26-0001',
    billOrBookNumber: 'BL-1',
    receivableTotal: null,
    payableTotal: null,
    ...over,
  });

  it('renders Tổng phải thu khách / Tổng phải trả / Chênh lệch per lot with the API money (accountant)', async () => {
    authRole.value = 'ACCOUNTANT';
    listMerge.mockResolvedValue({ items: [mergeRow({ shipmentId: 101 })], total: 1 });
    listSummary.mockResolvedValue({
      items: [summaryRow({ receivableTotal: '1200000', payableTotal: '900000' })],
      total: 1,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(within(band).getByText('Tổng phải thu khách')).toBeTruthy();
    expect(within(band).getByText('Tổng phải trả')).toBeTruthy();
    expect(within(band).getByText('Chênh lệch')).toBeTruthy();
    // The lot joins the grid's row by shipmentId — the band mirrors the grid's
    // label law (Số Bill/Booking).
    expect(within(band).getByText('BL-1')).toBeTruthy();
    expect(within(band).getByText('1.200.000')).toBeTruthy();
    expect(within(band).getByText('900.000')).toBeTruthy();
    // Chênh lệch is FE-derived: thu − trả, computed only from both sides.
    expect(within(band).getByText('300.000')).toBeTruthy();
    // QA 28/11 T13 — the band adopts the shared scroll-hint lane: the section
    // is the presentation-only host and the lane div is the ONE scroll
    // container, so the right-hand 'TỔNG PHẢI…' columns scroll into reach and
    // the 'Kéo ngang' affordance rides the cut edge.
    expect(band.classList.contains('scroll-hint')).toBe(true);
    expect(band.querySelector('.debit-settlement-band__lane.scroll-hint__lane')).toBeTruthy();
  });

  it('an unknown side renders BLANK (—), never a fabricated 0 — and Chênh lệch stays blank', async () => {
    authRole.value = 'ACCOUNTANT';
    listMerge.mockResolvedValue({ items: [mergeRow({ shipmentId: 101 })], total: 1 });
    listSummary.mockResolvedValue({
      items: [summaryRow({ receivableTotal: '1200000', payableTotal: null })],
      total: 1,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(within(band).getByText('1.200.000')).toBeTruthy();
    const moneyCells = [...band.querySelectorAll('td.debit-settlement-band__money')].map((td) => td.textContent);
    expect(moneyCells).toEqual(['1.200.000', '—', '—']);
  });

  it('CUS keeps giá vốn ẩn: the trả/lệch columns hide entirely, the thu side stays', async () => {
    authRole.value = 'CUS';
    listMerge.mockResolvedValue({ items: [mergeRow({ shipmentId: 101 })], total: 1 });
    listSummary.mockResolvedValue({
      items: [summaryRow({ receivableTotal: '1200000', payableTotal: null })],
      total: 1,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(within(band).getByText('Tổng phải thu khách')).toBeTruthy();
    expect(within(band).queryByText('Tổng phải trả')).toBeNull();
    expect(within(band).queryByText('Chênh lệch')).toBeNull();
    const moneyCells = [...band.querySelectorAll('td.debit-settlement-band__money')].map((td) => td.textContent);
    expect(moneyCells).toEqual(['1.200.000']);
  });

  // SIL-1254 (id 1531) — "dải tổng chỉ hiện dòng có số liệu": a band row is
  // DATA, not presence. The staging wall (628 '#N' rows, every side '—') was
  // one row per filtered lot regardless of money (absence is not data —
  // design-guidelines "A column with no value is not a column"). A kept row
  // still shows '—' for its undetermined visible side; 0 is a value (card
  // 20261002_293) and keeps the row.
  it('SIL-1254: a lot with no determined money renders no row (never an all-— wall)', async () => {
    authRole.value = 'ACCOUNTANT';
    listMerge.mockResolvedValue({ items: [mergeRow({ shipmentId: 101 }), mergeRow({ shipmentId: 102 })], total: 2 });
    listSummary.mockResolvedValue({
      items: [summaryRow({ shipmentId: 101, receivableTotal: '1200000', payableTotal: null })],
      total: 1,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(band.querySelectorAll('tbody tr')).toHaveLength(1);
    const moneyCells = [...band.querySelectorAll('td.debit-settlement-band__money')].map((td) => td.textContent);
    expect(moneyCells).toEqual(['1.200.000', '—', '—']);
  });

  it('SIL-1254: 0 keeps the row; a CUS row whose only number is giá vốn renders no row', async () => {
    authRole.value = 'CUS';
    listMerge.mockResolvedValue({ items: [mergeRow({ shipmentId: 101 }), mergeRow({ shipmentId: 102 })], total: 2 });
    listSummary.mockResolvedValue({
      items: [
        summaryRow({ shipmentId: 101, receivableTotal: 0, payableTotal: null }),
        summaryRow({ shipmentId: 102, receivableTotal: null, payableTotal: '900000' }),
      ],
      total: 2,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(band.querySelectorAll('tbody tr')).toHaveLength(1);
    const moneyCells = [...band.querySelectorAll('td.debit-settlement-band__money')].map((td) => td.textContent);
    expect(moneyCells).toEqual(['0']);
  });

  it('SIL-1254: hidden rows keep their grid ordinal — #N still maps to grid row N', async () => {
    authRole.value = 'CUS';
    // sortDebitMergeRowsDesc is date-desc, id-desc: the NEWER date keeps lot
    // 101 first in the shared filtered order, so the surviving lot 102 is
    // grid row 2 even though row 1 renders nothing.
    listMerge.mockResolvedValue({
      items: [mergeRow({ shipmentId: 101, deliveryDate: '2026-11-19' }), mergeRow({ shipmentId: 102, deliveryDate: '2026-11-18' })],
      total: 2,
    });
    listSummary.mockResolvedValue({
      items: [summaryRow({ shipmentId: 102, receivableTotal: '1200000', payableTotal: null })],
      total: 1,
    });
    renderPage();
    const band = await screen.findByRole('region', { name: 'Quyết toán — lớp tổng' });
    expect(within(band).getByText('#2')).toBeTruthy();
    expect(within(band).queryByText('#1')).toBeNull();
  });
});
