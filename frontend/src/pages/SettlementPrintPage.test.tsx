import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettlementPrintPage from './SettlementPrintPage';
import type { LinkedExpense } from '../api/forwarderClient';

const { state, getBlob } = vi.hoisted(() => ({ state: { role: 'ACCOUNTANT', linkedExpenses: [] as LinkedExpense[], linkedRequests: [] as Array<{ id: number; amount: string; allocatedAmount?: string; reason: string; status: string; createdAt: string }> }, getBlob: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { getBlob } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 7, role: state.role } }) }));
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));
vi.mock('../hooks/useBackShortcut', () => ({ useBackShortcut: vi.fn() }));
vi.mock('../hooks/useForwarderQueries', () => {
  const detail = () => ({ data: {
    id: 11, version: 1, code: 'HU-11', status: 'RECORDED', forwarderId: 7,
    forwarderName: 'OPS Test', totalExpenseAmount: '0', refundAmount: '0',
    checkedBy: null, approvedBy: 7, note: null, createdAt: '2026-09-17T00:00:00.000Z',
    linkedRequests: state.linkedRequests, linkedExpenses: state.linkedExpenses,
  }, isLoading: false, error: null });
  return {
    useForwarderSettlementDetail: detail, useAdminSettlementDetail: detail,
    useUpdateAdvanceSettlement: () => ({}), useUpdateSettlementExpense: () => ({}),
    useReverseAdvanceSettlement: () => ({}),
  };
});

function page() {
  return render(<MemoryRouter initialEntries={['/settlements/11']}>
    <Routes><Route path="/settlements/:id" element={<SettlementPrintPage />} /></Routes>
  </MemoryRouter>);
}

describe('settlement read-only exports', () => {
  beforeEach(() => {
    getBlob.mockReset();
    state.role = 'ACCOUNTANT';
    state.linkedRequests = [];
    state.linkedExpenses = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }));
  });

  it('shows only the allocated slice of an advance on this settlement', () => {
    state.linkedRequests = [{
      id: 10, amount: '1000000', allocatedAmount: '1000', reason: 'Tạm ứng một triệu',
      status: 'RECORDED', createdAt: '2026-09-17T00:00:00.000Z',
    }];
    const { container } = page();
    expect(screen.getByRole('heading', { name: 'Tạm ứng đã sử dụng' })).toBeVisible();
    expect(container.querySelector('.settlement-detail__advance-amount')).toHaveTextContent('1.000');
    expect(container.querySelector('.settlement-detail__advance-amount')).not.toHaveTextContent('1.000.000');
    expect(screen.queryByText(/1\.000\.000/)).not.toBeInTheDocument();
  });

  it('keeps expense labels and complete values available when rows reflow on mobile', () => {
    state.linkedExpenses = [{
      id: 5, tripId: 10, expenseType: 'OTHER', buyAmount: '1000',
      departureDate: '2026-09-17', customerName: 'Khách hàng tên dài để kiểm tra hiển thị',
      containerNumber: 'CSQU3054383', invoiceNumber: 'INV-LONG-1234', note: null, tripCode: 'QA-TRIP-10',
    }];
    const { container } = page();
    const cells = container.querySelectorAll('.settlement-expense-grid__row [data-label]');
    expect([...cells].map(cell => cell.getAttribute('data-label')))
      .toEqual(['Ngày', 'Nội dung', 'Khách hàng', 'Số cont', 'Thành tiền', 'Hóa đơn']);
    expect(cells[2]).toHaveTextContent('Khách hàng tên dài để kiểm tra hiển thị');
    expect(cells[4]).toHaveTextContent('1.000');
    expect(cells[5]).toHaveTextContent('INV-LONG-1234');
  });

  it.each([
    ['ACCOUNTANT', '/advance-settlements/11/export?format=html'],
    ['OPS', '/forwarder/me/advance-settlements/11/export?format=html'],
  ])('opens %s print preview through the authorized GET export', async (role, path) => {
    state.role = role;
    getBlob.mockResolvedValue({ text: async () => '<html><body>HU-11</body></html>' });
    page();
    fireEvent.click(screen.getByRole('button', { name: 'In' }));
    await waitFor(() => expect(getBlob).toHaveBeenCalledExactlyOnceWith(path));
    expect(await screen.findByTitle('Phiếu thanh toán HU-11')).toHaveAttribute('srcdoc', '<html><body>HU-11</body></html>');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByTitle('Phiếu thanh toán HU-11')).not.toBeInTheDocument();
  });

  it.each([
    ['ACCOUNTANT', '/advance-settlements/11/export?format=xlsx'],
    ['OPS', '/forwarder/me/advance-settlements/11/export?format=xlsx'],
  ])('downloads %s XLSX through the correct role endpoint', async (role, path) => {
    state.role = role;
    getBlob.mockResolvedValue(new Blob(['xlsx']));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(getBlob).toHaveBeenCalledExactlyOnceWith(path));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
    anchorClick.mockRestore();
  });

  it('shows the actual export failure and lets the user retry without leaving the record', async () => {
    getBlob.mockRejectedValueOnce(new Error('Không thể tải chứng từ'))
      .mockResolvedValueOnce({ text: async () => '<html>Retry</html>' });
    page();
    fireEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải chứng từ');
    expect(screen.getByText('OPS Test')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(await screen.findByTitle('Phiếu thanh toán HU-11')).toHaveAttribute('srcdoc', '<html>Retry</html>');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
