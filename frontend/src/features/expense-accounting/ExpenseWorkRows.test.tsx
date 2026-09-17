import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseWorkRow } from '@tingting/shared';
import { ExpenseWorkRows } from './ExpenseWorkRows';
const work: ExpenseWorkRow = {
  id: 'trip:7', tripId: 7, shipmentId: 3, shipmentCode: 'BL-3', scheduledAt: '2026-09-16T08:30:00+07:00', customerName: 'Nhà máy A',
  routeName: 'Hải Phòng – Bắc Ninh', containerNumber: 'ABCD1234567', containerType: '40HC', classification: 'Kẹp',
  liftLocation: 'Cảng TIL', dropLocation: 'Bãi GFT', carrierName: 'SilverSea', vehiclePlate: '15C-123.45', driverName: 'Nguyễn Văn A',
  operationalNotes: 'KIỂM HÓA\nGọi kho trước', driverNotes: 'Giao cổng số 2', receivable: 300000, payable: 500000, road: null, entries: [],
};
describe('work-based expense register', () => {
  it('shows work without recorded fees, complete dispatch identity and distinct notes', () => {
    const open = vi.fn();
    render(<MemoryRouter><ExpenseWorkRows rows={[work]} onOpen={open} /></MemoryRouter>);
    for (const text of ['Nhà máy A', 'Hải Phòng – Bắc Ninh', 'ABCD1234567', 'Nguyễn Văn A', '15C-123.45', 'SilverSea', 'Giao cổng số 2']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/KIỂM HÓA/)).toHaveTextContent('Gọi kho trước');
    expect(screen.getByRole('link', { name: 'BL-3' })).toHaveAttribute('href', '/shipments/3');
    fireEvent.click(screen.getByRole('button', { name: 'Chi hộ phải thu · BL-3 · ABCD1234567' }));
    expect(open).toHaveBeenCalledWith(work, 'receivable');
    fireEvent.click(screen.getByRole('button', { name: 'Tiền đường · BL-3 · ABCD1234567' }));
    expect(open).toHaveBeenLastCalledWith(work, 'road');
    expect(screen.getByRole('button', { name: 'Tiền đường · BL-3 · ABCD1234567' })).toHaveTextContent('Chưa xác định');
  });
});
