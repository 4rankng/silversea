import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const api = vi.hoisted(() => ({ listIncidentalCosts: vi.fn(), createIncidentalCost: vi.fn(), createIncidentalCosts: vi.fn(), uploadReceiptPhoto: vi.fn(), updateCostSubmissionNote: vi.fn() }));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));
import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

const entry = { id: 1, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: 'DRIVER_SHIPMENT', feeName: 'Nâng container', amount: '500000', occurredAt: '2026-09-16', note: 'Cảng A', receiptStorageKey: null, evidenceKind: 'INVOICE', invoiceNumber: 'HD-101', createdAt: '2026-09-16T02:00:00Z' };
function setup(props: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShipmentCostEntryForm tripId={42} totalRoadAllowance={null} {...props} /></QueryClientProvider>);
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí' })); }
async function choose(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Tên chi phí' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
async function uploadReceipt() {
  fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [new File(['photo'], 'receipt.png', { type: 'image/png' })] } });
  await screen.findByText('Đã đính kèm biên lai.');
}

describe('driver expense workflow — TC-CP-LX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidentalCosts.mockResolvedValue([]);
    api.createIncidentalCosts.mockResolvedValue(entry);
    api.uploadReceiptPhoto.mockResolvedValue({ storageKey: 'receipt.png', url: 'blob:receipt' });
    api.updateCostSubmissionNote.mockResolvedValue({});
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  // Card 081026091900 — trip 79 carried a TOLL pair: -30.000 then +30.000, both
  // rendered "Tôi chi / Tiền đường". A negative row is an adjusting entry, not a
  // spend — ruling 20260928_197, already shipped and QA PASSED on the Ops wallet
  // (071026210530). The driver list never got the same treatment, so the class
  // was fixed at one surface only.
  it('labels a negative saved row as an adjusting entry, and leaves a positive row alone', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { ...entry, id: 22, costType: DriverIncidentalCostType.TOLL, costGroup: 'DRIVER_ROAD', feeName: 'TOLL', amount: '-30000' },
      { ...entry, id: 23, costType: DriverIncidentalCostType.TOLL, costGroup: 'DRIVER_ROAD', feeName: 'TOLL', amount: '30000' },
    ]);
    setup();
    await screen.findAllByText('TOLL');

    const rows = screen.getAllByText('TOLL').map((node) => node.closest('li') as HTMLElement);
    const negative = rows.find((row) => row.textContent?.includes('-30.000'));
    const positive = rows.find((row) => row.textContent?.includes('30.000') && !row.textContent?.includes('-30.000'));

    expect(negative?.textContent).toMatch(/bút toán điều chỉnh/);
    expect(positive?.textContent).not.toMatch(/bút toán điều chỉnh/);
  });

  // SIL-759 — the Tiền đường table leads with the system's locked tạm tính.
  it('shows the system road norm as locked money when the trip has one', async () => {
    setup({ totalRoadAllowance: '450000' });
    await screen.findByText('Chưa có chi phí phát sinh');
    const band = screen.getByTestId('shipment-cost-road-allowance');
    expect(band.textContent).toContain('Tạm tính định mức');
    expect(band.textContent).toContain('450.000 ₫');
    // Locked, read-only money: no input, no add control anywhere in the road table.
    expect(band.querySelector('input')).toBeNull();
    const roadTable = screen.getByRole('region', { name: 'Bảng Tiền đường' });
    expect(within(roadTable).queryByRole('button', { name: /Thêm/ })).toBeNull();
  });

  it('shows unknown route rates and does not create money automatically', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    expect(screen.getByTestId('shipment-cost-road-allowance').textContent).toContain('Chưa có định mức tiền tuyến');
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  it('card _29: costs empty renders the driver-costs illustration empty state', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    expect(document.querySelector('img[src*="empty-costs.webp"]')).toBeTruthy();
  });

  it('card _29 + SIL-759: the discrepancy note is a collapsed row inside the road table — editor and Lưu appear on tap', async () => {
    setup({ totalRoadAllowance: '450000' });
    await screen.findByText('Chưa có chi phí phát sinh');
    // Collapsed: the field is not mounted, the ghost row is — INSIDE the road
    // table, right under the system amount (AC: the note sits below the money).
    const roadTable = screen.getByRole('region', { name: 'Bảng Tiền đường' });
    expect(within(roadTable).queryByLabelText('Ghi chú tiền đường')).toBeNull();
    fireEvent.click(within(roadTable).getByRole('button', { name: 'Ghi chú tiền đường' }));
    expect(within(roadTable).getByLabelText('Ghi chú tiền đường')).toBeTruthy();
    expect(within(roadTable).getByRole('button', { name: 'Lưu ghi chú' })).toBeTruthy();
  });

  it('does not autosave notes and explicitly stores the correct trip note once', async () => {
    setup(); await screen.findByText('Chưa có chi phí phát sinh');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú tiền đường' }));
    fireEvent.change(screen.getByLabelText('Ghi chú tiền đường'), { target: { value: 'Đi vòng phí cầu 80k' } });
    expect(api.updateCostSubmissionNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() => expect(api.updateCostSubmissionNote).toHaveBeenCalledWith(42, 'Đi vòng phí cầu 80k'));
  });

  it('reads saved fee names, invoice numbers and actual amounts', async () => {
    api.listIncidentalCosts.mockResolvedValue([entry]);
    setup();
    expect(await screen.findByText('Nâng container')).toBeTruthy();
    expect(screen.getByText('HĐ HD-101')).toBeTruthy();
    expect(screen.getByText('500.000 ₫')).toBeTruthy();
  });

  it('card 141026230700: the two cost tables always render — lot and road rows land in their own table', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { ...entry, id: 40, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: 'DRIVER_SHIPMENT', feeName: 'Nâng container', amount: '500000' },
      { ...entry, id: 41, costType: DriverIncidentalCostType.TOLL, costGroup: 'DRIVER_ROAD', feeName: 'Vé cầu đường', amount: '30000' },
    ]);
    setup();
    await screen.findByText('Nâng container');
    const lotTable = screen.getByRole('region', { name: 'Bảng Chi phí lô hàng' });
    const roadTable = screen.getByRole('region', { name: 'Bảng Tiền đường' });
    expect(lotTable.textContent).toContain('Nâng container');
    expect(lotTable.textContent).not.toContain('Vé cầu đường');
    expect(roadTable.textContent).toContain('Vé cầu đường');
  });

  it('card 141026230700: legacy rows without costGroup follow the write-path fallback', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { ...entry, id: 42, costType: DriverIncidentalCostType.TOLL, costGroup: null, feeName: 'Vé (cũ)', amount: '30000' },
      { ...entry, id: 43, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: null, feeName: 'Nâng (cũ)', amount: '500000' },
    ]);
    setup();
    await screen.findByText('Vé (cũ)');
    expect(screen.getByRole('region', { name: 'Bảng Tiền đường' }).textContent).toContain('Vé (cũ)');
    expect(screen.getByRole('region', { name: 'Bảng Chi phí lô hàng' }).textContent).toContain('Nâng (cũ)');
  });

  it('card 141026230700: each empty table names its bucket instead of one combined silence', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    expect(screen.getByText('Chưa có chi phí lô hàng phát sinh.')).toBeTruthy();
    expect(screen.getByText('Chưa có tiền đường phát sinh.')).toBeTruthy();
  });

  // SIL-759 — the add control belongs to the LOT table head; the road area has
  // no add path, and the opened form is ONE horizontal lot-only row.
  it('SIL-759: [+ Thêm chi phí] lives in the lot table head only and opens a lot-only one-line row', async () => {
    setup({ totalRoadAllowance: '450000' });
    await screen.findByText('Chưa có chi phí phát sinh');
    const lotTable = screen.getByRole('region', { name: 'Bảng Chi phí lô hàng' });
    const roadTable = screen.getByRole('region', { name: 'Bảng Tiền đường' });
    expect(within(lotTable).getByRole('button', { name: 'Thêm chi phí' })).toBeTruthy();
    expect(within(roadTable).queryByRole('button', { name: /Thêm/ })).toBeNull();
    await open();
    // Lot-only: no group tabs, no road dropdown entries, no driver date.
    expect(screen.queryByRole('tab', { name: 'Tiền đường' })).toBeNull();
    expect(screen.queryByLabelText('Ngày chi')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Loại chứng từ' })).toBeNull();
    // Exactly four parts on the line: Tên chi phí · Số tiền · camera · Xóa dòng.
    expect(screen.getByRole('combobox', { name: 'Tên chi phí' })).toBeTruthy();
    expect(screen.getByLabelText(/Số tiền/)).toBeTruthy();
    expect(screen.getByLabelText('Chọn ảnh biên lai')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa dòng 1' })).toBeTruthy();
    // The dropdown lists lot fees only.
    fireEvent.click(screen.getByRole('combobox', { name: 'Tên chi phí' }));
    expect(await screen.findByRole('option', { name: 'Phí nâng' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Vé cầu đường' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Trả đêm' })).toBeNull();
  });

  // SIL-759 — the evidence-kind ticks are gone; the paper kind follows the
  // catalog's invoiced classification (the receivable side's own rule).
  it('SIL-759: an invoiced lot fee derives INVOICE from the catalog, with no tick and no typed invoice pair', async () => {
    setup(); await open();
    // Card 141026230700: Hóa đơn / Phiếu thu are 2 small ticks; the typed
    // Số/Ngày hóa đơn pair no longer exists on the driver surface, and the
    // default pick (Phí nâng) is one of SIL-769's three photo-mandatory fees,
    // so the save opens only once the biên lai photo exists.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    expect(screen.queryByLabelText('Ngày hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '500000' } });
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', amount: 500000, evidenceKind: 'INVOICE', receiptStorageKey: 'receipt.png', feeName: 'Phí nâng', expenseTypeCode: 'LIFTING' });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceDate).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('customerChargeAmount');
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('receivedAmount');
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('payerKind');
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('note');
    await waitFor(() => expect(api.listIncidentalCosts).toHaveBeenCalledTimes(2));
  });

  it('SIL-759: a no-invoice lot fee derives RECEIPT, and "Chi phí lô hàng khác" asks for its name', async () => {
    setup(); await open();
    await choose('Đảo vỏ');
    // CONTAINER_SWAP is catalog-classified no-invoice → RECEIPT, no name field.
    expect(screen.queryByLabelText('Tên khoản chi')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '90000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ expenseTypeCode: 'CONTAINER_SWAP', costGroup: 'DRIVER_SHIPMENT', feeName: 'Đảo vỏ', evidenceKind: 'RECEIPT' });

    await open();
    await choose('Chi phí lô hàng khác');
    // Unclassified → RECEIPT, and the name field appears so kế toán knows what it was.
    expect(screen.getByLabelText('Tên khoản chi')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tên khoản chi'), { target: { value: 'Phí nước uống' } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '90000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(2));
    expect(api.createIncidentalCosts.mock.calls[1][1][0]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', feeName: 'Phí nước uống', evidenceKind: 'RECEIPT' });
    expect(api.createIncidentalCosts.mock.calls[1][1][0].expenseTypeCode).toBeUndefined();
  });

  // CP700-03 as amended by SIL-769: the negative still carries its biên lai
  // because the DEFAULT pick (Phí nâng — LIFTING) is one of the three
  // photo-mandatory fees; the refusal NAMES the fee. The sign itself no
  // longer matters — a negative row of a non-mandatory fee saves freely
  // (pinned by the Phí vệ sinh test below).
  it('CP700-03/SIL-769: a negative Phí nâng row still carries its biên lai — the server names the fee', async () => {
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '-30000' } });
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Phí nâng phải kèm ảnh biên lai trước khi lưu.');
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', amount: -30000, receiptStorageKey: 'receipt.png' });
  });

  // Card 20260928_197 — the PM's words are "MỌI màn hình nhập chi phí (Ops,
  // lái xe, hóa đơn kết hợp) cho phép nhập số DƯƠNG và số ÂM". The backend
  // already accepted the signed value — the form must not refuse it either.
  it('card 197: a negative amount is accepted and sent as typed (the signed cost rule)', async () => {
    setup(); await open();
    const field = screen.getByLabelText(/Số tiền/) as HTMLInputElement;

    // Card 20260929_209: drive the keys one at a time, the way a keypress does,
    // and assert the INTERMEDIATE state. Setting the whole value in a single
    // fireEvent bypasses exactly the step that was broken — which is how this
    // test stayed green while pressing the minus key did nothing at all.
    fireEvent.change(field, { target: { value: '-' } });
    expect(field.value).toBe('-'); // the sign is on screen, waiting for digits
    for (const value of ['-3', '-30', '-300', '-3000', '-30000']) {
      fireEvent.change(field, { target: { value } });
    }

    // Assert the DISPLAY, not a `min` attribute: grouped mode renders a text
    // input and deliberately does not forward min/max/step.
    expect(field.value).toBe('-30.000');

    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));

    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: -30000 });
    expect(screen.queryByText(/nguyên dương/)).toBeNull();
  });

  // Card 20260928_181, tiêu chí 5 — the note that says what a negative does.
  it('card 181: typing a negative explains that the line is excluded from every total', async () => {
    setup(); await open();
    const field = screen.getByLabelText(/Số tiền/);

    // Absent while the amount is a normal cost — otherwise the line is noise
    // on every other entry.
    expect(screen.queryByTestId('shipment-cost-negative-note')).toBeNull();

    fireEvent.change(field, { target: { value: '-30000' } });
    const note = screen.getByTestId('shipment-cost-negative-note');
    expect(note.textContent).toMatch(/không cộng vào bất kỳ tổng nào/i);

    // …and gone again the moment the sign is fixed, so it is not a label the
    // user learns to ignore.
    fireEvent.change(field, { target: { value: '30000' } });
    expect(screen.queryByTestId('shipment-cost-negative-note')).toBeNull();
  });

  it('card 197: 0 stays rejected — an empty row is not a signed one', async () => {
    setup(); await open();
    await uploadReceipt();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  // SIL-769 AC1 — Phí lưu bãi (Lưu vỏ) is the third photo-mandatory fee: the
  // block NAMES it and stays closed until the photo lands.
  it('SIL-769: a Phí lưu bãi row is blocked until its biên lai — the message names the fee', async () => {
    setup(); await open();
    await choose('Phí lưu bãi');
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '200000' } });
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Phí lưu bãi phải kèm ảnh biên lai trước khi lưu.');
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ expenseTypeCode: 'YARD_STORAGE', receiptStorageKey: 'receipt.png' });
  });
  it('retries the same failed save with the same key and retained input', async () => {
    api.createIncidentalCosts.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce(entry);
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '123000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất phản hồi');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(2));
    expect(api.createIncidentalCosts.mock.calls[0][2]).toBe(api.createIncidentalCosts.mock.calls[1][2]);
  });

  it('blocks a repeated click while a save is unresolved', async () => {
    const { promise } = Promise.withResolvers<never>();
    api.createIncidentalCosts.mockReturnValue(promise);
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '50000' } });
    await uploadReceipt();
    const save = screen.getByRole('button', { name: /^Lưu tất cả/ });
    fireEvent.click(save); fireEvent.click(save);
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
  });

  it('keeps the amount when receipt upload fails and allows retry', async () => {
    api.uploadReceiptPhoto.mockRejectedValueOnce(new Error('Ảnh chưa tải')).mockResolvedValueOnce({ storageKey: 'receipt.png' });
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '35000' } });
    const file = new File(['photo'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ảnh chưa tải');
    expect((screen.getByLabelText(/Số tiền/) as HTMLInputElement).value).toBe('35.000');
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại ảnh' }));
    await screen.findByText('Đã đính kèm biên lai.');
    expect(api.uploadReceiptPhoto).toHaveBeenCalledTimes(2);
    expect(api.uploadReceiptPhoto.mock.calls[1][0].file).toBe(file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử tải lại ảnh' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Số tiền/)).toHaveValue('35.000');
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledOnce());
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: 35000, receiptStorageKey: 'receipt.png' });
  });

  it('SIL-759: removing a draft row drops exactly that row', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    const amounts = screen.getAllByLabelText(/Số tiền/);
    fireEvent.change(amounts[0], { target: { value: '50000' } });
    fireEvent.change(amounts[1], { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 1' }));
    expect(screen.getAllByLabelText(/Số tiền/)).toHaveLength(1);
    expect((screen.getByLabelText(/Số tiền/) as HTMLInputElement).value).toBe('70.000');
  });

  it('attempts the actual business request even when the browser connectivity hint is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    api.createIncidentalCosts.mockRejectedValue(new Error('Máy chủ chưa trả lời'));
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '99000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await screen.findByText('Máy chủ chưa trả lời');
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Số tiền/)).toHaveValue('99.000');
    window.dispatchEvent(new Event('online'));
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
  });

  it('displays Số tiền with vi-VN grouping while the saved amount stays a plain integer (card 20260924_1, image12)', async () => {
    setup(); await open();
    const field = screen.getByLabelText(/Số tiền/);
    fireEvent.change(field, { target: { value: '1200000' } });
    expect(field).toHaveValue('1.200.000');
    // Pasting the formatted text back parses to the same integer — the
    // display format never leaks into the data contract.
    fireEvent.change(field, { target: { value: '1.200.000' } });
    expect(field).toHaveValue('1.200.000');
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: 1200000 });
  });

  it('keeps cancelled/locked trip expenses read-only', async () => {
    api.listIncidentalCosts.mockResolvedValue([entry]);
    setup({ readOnly: true });
    await screen.findByText('Nâng container');
    expect(screen.queryByRole('button', { name: 'Thêm chi phí' })).toBeNull();
    // Card _29: expand the collapsed note row to reach the read-only field.
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú tiền đường' }));
    expect(screen.getByLabelText('Ghi chú tiền đường')).toBeDisabled();
  });
  // card 163 → SIL-769: an invoiced lot-cost fee carries its catalog code, no
  // typed invoice, photo OPTIONAL — Phí vệ sinh (FEE_CLEANING) is NOT one of
  // the three photo-mandatory fees: the row saves WITHOUT a photo.
  it('card 163 → SIL-769: an invoiced lot-cost fee carries its catalog code, no typed invoice, photo OPTIONAL', async () => {
    setup(); await open();
    await choose('Phí vệ sinh');
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '50000' } });
    expect(screen.queryByTestId('shipment-cost-receipt-required')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({
      expenseTypeCode: 'FEE_CLEANING', evidenceKind: 'INVOICE', costGroup: 'DRIVER_SHIPMENT', feeName: 'Phí vệ sinh',
    });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].receiptStorageKey).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
  });

  it('card 20260928_164: a no-invoice lot-cost fee offers no Số hóa đơn and never sends one', async () => {
    setup(); await open();
    await choose('Đảo vỏ');
    // CONTAINER_SWAP is catalog-classified no-invoice and the row stays on the
    // default "Phiếu thu": there is no invoice field to type into, and even a
    // number left over from an earlier pick must not reach the payload — that is
    // what pushed these rows into phải thu khách hàng. SIL-769 — CONTAINER_SWAP
    // is not one of the three photo-mandatory fees: the row saves with
    // kind-only evidence, no biên lai demanded.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '90000' } });
    expect(screen.queryByTestId('shipment-cost-receipt-required')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    const body = api.createIncidentalCosts.mock.calls[0][1][0];
    expect(body).toMatchObject({ expenseTypeCode: 'CONTAINER_SWAP', costGroup: 'DRIVER_SHIPMENT', feeName: 'Đảo vỏ', evidenceKind: 'RECEIPT' });
    expect(body.receiptStorageKey).toBeUndefined();
    expect(body.invoiceNumber).toBeUndefined();
    expect(body.invoiceDate).toBeUndefined();
  });

  it('does not claim there are no costs when the list read fails and recovers explicitly', async () => {
    api.listIncidentalCosts.mockRejectedValueOnce(new Error('Không tải được chi phí QA'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được chi phí QA');
    expect(screen.queryByText('Chưa có chi phí phát sinh')).toBeNull();
    api.listIncidentalCosts.mockResolvedValue([entry]);
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
    expect(await screen.findByText('Nâng container')).toBeTruthy();
    expect(screen.queryByText('Không tải được chi phí QA')).toBeNull();
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  // Card 20261005 — dòng hệ thống tự ghi nhận bị khóa với lái xe: "Tiền đường"
  // (ROAD_ALLOWANCE) và "Phí nâng/hạ theo vùng" (LIFT_DROP_ZONE) không có nút
  // sửa / nút chứng từ, chỉ dòng "Hệ thống tự ghi nhận"; loại phí khác (OTHER)
  // vẫn có nút sửa như bình thường.
  it('locks system-recorded rows (ROAD_ALLOWANCE, LIFT_DROP_ZONE) while an OTHER row stays editable', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { ...entry, id: 31, costType: DriverIncidentalCostType.ROAD_ALLOWANCE, costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường hệ thống', amount: '300000' },
      { ...entry, id: 32, costType: DriverIncidentalCostType.LIFT_DROP_ZONE, costGroup: 'DRIVER_ROAD', feeName: 'Nâng/hạ theo vùng', amount: '50000' },
      { ...entry, id: 33, costType: DriverIncidentalCostType.OTHER, costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường khác', amount: '70000' },
    ]);
    setup();
    await screen.findByText('Tiền đường hệ thống');
    expect(screen.getAllByText('Hệ thống tự ghi nhận — Kế toán điều chỉnh tại màn hình phơi phiếu.')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Sửa khoản chi' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Xem / bổ sung chứng từ' })).toHaveLength(1);
  });

});
