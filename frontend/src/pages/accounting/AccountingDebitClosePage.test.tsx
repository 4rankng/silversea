import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (over: any = {}): any => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-09-25',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30' + '000', tong1: '480000', phiRu: '150000' },
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

function boardWith(rows: any[]) {
  listBoard.mockResolvedValue({ items: rows, total: rows.length });
  listRounds.mockResolvedValue({ items: [] });
}

describe('AccountingDebitClosePage', () => {
  it('renders the full column ladder with grouped headers and worked numbers', async () => {
    boardWith([row()]);
    renderPage();
    expect(await screen.findByText('PHẢI THU')).toBeInTheDocument();
    expect(screen.getByText('PHẢI TRẢ')).toBeInTheDocument();
    expect(await screen.findByText('1.790.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('480.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('1.160.000 ₫')).toBeInTheDocument();
  });

  it('shows Chưa xác định for null money cells (never a fabricated 0)', async () => {
    boardWith([row({ thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null }, loiNhuan: null })]);
    renderPage();
    const cells = await screen.findAllByText('Chưa xác định');
    expect(cells.length).toBeGreaterThanOrEqual(5);
  });

  it('excel-style filter narrows rows by customer and clears via Xóa lọc', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.click(screen.getByText(/Lọc khách hàng/));
    fireEvent.click(screen.getByLabelText('KH A'));
    await waitFor(() => expect(screen.queryByText('SHP-26-0002')).not.toBeInTheDocument());
    expect(screen.getByText('SHP-26-0001')).toBeInTheDocument();
  });

  it('truck filter narrows by Phân xe values', async () => {
    boardWith([row(), row({ shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH B', phanXe: ['Nhà xe B'] })]);
    renderPage();
    await screen.findByText('SHP-26-0001');
    fireEvent.click(screen.getByText(/Lọc nhà xe/));
    fireEvent.click(screen.getByLabelText('Nhà xe B'));
    await waitFor(() => expect(screen.queryByText('SHP-26-0001')).not.toBeInTheDocument());
    expect(screen.getByText('SHP-26-0002')).toBeInTheDocument();
  });

  it('a CONFIRMED lot stays tickable for a new adjustment cycle (re-request)', async () => {
    boardWith([
      row({ shipmentId: 3, code: 'SHP-26-0003', adjustment: { status: 'CONFIRMED', requestId: 77, requestedAt: null, confirmedAt: '2026-09-22T03:00:00.000Z' } }),
    ]);
    renderPage();
    expect(await screen.findByLabelText('Chọn lô SHP-26-0003')).toBeInTheDocument();
  });

  it('tick rows + send adjustment request, then confirm clears pending state', async () => {
    boardWith([
      row(),
      row({ shipmentId: 2, code: 'SHP-26-0002', adjustment: { status: 'PENDING', requestId: 55, requestedAt: null, confirmedAt: null } }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByLabelText('Chọn lô SHP-26-0001'));
    fireEvent.click(screen.getByRole('button', { name: /Gửi yêu cầu điều chỉnh cước/ }));
    await waitFor(() => expect(sendRequests.mock.calls[0][0]).toEqual({ shipmentIds: [1] }));
    sendRequests.mockResolvedValue({ requested: [1], alreadyPending: [], locked: [] });
    listBoard.mockResolvedValue({
      items: [
        row(),
        row({ shipmentId: 2, code: 'SHP-26-0002', adjustment: { status: 'CONFIRMED', requestId: 55, requestedAt: null, confirmedAt: '2026-09-22T03:00:00.000Z' } }),
      ],
      total: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận đối soát \(1\)/ }));
    await waitFor(() => expect(confirmReq.mock.calls[0][0]).toEqual([55]));
    await waitFor(() => expect(screen.getByText('Đã đối soát')).toBeInTheDocument());
  });
});

describe('AccountingDebitClosePage — Chọn Debit popup + TỔNG HỢP (card 20260923_12)', () => {
  it('Chọn Debit opens the popup with the selection, direction tick reveals counterparty + amount', async () => {
    boardWith([row()]);
    renderPage();
    const checkbox = await screen.findByRole('checkbox', { name: 'Chọn lô SHP-26-0001' });
    fireEvent.click(checkbox);
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
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }));
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
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(screen.getByRole('radio', { name: '0%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chốt đợt' }));
    expect(await screen.findByText(/đã thuộc một đợt chốt/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('TỔNG HỢP CÔNG NỢ KHÁCH HÀNG table renders the persisted rounds', async () => {
    boardWith([]);
    listRounds.mockResolvedValue({ items: [{
      id: 3, customerId: 11, customerName: 'KH A', direction: 'THU',
      carrierKey: 'OWN', carrierLabel: 'Xe công ty', periodKey: '2026-09',
      roundNo: 1, dateFrom: '2026-09-01', dateTo: '2026-09-30',
      amount: '1790000', vatRate: 8, vatAmount: 143200, totalAmount: 1933200,
      ghiChu: 'đợt tháng 9', lotCount: 1, createdAt: '2026-09-24T03:00:00.000Z',
    }] });
    renderPage();
    expect(await screen.findByText('TỔNG HỢP CÔNG NỢ KHÁCH HÀNG')).toBeInTheDocument();
    expect(await screen.findByText('Lần 1 · 2026/09')).toBeInTheDocument();
    expect(await screen.findByText('1.933.200 ₫')).toBeInTheDocument();
    expect(screen.getByText('đợt tháng 9')).toBeInTheDocument();
  });
});
