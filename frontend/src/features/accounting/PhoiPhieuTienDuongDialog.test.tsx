import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), confirm: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: api.get, confirmPhoiPhieuTienDuong: api.confirm }));
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';
const row = { sourceId: 7, version: 4, costType: 'OTHER', feeName: 'Phụ cấp cấu hình', driverEnteredAmount: 73000, amount: 75000, confirmed: false, driverName: 'Lái xe kiểm thử', occurredAt: '2026-09-22' };
const detail = { tripId: 8, tripCode: 'TRP-TEST', rows: [row], totals: { total: 75000, confirmed: 0 } };
const saved = vi.fn();
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PhoiPhieuTienDuongDialog tripId={8} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>); }
describe('driver cost confirmation uses current source version', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(detail); api.confirm.mockResolvedValue({}); });
  it('submits the current source version and refreshes after confirmation', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Tích duyệt' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.confirm).toHaveBeenCalledWith(8, 7, 4);
  });
  it('keeps rejection visible and reloads the current version before retry', async () => {
    api.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, rows: [{ ...row, version: 5 }] });
    api.confirm.mockRejectedValueOnce(new Error('Khoản chi đã thay đổi. Vui lòng tải lại.'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Tích duyệt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi'); expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' })); await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tích duyệt' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.confirm.mock.calls[1]).toEqual([8, 7, 5]);
  });
  it('shows the current amount and configured label alongside the original value', async () => {
    mount(); await screen.findByText('Phụ cấp cấu hình');
    expect(screen.getByText('73.000 ₫')).toBeInTheDocument();
    expect(screen.getAllByText('75.000 ₫')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'Thực chi hiện tại (đ)' })).toBeInTheDocument();
  });
  it('does not duplicate a pending confirmation', async () => {
    api.confirm.mockReturnValue(new Promise(() => {})); mount(); const button = await screen.findByRole('button', { name: 'Tích duyệt' });
    fireEvent.click(button); fireEvent.click(button); expect(api.confirm).toHaveBeenCalledOnce(); expect(button).toBeDisabled();
  });
});
