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
  it('PHOI08 refreshes successful row versions after a later row failure and retries only the remaining change', async () => {
    let authoritative = rows.map(row => ({ ...row }));
    api.detail.mockImplementation(() => Promise.resolve({ tripId: 7, rows: authoritative }));
    api.update.mockImplementation(async (_tripId, entryId, payload) => { authoritative = authoritative.map(row => row.entryId === entryId ? { ...row, amountThu: payload.customerChargeAmount, version: row.version + 1 } : row); });
    api.correct.mockRejectedValueOnce(new Error('Dòng tiếp theo không lưu được'));
    page(); await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '60001' } });
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 2'), { target: { value: '80001' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dòng tiếp theo không lưu được');
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('60.001');
    expect(screen.getByLabelText('Số tiền thu dòng 2')).toHaveValue('80.001');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.correct).toHaveBeenCalledTimes(2));
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.correct).toHaveBeenLastCalledWith(5, expect.objectContaining({ expectedVersion: 2, customerChargeAmount: 80001 }));
  });
  it('PHOI08 retries metadata after row success without repeating the successful row write', async () => {
    let authoritative = rows.map(row => ({ ...row }));
    api.detail.mockImplementation(() => Promise.resolve({ tripId: 7, rows: authoritative, trangThaiLay: null }));
    api.update.mockImplementation(async (_tripId, entryId, payload) => { authoritative = authoritative.map(row => row.entryId === entryId ? { ...row, amountThu: payload.customerChargeAmount, version: row.version + 1 } : row); });
    api.meta.mockRejectedValueOnce(new Error('Không lưu được trạng thái phơi'));
    page(); await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '60001' } });
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Đã lấy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được trạng thái phơi');
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.meta).toHaveBeenCalledTimes(2));
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.meta).toHaveBeenLastCalledWith(7, { trangThaiLay: 'Đã lấy' });
  });
  it('PHOI08 blocks stale saves after failed authoritative reads and reloads before retrying metadata', async () => {
    let authoritative = rows.map(row => ({ ...row }));
    api.detail.mockImplementationOnce(() => Promise.resolve({ tripId: 7, rows: authoritative, trangThaiLay: null }))
      .mockRejectedValueOnce(new Error('Không đọc được khoản chi sau lỗi lưu'))
      .mockRejectedValueOnce(new Error('Vẫn chưa đọc được khoản chi'))
      .mockImplementation(() => Promise.resolve({ tripId: 7, rows: authoritative, trangThaiLay: null }));
    api.update.mockImplementation(async (_tripId, entryId, payload) => { authoritative = authoritative.map(row => row.entryId === entryId ? { ...row, amountThu: payload.customerChargeAmount, version: row.version + 1 } : row); });
    api.meta.mockRejectedValueOnce(new Error('Không lưu được trạng thái phơi'));
    const onClose = vi.fn(); const onSaved = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={onSaved} /></QueryClientProvider>);
    await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '60001' } });
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Đã lấy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được trạng thái phơi');
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được khoản chi sau lỗi lưu');
    expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeDisabled();
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('60.001');
    expect(screen.getByLabelText('Trạng thái lấy')).toHaveValue('Đã lấy');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(api.update).toHaveBeenCalledOnce(); expect(api.meta).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' }));
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toHaveTextContent('Không lưu được trạng thái phơi');
    expect(screen.getByRole('alert')).toHaveTextContent('Vẫn chưa đọc được khoản chi');
    expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeDisabled();
    expect(api.update).toHaveBeenCalledOnce(); expect(api.meta).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeEnabled());
    expect(api.detail).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('alert')).toHaveTextContent('Không lưu được trạng thái phơi');
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('60.001');
    expect(screen.getByLabelText('Trạng thái lấy')).toHaveValue('Đã lấy');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledOnce(); expect(api.correct).not.toHaveBeenCalled();
    expect(api.meta).toHaveBeenCalledTimes(2);
    expect(api.meta).toHaveBeenLastCalledWith(7, { trangThaiLay: 'Đã lấy' });
  });
  it('PHOI08 keeps date and status drafts local until Cancel with no mutation', async () => {
    const onClose = vi.fn();
    api.detail.mockResolvedValue({ tripId: 7, rows, ngayLayPhoi: '2026-09-22', trangThaiLay: 'Chưa lấy' });
    render(<QueryClientProvider client={new QueryClient()}><PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={vi.fn()} /></QueryClientProvider>);
    await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Ngày lấy phơi'), { target: { value: '23/09/2026' } });
    const status = screen.getByLabelText('Trạng thái lấy');
    fireEvent.change(status, { target: { value: 'Đã lấy' } }); fireEvent.blur(status);
    expect(api.meta).not.toHaveBeenCalled();
    expect(screen.getByText('Có thay đổi chưa lưu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Hủy$/ }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.meta).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
  });
  it('PHOI08 saves changed metadata exactly once through explicit Save', async () => {
    api.detail.mockResolvedValue({ tripId: 7, rows, ngayLayPhoi: '2026-09-22', trangThaiLay: 'Chưa lấy' });
    page(); await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Ngày lấy phơi'), { target: { value: '23/09/2026' } });
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Đã lấy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.meta).toHaveBeenCalledOnce());
    expect(api.meta).toHaveBeenCalledWith(7, { ngayLayPhoi: '2026-09-23', trangThaiLay: 'Đã lấy' });
    expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
  });
  it('PHOI08 supports nullable metadata clearing only on Save', async () => {
    api.detail.mockResolvedValue({ tripId: 7, rows, ngayLayPhoi: '2026-09-22', trangThaiLay: 'Đã lấy' });
    page(); await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Ngày lấy phơi'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tháng — Ngày lấy phơi'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Năm — Ngày lấy phơi'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: '' } });
    expect(api.meta).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.meta).toHaveBeenCalledOnce());
    expect(api.meta).toHaveBeenCalledWith(7, { ngayLayPhoi: null, trangThaiLay: null });
  });
  it('PHOI08 sends no metadata request for untouched or restored drafts', async () => {
    api.detail.mockResolvedValue({ tripId: 7, rows, ngayLayPhoi: '2026-09-22', trangThaiLay: 'Đã lấy' });
    page(); await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Chưa lấy' } });
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Đã lấy' } });
    expect(screen.queryByText('Có thay đổi chưa lưu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toBeEnabled());
    expect(api.meta).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it('PHOI08 catches metadata save errors, retains the draft and does not close', async () => {
    const onClose = vi.fn(); const onSaved = vi.fn();
    api.detail.mockResolvedValue({ tripId: 7, rows, ngayLayPhoi: null, trangThaiLay: null });
    api.meta.mockRejectedValueOnce(new Error('Không lưu được trạng thái phơi'));
    render(<QueryClientProvider client={new QueryClient()}><PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={onSaved} /></QueryClientProvider>);
    await screen.findByText('First fee');
    fireEvent.change(screen.getByLabelText('Trạng thái lấy'), { target: { value: 'Đã lấy' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được trạng thái phơi');
    expect(screen.getByLabelText('Trạng thái lấy')).toHaveValue('Đã lấy');
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.meta).toHaveBeenCalledTimes(2);
  });
  it('PHOI07 blocks equality for an existing negative payable without modifying either receivable', async () => {
    api.detail.mockResolvedValue({ tripId: 7, tripCode: 'QA-TRIP', rows: [rows[0], { ...rows[1], amountTra: -80000 }] });
    page(); await screen.findByText('Confirmed fee');
    const equality = screen.getByRole('checkbox', { name: 'Nhập Thu và Trả bằng nhau' });
    fireEvent.click(equality);
    expect(equality).not.toBeChecked();
    expect(screen.getByText(/Khoản chi âm không áp dụng Thu bằng trả/)).toBeInTheDocument();
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('60.000');
    expect(screen.getByLabelText('Số tiền thu dòng 2')).toHaveValue('80.000');
    expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
  });
  it('PHOI07 releases positive equality for a negative payable and saves the preserved unsigned receivable', async () => {
    page(); await screen.findByText('First fee');
    const equality = screen.getByRole('checkbox', { name: 'Nhập Thu và Trả bằng nhau' });
    fireEvent.click(equality);
    fireEvent.change(screen.getByLabelText('Số tiền trả dòng 1'), { target: { value: '70000' } });
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('70.000');
    fireEvent.change(screen.getByLabelText('Số tiền trả dòng 1'), { target: { value: '-1' } });
    expect(equality).not.toBeChecked();
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('70.000');
    expect(screen.getByText(/Khoản chi âm không áp dụng Thu bằng trả/)).toBeInTheDocument();
    fireEvent.click(equality);
    expect(equality).not.toBeChecked();
    expect(screen.getByLabelText('Số tiền thu dòng 1')).toHaveValue('70.000');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledWith(7, 23, expect.objectContaining({ expectedVersion: 3, amount: -1, customerChargeAmount: 70000 }));
    expect(api.correct).not.toHaveBeenCalled();
  });
  it('PHOI05 keeps confirmed and unconfirmed detail caches distinct on the same trip', async () => {
    api.detail.mockImplementation((_id, confirmation) => Promise.resolve({ tripId: 7, rows: rows.filter(row => confirmation === 'CONFIRMED' ? row.confirmed : !row.confirmed) }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (confirmation: 'CONFIRMED' | 'UNCONFIRMED') => <QueryClientProvider client={queryClient}><PhoiPhieuChiHoDialog tripId={7} confirmation={confirmation} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>;
    const { rerender } = render(view('CONFIRMED'));
    await screen.findByText('Confirmed fee');
    expect(screen.queryByText('First fee')).not.toBeInTheDocument();
    rerender(view('UNCONFIRMED'));
    await screen.findByText('First fee');
    expect(screen.queryByText('Confirmed fee')).not.toBeInTheDocument();
    expect(api.detail).toHaveBeenLastCalledWith(7, 'UNCONFIRMED');
    expect(screen.getByLabelText('Số tiền trả dòng 1')).toHaveValue('50.000');
    expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
  });
  it('PHOI07 excludes negative payable rows and draft values while preserving their source controls', async () => {
    api.detail.mockResolvedValue({ tripId: 7, tripCode: 'QA-TRIP', rows: [rows[0], { ...rows[1], amountTra: -80000 }] });
    page(); await screen.findByText('Confirmed fee');
    const totals = () => [...screen.getByRole('region', { name: 'Tổng cộng' }).querySelectorAll('dd')].map(cell => cell.textContent);
    expect(screen.getByLabelText('Số tiền trả dòng 2')).toHaveValue('-80.000');
    expect(totals()).toEqual(['140.000₫', '50.000₫']);
    fireEvent.change(screen.getByLabelText('Số tiền trả dòng 1'), { target: { value: '-1' } });
    expect(totals()).toEqual(['140.000₫', '0₫']);
    fireEvent.change(screen.getByLabelText('Số tiền trả dòng 1'), { target: { value: '50000' } });
    expect(totals()).toEqual(['140.000₫', '50.000₫']);
    expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
  });
  it('keeps native entry and source IDs distinct and preserves the untouched amount', async () => {
    page(); await screen.findByDisplayValue('60.000');
    expect(screen.queryByText(/Đã thu\/trả vượt/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '66000' } });
    expect(screen.getByLabelText('Số tiền trả dòng 1')).toHaveValue('50.000');
    expect(screen.getByLabelText('Số tiền thu dòng 2')).toHaveValue('80.000');
    const totalCells = screen.getByRole('region', { name: 'Tổng cộng' }).querySelectorAll('dd');
    expect(totalCells[0]!.textContent).toBe('146.000₫');
    expect(totalCells[1]!.textContent).toBe('130.000₫');
    expect(screen.getByRole('status')).toHaveTextContent('Có thay đổi chưa lưu');
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
  it('labels every fact for the shared phone record and clears the draft label after restoration', async () => {
    page(); await screen.findByText('First fee');
    const row = screen.getByText('First fee').closest('tr')!;
    expect(row.closest('table')).toHaveClass('record-table');
    expect([...row.querySelectorAll('td')].map(cell => cell.dataset.label)).toEqual(['STT', 'Nội dung phí', 'Hóa đơn', 'Số tiền thu', 'Số tiền trả', 'Người thanh toán', 'Thao tác']);
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '60001' } });
    expect(screen.getByRole('status')).toHaveTextContent('Có thay đổi chưa lưu');
    fireEvent.change(screen.getByLabelText('Số tiền thu dòng 1'), { target: { value: '60000' } });
    expect(screen.queryByText('Có thay đổi chưa lưu')).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled(); expect(api.correct).not.toHaveBeenCalled();
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
