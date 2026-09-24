import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), correct: vi.fn(), remove: vi.fn(), create: vi.fn(), meta: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuChiHo: api.detail, updatePhoiPhieuRowAmounts: api.update, correctPhoiPhieuRow: api.correct, voidPhoiPhieuRow: api.remove, createPhoiPhieuRow: api.create, updatePhoiPhieuMeta: api.meta }));
const expenseApi = vi.hoisted(() => ({ catalog: vi.fn(), create: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { catalog: expenseApi.catalog, create: expenseApi.create } }));
import { PhoiPhieuChiHoDialog } from './PhoiPhieuChiHoDialog';
const rows = [
  { entryId: 23, sourceId: 5, version: 3, feeName: 'First fee', amountThu: 60000, amountTra: 50000, confirmed: false },
  { entryId: 5, sourceId: 9, version: 2, feeName: 'Confirmed fee', amountThu: 80000, amountTra: 80000, confirmed: true },
];
beforeEach(() => {
  vi.resetAllMocks();
  api.detail.mockResolvedValue({ tripId: 7, tripCode: 'QA-TRIP', rows });
  api.update.mockResolvedValue({}); api.remove.mockResolvedValue({});
  expenseApi.catalog.mockResolvedValue({ staff: [], accounts: [], accountants: [], opsUsers: [], advances: [], suppliers: [], expenseTypes: [] });
});
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

// Card 20260923_11 — Chief's P3 screenshot showed the chi-hộ "Chi tiết chi phí"
// dialog and the "Thêm khoản chi" panel open on top of one another, their bodies
// bleeding together (the "Nhập Thu và Trả bằng nhau" checkbox sat inside the
// overlap). RED at HEAD: `adding` mounted ExpenseCreateDrawer while the
// OpsModalBackdrop dialog stayed rendered, so both aria-modal surfaces were
// live at once. The contract pinned here: exactly one surface is active.
describe('one modal surface at a time in the chi-hộ flow (card 20260923_11)', () => {
  it('closes the chi-hộ dialog when the "Thêm khoản chi" panel opens — never two stacked surfaces', async () => {
    page();
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    await screen.findByText('First fee');
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));

    const panel = await screen.findByRole('dialog', { name: 'Thêm khoản chi' });
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Chi tiết chi hộ' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('returns to the chi-hộ dialog when the panel closes, still one surface', async () => {
    page();
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    await screen.findByText('First fee');
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    const panel = await screen.findByRole('dialog', { name: 'Thêm khoản chi' });

    // Header ✕ and the footer "Đóng" both dismiss; either is the same path.
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Đóng' })[0]!);

    expect(await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Thêm khoản chi' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
