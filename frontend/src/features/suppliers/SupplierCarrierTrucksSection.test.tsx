import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../../lib/api/client', () => ({ api }));

const paginate = vi.hoisted(() => ({
  fetchAllPaginated: vi.fn(),
}));
vi.mock('../../lib/http/paginate', () => paginate);

import { SupplierCarrierTrucksSection } from './SupplierCarrierTrucksSection';

const trucksFixture = [
  { id: 1, licensePlate: '29H-123.45', status: 'ACTIVE', carrierId: 7, updatedAt: '2026-09-26T00:00:00Z' },
  { id: 2, licensePlate: '30F-555.56', status: 'MAINTENANCE', carrierId: 7, filtered: false },
];

function renderSection() {
  paginate.fetchAllPaginated.mockResolvedValue(trucksFixture);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierCarrierTrucksSection supplierName="Nhà xe A" carrierId={7} />
    </QueryClientProvider>,
  );
}

// Card 20260926_2 AC1/AC2: the section lists the carrier's trucks and its
// add/edit/delete flows bind every mutation to the linked carrier id.
describe('SupplierCarrierTrucksSection (card 20260926_2)', () => {
  it('lists trucks for the linked carrier with plate and status', async () => {
    renderSection();
    expect(await screen.findByText('29H-123.45')).toBeTruthy();
    expect(screen.getByText('30F-555.56')).toBeTruthy();
    expect(paginate.fetchAllPaginated).toHaveBeenCalledWith('/trucks', { carrierId: '7' });
  });

  it('add form posts a new truck bound to the carrier id', async () => {
    renderSection();
    await screen.findByText('29H-123.45');
    fireEvent.change(screen.getByLabelText('Biển số mới'), { target: { value: '34A-111.11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trucks', { licensePlate: '34A-111.11', carrierId: 7 }));
  });

  it('edit flow puts the new plate on the truck', async () => {
    renderSection();
    await screen.findByText('29H-123.45');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa biển số 29H-123.45' }));
    fireEvent.change(await screen.findByLabelText('Sửa biển số'), { target: { value: '29H-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe('/trucks/1');
  });

  it('delete removes the truck row', async () => {
    renderSection();
    await screen.findByText('29H-123.45');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa biển số 29H-123.45' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/trucks/1'));
  });
});

// Card 20260926_17: mutation failures must be visible. The section sets
// error state on every failed mutation but never rendered it, so the 409
// tombstone business message (card 20260926_14) never reached the operator.
describe('SupplierCarrierTrucksSection (card 20260926_17)', () => {
  it('renders a failed add mutation as visible error text with role=alert', async () => {
    renderSection();
    await screen.findByText('29H-123.45');
    api.post.mockRejectedValueOnce(new Error('Biển số 29H-123.45 đã tồn tại trong thùng rác (xe đã xóa). Vui lòng khôi phục xe hoặc chọn biển số khác.'));
    fireEvent.change(screen.getByLabelText('Biển số mới'), { target: { value: '29H-123.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('thùng rác');
  });

  it('renders a failed delete mutation as visible error text with role=alert', async () => {
    renderSection();
    await screen.findByText('29H-123.45');
    api.delete.mockRejectedValueOnce(new Error('Không thể xóa xe đang gán chuyến.'));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa biển số 29H-123.45' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Không thể xóa');
  });
});
