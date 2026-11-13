import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, sendRequests, confirmReq, withdrawReq, listRounds, createRound } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  sendRequests: vi.fn(),
  confirmReq: vi.fn(),
  withdrawReq: vi.fn(),
  listRounds: vi.fn(),
  createRound: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: sendRequests,
  confirmRateAdjustments: confirmReq,
  withdrawRateAdjustments: withdrawReq,
  listSettlementRounds: listRounds,
  createSettlementRound: createRound,
    setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const RATES = {
  cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000',
};
const CARRIER_RATES = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-09-25',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { ...RATES },
  tra: { ...CARRIER_RATES },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: '2026-09-24T00:00:00.000Z',
  ...over,
});

function boardWith(rows: AccountingDebitBoardRow[]) {
  listBoard.mockResolvedValue({ items: rows, total: rows.length });
}

const dataRows = (container: HTMLElement) => [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  // The column choice is per-workstation state (card 20260928_193): a choice
  // written by one test would silently re-shape the next one's board.
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
});

describe('AccountingDebitClosePage — heading and board identity', () => {
  it('QA-AUDIT-UI-65 gives pending reconciliation its complete action lane with the original request identity', async () => {
    window.matchMedia = (media): MediaQueryList => ({
      media, matches: media === '(max-width: 640px)', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
    boardWith([row({ adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } })]);
    renderPage();
    const record = await screen.findByRole('article', { name: 'BL-1' });
    const confirm = within(record).getByRole('button', { name: 'Xác nhận' });
    expect(confirm.closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
    expect(within(record).getByText('1.790.000 ₫').closest('.ledger-record__fact')).not.toHaveAttribute('data-layout');
    fireEvent.click(confirm);
    await waitFor(() => expect(confirmReq.mock.calls[0]?.[0]).toEqual([55]));
    expect(confirmReq).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(record).getByRole('button', { name: 'Rút' })).toBeEnabled());
    fireEvent.click(within(record).getByRole('button', { name: 'Rút' }));
    await waitFor(() => expect(withdrawReq.mock.calls[0]?.[0]).toEqual([55]));
    expect(withdrawReq).toHaveBeenCalledTimes(1);
    expect(sendRequests).not.toHaveBeenCalled(); expect(createRound).not.toHaveBeenCalled();
  });
  it('offers phone facts and independent selection without writing a cancelled debit', async () => {
    window.matchMedia = (media): MediaQueryList => ({
      media, matches: media === '(max-width: 640px)', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return true; },
    });
    boardWith([row()]);
    renderPage();
    const record = await screen.findByRole('article', { name: 'BL-1' });
    expect(within(record).getByText('KH A')).toBeVisible();
    expect(within(record).getByText('ABCZ1234567 · 40HC')).toBeVisible();
    const selection = within(record).getByRole('checkbox', { name: 'Chọn BL-1' });
    fireEvent.click(within(record).getByText('Chi tiết'));
    expect(selection).not.toBeChecked();
    fireEvent.click(selection);
    fireEvent.click(screen.getByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(createRound).not.toHaveBeenCalled();
    expect(sendRequests).not.toHaveBeenCalled();
    expect(confirmReq).not.toHaveBeenCalled();
    expect(within(record).getByRole('checkbox')).toBeChecked();
  });
  it('keeps Bill/Booking and customer separate and never falls back to internal shipment codes', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: null, customerName: 'KH B' })]);
    renderPage();
    const reference = await screen.findByText('BL-1');
    // SIL-772 — the code + customer live in the multi-line Lô cell's stack.
    const stack = reference.closest('.record-cell-stack');
    expect(stack).not.toBeNull();
    expect(stack?.querySelector('small')).toHaveTextContent('KH A');
    expect(screen.getByText('Chưa có số Bill/Booking')).toBeInTheDocument();
    expect(screen.queryByText('SHP-26-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('SHP-26-0002')).not.toBeInTheDocument();
  });

  it('names the screen, not the document (page-heading law)', async () => {
    boardWith([row()]);
    renderPage();
    // SIL-772 — tên màn hình là nhãn khách yêu cầu nguyên văn, viết hoa.
    expect(await screen.findByRole('heading', { level: 1, name: 'KIỂM SOÁT LÔ HÀNG' })).toBeInTheDocument();
    await screen.findByText('BL-1');
    // The document's name is the BOARD's, and the page never shouts — except
    // the customer-verbatim H1 (SIL-772 exemption in page-heading-law.test):
    // every OTHER heading still reads sentence case, no ALL-CAPS run.
    expect(screen.getByRole('heading', { level: 2, name: /Kế hoạch điều động tổng hợp/ })).toBeInTheDocument();
    for (const heading of screen.getAllByRole('heading')) {
      if (heading.tagName === 'H1') continue;
      expect(heading.textContent ?? '').not.toMatch(/[A-ZĐÂÊÔƠƯ]{2,}\s+[A-ZĐÂÊÔƠƯ]{2,}/);
    }
    const caption = document.querySelector('.debit-board caption');
    expect(caption?.className).toContain('sr-only');
  });

  it('renders the nine Rev2 group head with worked money and a dd/mm/yyyy date (SIL-772)', async () => {
    boardWith([row()]);
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'Cước phải thu' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cước phải trả' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tổng trả & Chi phí ngoài' })).toBeInTheDocument();
    // SIL-771 amends the SIL-727 matrix: Lợi nhuận (công thức khách chốt —
    // Tổng thu − Tổng trả − Chi phí ngoài) stays on the open board.
    expect(await screen.findByText('1.790.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('480.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('1.160.000 ₫')).toBeInTheDocument();
    // The board's axis is a business date, never the wire's ISO string.
    expect(screen.getByText('25/09/2026')).toBeInTheDocument();
  });

  it('names the missing field on a cell with no value (§1)', async () => {
    boardWith([row({
      thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null },
      loiNhuan: null,
    })]);
    renderPage();
    expect(await screen.findByText('Thiếu tổng thu')).toBeInTheDocument();
    // Lợi nhuận opens essential since SIL-771 — the §1 law reads directly on
    // the open board: the missing cell NAMES its field, never the generic
    // placeholder.
    expect(screen.getByText('Thiếu lợi nhuận')).toBeInTheDocument();
    // …and never the generic placeholder.
    expect(screen.queryByText('Chưa xác định')).not.toBeInTheDocument();
  });

  it('SIL-772 — the board opens on ALL NINE Rev2 groups; no picker, no stored choice can bury one', { timeout: 15000 }, async () => {
    // Rev2 Phần IV.2 (QA FAIL 1ae5afcb comment 5047): the old matrix hid
    // 'Phân xe' + 'Ghi chú' behind the picker's default (7/9 groups) and
    // scrolled sideways. The nine groups are now the board — every one
    // pinned, the visibility picker gone, and the old per-workstation
    // `accounting-debit-hidden-cols` payload simply stops being read.
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', thu: { ...RATES, cuocThu: null } })]);
    const { unmount } = renderPage();
    await screen.findByText('BL-1');
    for (const name of ['Lô', 'Hàng hóa & Cont', 'Phương tiện', 'Cước phải thu', 'Tổng thu', 'Cước phải trả', 'Tổng trả & Chi phí ngoài', 'Lợi nhuận', 'Ghi chú & Đối soát']) {
      expect(screen.getAllByRole('columnheader', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button', { name: /Cột hiển thị/ })).toBeNull();
    unmount();

    // A stale pre-772 payload cannot bury a group: the stored key is no
    // longer read (the pre-772 regression this replaces pinned repair-on-read
    // for the essential matrix; the nine-group board makes the whole class
    // unreachable by not consulting the choice at all).
    localStorage.setItem('accounting-debit-hidden-cols', JSON.stringify(['cuocThu', 'tongThu', 'loiNhuan', 'chiPhiNgoai', 'phanXe', 'ghiChu']));
    renderPage();
    await screen.findByText('BL-1');
    expect(screen.getAllByRole('columnheader', { name: 'Cước phải thu' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Phương tiện' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Ghi chú & Đối soát' }).length).toBeGreaterThan(0);
  });
});

describe('AccountingDebitClosePage — selection and bulk actions (card 20260929_207; SIL-727 restores the visible checkbox on this board)', () => {
  it('SIL-727 — the leading checkbox toggles the same one selection the row click drives', async () => {
    boardWith([row()]);
    const { container } = renderPage();
    await screen.findByText('BL-1');
    const first = dataRows(container)[0];
    const checkbox = within(first).getByRole('checkbox', { name: 'Chọn lô BL-1' });
    expect(checkbox.tagName).toBe('INPUT');
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    // Anchored: matches the confirm button in all its state labels
    // ('Xác nhận đối soát', 'Xác nhận đối soát (N)') but never the SIL-773
    // 'Lưu & Xác nhận đối soát' button, which also rode this board later.
    const xacNhanBtn = screen.getByRole('button', { name: /^Xác nhận đối soát/ });
    const chonDebitBtn = screen.getByRole('button', { name: /Chọn Debit/ });
    const xuatDebitBtn = screen.getByRole('button', { name: /Xuất Debit Note/ });
    expect(xacNhanBtn).toBeDisabled();
    expect(chonDebitBtn).toBeDisabled();
    expect(xuatDebitBtn).toBeDisabled();

    // One click, one toggle: the control stops propagation, so the row's own
    // click handler never double-toggles it.
    fireEvent.click(checkbox);
    expect(first.getAttribute('data-selected')).toBe('true');
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(checkbox).toBeChecked();
    expect(xacNhanBtn).not.toBeDisabled();
    expect(chonDebitBtn).not.toBeDisabled();
    expect(xuatDebitBtn).not.toBeDisabled();
    // The Ngày tick still names WHICH row is picked (§2c).
    expect(first.querySelector('.debit-row-tick')?.textContent).toBe('✓');
    fireEvent.click(checkbox);
    expect(first.getAttribute('data-selected')).toBeNull();
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    // …and the row click keeps working alongside the checkbox.
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBe('true');
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBeNull();
  });

  it('picks the focused row with the keyboard', async () => {
    boardWith([row()]);
    const { container } = renderPage();
    await screen.findByText('BL-1');
    const first = dataRows(container)[0];
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(first, { key: ' ' });
    expect(first.getAttribute('data-selected')).toBe('true');
  });

  it('a row waiting on reconciliation is inert — its controls decide instead', async () => {
    boardWith([row({ adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } })]);
    const { container } = renderPage();
    await screen.findByText('BL-1');
    const first = dataRows(container)[0];
    expect(first.getAttribute('tabindex')).toBeNull();
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBeNull();
    expect(within(first).getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
  });

  it('FB-099 — dòng PENDING ngồi ở vùng "Chờ xác nhận" riêng, không trộn vào bảng tổng hợp (TC-COSTUX-05)', async () => {
    boardWith([
      row(),
      row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
    ]);
    renderPage();
    const pendingRegion = await screen.findByRole('region', { name: 'Bảng chờ xác nhận điều chỉnh cước' });
    const boardRegion = screen.getByRole('region', { name: 'Bảng kế hoạch điều động tổng hợp' });
    expect(screen.getByRole('heading', { name: 'Chờ xác nhận' })).toBeInTheDocument();
    expect(within(pendingRegion).getByText('BL-2')).toBeInTheDocument();
    expect(within(pendingRegion).queryByText('BL-1')).toBeNull();
    expect(within(boardRegion).getByText('BL-1')).toBeInTheDocument();
    expect(within(boardRegion).queryByText('BL-2')).toBeNull();
    // điều khiển Xác nhận/Rút của dòng PENDING vẫn ở nguyên vị trí của nó
    expect(within(pendingRegion).getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
  });

  it('select-all covers the rows the filter is showing', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2' })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chọn tất cả 2 lô đủ điều kiện/ }));
    expect(await screen.findByText('Đã chọn 2 lô')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn Debit (2 dòng)' })).toBeInTheDocument();
  });

  it('sends the adjustment request for the picked rows and clears the selection', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2' })]);
    sendRequests.mockResolvedValue({ requested: [1], alreadyPending: [], locked: [] });
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Gửi yêu cầu điều chỉnh cước/ }));
    await waitFor(() => expect(sendRequests.mock.calls[0][0]).toEqual({ shipmentIds: [1] }));
    expect(await screen.findByText(/Yêu cầu điều chỉnh cước: đã gửi 1 lô/)).toBeInTheDocument();
  });

  it('confirms every pending row the filter is showing, in one pass', async () => {
    boardWith([
      row(),
      row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
    ]);
    confirmReq.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận đối soát (1)' }));
    await waitFor(() => expect(confirmReq.mock.calls[0][0]).toEqual([55]));
  });
});

describe('AccountingDebitClosePage — filters', () => {
  it('the search cell narrows the board by code, bill or customer', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', customerName: 'KH B' })]);
    renderPage();
    await screen.findByText('BL-1');
    fireEvent.change(screen.getByLabelText('Tìm lô hàng'), { target: { value: 'KH B' } });
    await waitFor(() => expect(screen.queryByText('BL-1')).not.toBeInTheDocument());
    expect(screen.getByText('BL-2')).toBeInTheDocument();
  });

  it('the customer facet narrows the board and drops the previous selection', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: /Chọn khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(screen.queryByText('BL-2')).not.toBeInTheDocument());
    expect(screen.queryByText(/Đã chọn/)).not.toBeInTheDocument();
  });

  it('the truck facet narrows by phân xe', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', billOrBooking: 'BL-2', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(screen.getByRole('button', { name: /Chọn nhà xe/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Nhà xe B' }));
    await waitFor(() => expect(screen.queryByText('BL-1')).not.toBeInTheDocument());
    expect(screen.getByText('BL-2')).toBeInTheDocument();
  });

  it('an empty page speaks with the shared empty state, not a bare table row', async () => {
    boardWith([]);
    const { container } = renderPage();
    expect(await screen.findByText('Không có lô hàng trong khoảng thời gian này')).toBeInTheDocument();
    expect(container.querySelector('.ds-empty-state')).toBeTruthy();
  });
});

describe('AccountingDebitClosePage — Chọn Debit popup + settlement rounds (card 20260923_12)', () => {
  it('opens the popup with the picked lots, and the direction tick reveals counterparty + amount', async () => {
    boardWith([row()]);
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Phải thu (từ khách hàng)')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    expect(within(dialog).getAllByText('KH A').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('1.790.000 ₫')).toBeInTheDocument();
  });

  it('VAT tick computes VAT amount and Tổng tiền, submit issues the round with the right body', async () => {
    boardWith([row()]);
    createRound.mockResolvedValue({
      id: 5, roundNo: 1, periodKey: '2026-09', direction: 'THU', vatRate: 8,
      totalAmount: 1933200, amount: '1790000',
    });
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '8%' }));
    expect(within(dialog).getByText('143.200 ₫')).toBeInTheDocument();
    expect(within(dialog).getByText('1.933.200 ₫')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chốt đợt' }));
    await waitFor(() => expect(createRound.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      shipmentIds: [1],
      dateFrom: '2026-09-25', dateTo: '2026-09-25',
      roundNo: 1, month: 9, year: 2026,
      direction: 'THU', vatRate: 8,
    })));
  });

  it('a failed chốt keeps the dialog open and surfaces the server error', async () => {
    boardWith([row()]);
    createRound.mockRejectedValue(new Error('Lô SHP-26-0001 đã thuộc một đợt chốt (Lần 1 · 2026/09).'));
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(screen.getByRole('radio', { name: '0%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chốt đợt' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/đã thuộc một đợt chốt/).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the persisted rounds in the settlement board, sentence case', async () => {
    boardWith([]);
    listRounds.mockResolvedValue({ items: [{
      id: 3, customerId: 11, customerName: 'KH A', direction: 'THU',
      carrierKey: 'OWN', carrierLabel: 'Xe công ty', periodKey: '2026-09',
      roundNo: 1, dateFrom: '2026-09-01', dateTo: '2026-09-30',
      amount: '1790000', vatRate: 8, vatAmount: 143200, totalAmount: 1933200,
      ghiChu: 'đợt tháng 9', lotCount: 1, createdAt: '2026-09-24T03:00:00.000Z',
    }] });
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Tổng hợp công nợ khách hàng' })).toBeInTheDocument();
    expect(await screen.findByText('Lần 1 · 2026/09')).toBeInTheDocument();
    expect(await screen.findByText('1.933.200 ₫')).toBeInTheDocument();
    expect(screen.getByText('đợt tháng 9')).toBeInTheDocument();
    expect(screen.getByText('01/09/2026')).toBeInTheDocument();
  });
});

// Card 20261002_285 AC3. RED-first: the badge summed the two facets' SELECTED
// VALUE counts, so three customers plus one truck read "4 đang áp dụng" while
// `Đặt lại` cleared both facets in one click — a number the operator could never
// reach by clearing. AC3 counts conditions; the sibling multi-select already did.
describe('debit-close facet badge counts criteria, not selected values (card 20261002_285)', () => {
  it('two customers in one facet badge as a single applied condition', async () => {
    // The badge lives on the `Bộ lọc` trigger, and the band only folds once it
    // MEASURES more than two rows (design-system/filter-bar-mode.ts). jsdom
    // reports a zero-width bar with zero-height children, so the strip stays
    // `inline` forever and the trigger never mounts. Give the bar a width and
    // stack its children vertically so the measurement sees a real overflow.
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const siblings = this.parentElement ? [...this.parentElement.children] : [];
      const i = Math.max(0, siblings.indexOf(this));
      const top = i * 40;
      return { top, bottom: top + 30, left: 0, right: 100, width: 100, height: 30, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);

    try {
      boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B' })]);
      renderPage();
      const trigger = await screen.findByRole('button', { name: /^Bộ lọc/ });
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'Bộ lọc chốt debit' });
      // The trigger's accessible name is "Chọn khách hàng…" while empty.
      fireEvent.click(within(dialog).getByRole('button', { name: /Chọn khách hàng/ }));

      fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
      fireEvent.click(screen.getByRole('option', { name: 'KH B' }));

      // One criterion applied (the customer facet), two values inside it.
      // Pre-fix this read "2" because the badge summed the selected values.
      expect(screen.getByRole('button', { name: 'Bộ lọc, 1 đang áp dụng' })).toBeInTheDocument();
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });
});

describe('BD-02 (161026204709) — merged 100%/0₫ Cước thu lane on the phone card face', () => {
  it('renders both rows Cước thu (tự động) outside the Chi tiết disclosure, member reason visible', async () => {
    window.matchMedia = (media): MediaQueryList => ({
      media, matches: media === '(max-width: 640px)', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
    boardWith([
      row({
        shipmentId: 1, billOrBooking: 'BL-P',
        lcl: { label: 'Lẻ · Thu: 5T', actualTruckNo: null, billingTruckNo: null, ghépCùngRef: null },
        thu: { cuocThu: '3150000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '3150000' },
      }),
      row({
        shipmentId: 2, billOrBooking: 'BL-M',
        lcl: { label: 'Lẻ · Thu: 5T', actualTruckNo: null, billingTruckNo: null, ghépCùngRef: 'BL-P' },
        thu: { cuocThu: '0', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '0' },
      }),
    ]);
    renderPage();
    // SIL-772 — mặc định FCL; cả hai dòng của test là hàng lẻ → chế độ LCL.
    fireEvent.click(screen.getByRole('button', { name: /Vận tải Hàng Lẻ \(LCL\)/ }));

    // Lô 1 = 100% lane price on the card face (the lane rides the collected
    // 'Cước phải thu' fact since SIL-772's nine-group rekey).
    const principal = await screen.findByRole('article', { name: 'BL-P' });
    const principalLane = within(principal).getByText('Cước phải thu').closest<HTMLElement>('.ledger-record__fact')!;
    expect(principalLane.closest('details')).toBeNull();
    expect(principalLane.textContent).toContain('3.150.000');

    // Member = 0₫ on the card face, its reason visible beside it.
    const member = await screen.findByRole('article', { name: 'BL-M' });
    const memberLane = within(member).getByText('Cước phải thu').closest<HTMLElement>('.ledger-record__fact')!;
    expect(memberLane.closest('details')).toBeNull();
    expect(memberLane.textContent).toContain('0 ₫');
    expect(within(member).getByText(/Ghép cùng Bill BL-P/).closest('details')).toBeNull();

    // The disclosure still holds the sibling facts — never the collected lane.
    const details = within(member).getByText('Chi tiết').closest('details')!;
    expect(within(details).queryByText('Cước phải thu')).toBeNull();
  });
});
