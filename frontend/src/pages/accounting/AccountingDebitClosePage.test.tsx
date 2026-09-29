import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

function boardWith(rows: AccountingDebitBoardRow[]) {
  listBoard.mockResolvedValue({ items: rows, total: rows.length });
}

const dataRows = (container: HTMLElement) => [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];

beforeEach(() => {
  // The column choice is per-workstation state (card 20260928_193): a choice
  // written by one test would silently re-shape the next one's board.
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
});

describe('AccountingDebitClosePage — heading and board identity', () => {
  it('names the screen, not the document (page-heading law)', async () => {
    boardWith([row()]);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Kế toán chốt debit' })).toBeInTheDocument();
    await screen.findByText('SHP-26-0001');
    // The document's name is the BOARD's, and the page never shouts: no heading
    // or visible caption carries an ALL-CAPS run.
    expect(screen.getByRole('heading', { level: 2, name: /Kế hoạch điều động tổng hợp/ })).toBeInTheDocument();
    for (const heading of screen.getAllByRole('heading')) {
      expect(heading.textContent ?? '').not.toMatch(/[A-ZĐÂÊÔƠƯ]{2,}\s+[A-ZĐÂÊÔƠƯ]{2,}/);
    }
    const caption = document.querySelector('.debit-board caption');
    expect(caption?.className).toContain('sr-only');
  });

  it('renders the grouped head with worked money and a dd/mm/yyyy date', async () => {
    boardWith([row()]);
    renderPage();
    expect(await screen.findByText('Phải thu')).toBeInTheDocument();
    expect(screen.getByText('Phải trả')).toBeInTheDocument();
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
    expect(screen.getByText('Thiếu lợi nhuận')).toBeInTheDocument();
    // …and never the generic placeholder.
    expect(screen.queryByText('Chưa xác định')).not.toBeInTheDocument();
  });

  it('a breakdown column with no value anywhere stays out of the board, and returns with data', async () => {
    // Column-visibility law: absence is not data. With every cước-thu cell
    // missing, the column is not offered a track; the totals keep theirs.
    boardWith([row({ thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null } })]);
    const { unmount } = renderPage();
    await screen.findByText('SHP-26-0001');
    expect(screen.queryByText('Cước thu (tự động)')).not.toBeInTheDocument();
    expect(screen.getByText('Tổng thu')).toBeInTheDocument();
    unmount();
    // One row carrying a rate is enough for the column to exist again.
    boardWith([row({ thu: { ...RATES, cuocThu: null } }), row({ shipmentId: 2, code: 'SHP-26-0002' })]);
    renderPage();
    expect(await screen.findByText('Cước thu (tự động)')).toBeInTheDocument();
  });

  it('offers the column picker on the shared strip', async () => {
    boardWith([row()]);
    renderPage();
    await screen.findByText('SHP-26-0001');
    expect(screen.getByRole('button', { name: /Cột hiển thị/ })).toBeInTheDocument();
  });
});

describe('AccountingDebitClosePage — selection and bulk actions (card 20260929_207)', () => {
  it('has no checkbox column; a row is picked by clicking it', async () => {
    boardWith([row()]);
    const { container } = renderPage();
    await screen.findByText('SHP-26-0001');
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    const first = dataRows(container)[0];
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBe('true');
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBeNull();
  });

  it('picks the focused row with the keyboard', async () => {
    boardWith([row()]);
    const { container } = renderPage();
    await screen.findByText('SHP-26-0001');
    const first = dataRows(container)[0];
    expect(first.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(first, { key: ' ' });
    expect(first.getAttribute('data-selected')).toBe('true');
  });

  it('a row waiting on reconciliation is inert — its controls decide instead', async () => {
    boardWith([row({ adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } })]);
    const { container } = renderPage();
    await screen.findByText('SHP-26-0001');
    const first = dataRows(container)[0];
    expect(first.getAttribute('tabindex')).toBeNull();
    fireEvent.click(first);
    expect(first.getAttribute('data-selected')).toBeNull();
    expect(within(first).getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
  });

  it('select-all covers the rows the filter is showing', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002' })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chọn tất cả 2 lô đủ điều kiện/ }));
    expect(await screen.findByText('Đã chọn 2 lô')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn Debit (2 dòng)' })).toBeInTheDocument();
  });

  it('sends the adjustment request for the picked rows and clears the selection', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002' })]);
    sendRequests.mockResolvedValue({ requested: [1], alreadyPending: [], locked: [] });
    const { container } = renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Gửi yêu cầu điều chỉnh cước/ }));
    await waitFor(() => expect(sendRequests.mock.calls[0][0]).toEqual({ shipmentIds: [1] }));
    expect(await screen.findByText(/Yêu cầu điều chỉnh cước: đã gửi 1 lô/)).toBeInTheDocument();
  });

  it('confirms every pending row the filter is showing, in one pass', async () => {
    boardWith([
      row(),
      row({ shipmentId: 2, code: 'SHP-26-0002', adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
    ]);
    confirmReq.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận đối soát (1)' }));
    await waitFor(() => expect(confirmReq.mock.calls[0][0]).toEqual([55]));
  });
});

describe('AccountingDebitClosePage — filters', () => {
  it('the search cell narrows the board by code, bill or customer', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B' })]);
    renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.change(screen.getByLabelText('Tìm lô hàng'), { target: { value: 'KH B' } });
    await waitFor(() => expect(screen.queryByText('SHP-26-0001')).not.toBeInTheDocument());
    expect(screen.getByText('SHP-26-0002')).toBeInTheDocument();
  });

  it('the customer facet narrows the board and drops the previous selection', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    const { container } = renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.click(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: /Chọn khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(screen.queryByText('SHP-26-0002')).not.toBeInTheDocument());
    expect(screen.queryByText(/Đã chọn/)).not.toBeInTheDocument();
  });

  it('the truck facet narrows by phân xe', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.click(screen.getByRole('button', { name: /Chọn nhà xe/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Nhà xe B' }));
    await waitFor(() => expect(screen.queryByText('SHP-26-0001')).not.toBeInTheDocument());
    expect(screen.getByText('SHP-26-0002')).toBeInTheDocument();
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
    await screen.findByText('SHP-26-0001');
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
    await screen.findByText('SHP-26-0001');
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
    await screen.findByText('SHP-26-0001');
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
