import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), correct: vi.fn(), remove: vi.fn(), create: vi.fn(), meta: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuChiHo: api.detail, updatePhoiPhieuRowAmounts: api.update, correctPhoiPhieuRow: api.correct, voidPhoiPhieuRow: api.remove, createPhoiPhieuRow: api.create, updatePhoiPhieuMeta: api.meta }));
import { PhoiPhieuChiHoDialog } from './PhoiPhieuChiHoDialog';
const rows = [
  { entryId: 23, sourceId: 5, version: 3, feeName: 'First fee', amountThu: 60000, amountTra: 50000, confirmed: false },
  { entryId: 5, sourceId: 9, version: 2, feeName: 'Confirmed fee', amountThu: 80000, amountTra: 80000, confirmed: true },
];
beforeEach(() => { vi.resetAllMocks(); api.detail.mockResolvedValue({ tripId: 7, tripCode: 'QA-TRIP', rows }); api.update.mockResolvedValue({}); api.remove.mockResolvedValue({}); });
function page() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>); }
describe('phơi chi-hộ row identity', () => {
  it('keeps native entry and source IDs distinct and preserves the untouched amount', async () => {
    page(); await screen.findByDisplayValue('60000');
    expect(screen.queryByText(/Đã thu\/trả vượt/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '66000' } });
    expect(screen.getByLabelText('Số tiền trả dòng 1')).toHaveValue('50000');
    expect(screen.getByLabelText('Số tiền thu dòng 2')).toHaveValue('80000');
    expect(screen.getByText('130.000 ₫')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(7, 23, expect.objectContaining({ expectedVersion: 3, customerChargeAmount: 66000, amount: 50000 }));
    expect(api.correct).not.toHaveBeenCalled();
  });
  it('allows only unconfirmed rows to invoke the authoritative source void action', async () => {
    page(); await screen.findByText('First fee');
    const first = within(screen.getByText('First fee').closest('tr')!);
    const confirmed = within(screen.getByText('Confirmed fee').closest('tr')!);
    expect(first.getByRole('button', { name: 'Xóa' })).toBeEnabled();
    expect(confirmed.getByRole('button', { name: 'Xóa' })).toBeDisabled();
    fireEvent.click(first.getByRole('button', { name: 'Xóa' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Xác nhận thao tác' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(7, 5, expect.any(String)));
  });
});
