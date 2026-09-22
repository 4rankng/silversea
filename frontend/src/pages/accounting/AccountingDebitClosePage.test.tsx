import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const { listBoard, sendRequests, confirmReq, withdrawReq } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  sendRequests: vi.fn(),
  confirmReq: vi.fn(),
  withdrawReq: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: sendRequests,
  confirmRateAdjustments: confirmReq,
  withdrawRateAdjustments: withdrawReq,
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
