import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const api = vi.hoisted(() => ({ listIncidentalCosts: vi.fn(), createIncidentalCost: vi.fn(), createIncidentalCosts: vi.fn(), uploadReceiptPhoto: vi.fn(), updateCostSubmissionNote: vi.fn(), getFeeNorms: vi.fn() }));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));
import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

const entry = { id: 1, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: 'DRIVER_SHIPMENT', feeName: 'Nâng container', amount: '500000', occurredAt: '2026-09-16', note: 'Cảng A', receiptStorageKey: null, evidenceKind: 'INVOICE', invoiceNumber: 'HD-101', createdAt: '2026-09-16T02:00:00Z' };
function setup(props: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShipmentCostEntryForm tripId={42} totalRoadAllowance={null} {...props} /></QueryClientProvider>);
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí' })); }
async function choose(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Loại chi phí' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
// Card 141026230700 — Hóa đơn / Phiếu thu are two small toggle buttons now,
// not a dropdown's options.
async function chooseEvidence(label: 'Hóa đơn' | 'Phiếu thu') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}
async function uploadReceipt() {
  fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [new File(['photo'], 'receipt.png', { type: 'image/png' })] } });
  await screen.findByText('Ảnh sẽ gắn với khoản chi này');
}

describe('driver expense workflow — TC-CP-LX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidentalCosts.mockResolvedValue([]);
    api.getFeeNorms.mockResolvedValue({ items: [{ code: 'NIGHT_RETURN', label: 'Trả đêm', amount: '100000' }, { code: 'OVERLOAD', label: 'Chạy quá tải', amount: '200000' }, { code: 'SHIFT', label: 'Lưu ca', amount: '200000' }] });
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

  it('shows unknown route rates and does not create money automatically', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    expect(screen.getByTestId('shipment-cost-route-reference').textContent).toContain('Chưa có định mức');
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  it('card _29: costs empty renders the driver-costs illustration empty state', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    expect(document.querySelector('img[src*="empty-costs.webp"]')).toBeTruthy();
  });

  it('card _29: the accountant note is a collapsed row — editor and Lưu appear on tap', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh');
    // Collapsed: the field is not mounted, the ghost row is.
    expect(screen.queryByLabelText('Ghi chú cho kế toán')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú cho kế toán' }));
    expect(screen.getByLabelText('Ghi chú cho kế toán')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu ghi chú' })).toBeTruthy();
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

  it('submits the evidence kind with no typed invoice pair — the photo is the paper', async () => {
    setup(); await open();
    // Card 141026230700: Hóa đơn / Phiếu thu are 2 small ticks; the typed
    // Số/Ngày hóa đơn pair no longer exists on the driver surface, and every
    // lot cost needs its biên lai photo before the save opens.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    expect(screen.queryByLabelText('Ngày hóa đơn')).toBeNull();
    await chooseEvidence('Hóa đơn');
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '500000' } });
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', amount: 500000, evidenceKind: 'INVOICE', receiptStorageKey: 'receipt.png', feeName: 'Phí nâng' });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceDate).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('customerChargeAmount');
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('receivedAmount');
    await waitFor(() => expect(api.listIncidentalCosts).toHaveBeenCalledTimes(2));
  });

  // Card 182300 — chiphispec §1: a fee-norm row IS system-recorded Tiền đường.
  // The "Thực chi" field is LOCKED at the norm's system value (no "Gợi ý …; sửa
  // theo khoản thực tế" affordance), and cancelling still writes nothing.
  it('card 182300: a fee-norm row locks "Thực chi" to the system value — the driver only views it', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Trả đêm');
    const field = screen.getByLabelText(/Thực chi/) as HTMLInputElement;
    expect(field.value).toBe('100.000');
    expect(field).toBeDisabled();
    expect(screen.getByText(/Hệ thống tự ghi nhận theo định mức 100\.000/)).toBeTruthy();
    expect(screen.queryByText(/Gợi ý/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  it('records road money by explicit selected category, without an invoice or cash charge', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Chạy quá tải');
    // CP700-03 — an ordinary Tiền đường row carries NO photo gate: the server
    // keeps the optional-photo contract for the road bucket, so the form must
    // not demand a biên lai here (the old amount-gated rule blocked exactly
    // the rows the server accepts).
    expect(screen.queryByTestId('shipment-cost-receipt-required')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costType: 'OTHER', costGroup: 'DRIVER_ROAD', feeName: 'Chạy quá tải', amount: 200000 });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].receiptStorageKey).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
  });

  // Card 20260928_197 — the PM's words are "MỌI màn hình nhập chi phí (Ops,
  // lái xe, hóa đơn kết hợp) cho phép nhập số DƯƠNG và số ÂM". The frontend pass
  // opened the Ops modals and the correction drawer, and MISSED this form, so
  // two separate gates still refused a negative: the <input min={1}>, which
  // makes the browser reject the keystroke outright, and the hook's own
  // `amount <= 0`. The backend already accepted the signed value — the 400 the
  // form would have produced was a lie about what the server wanted.
  it('card 197: a negative amount is accepted and sent as typed (the signed cost rule)', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    // Card 182300 — norms are locked system money; the signed driver-actual
    // rule (card 197) is exercised on an editable non-norm road option.
    await choose('Tiền đường khác');
    const field = screen.getByLabelText(/Thực chi/) as HTMLInputElement;

    // Card 20260929_209: drive the keys one at a time, the way a keypress does,
    // and assert the INTERMEDIATE state. Setting the whole value in a single
    // fireEvent bypasses exactly the step that was broken — which is how this
    // test stayed green while pressing the minus key did nothing at all.
    fireEvent.change(field, { target: { value: '-' } });
    expect(field.value).toBe('-'); // the sign is on screen, waiting for digits
    for (const value of ['-3', '-30', '-300', '-3000', '-30000']) {
      fireEvent.change(field, { target: { value } });
    }

    // Assert the DISPLAY, not a `min` attribute. This field is grouped, and
    // grouped mode renders a text input and deliberately does not forward
    // min/max/step — they would be meaningless there, and NumberField's own
    // contract says bounds are enforced save-side. Reading `min` off the DOM
    // returned null and I nearly "proved" a bug that was not there; the value
    // the user sees and the value the server receives are the real contract.
    expect(field.value).toBe('-30.000');

    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));

    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: -30000 });
    expect(screen.queryByText(/nguyên dương/)).toBeNull();
  });
  // Card 20260928_181, tiêu chí 5 — the note that says what a negative does.
  // Card 197 made negatives ENTERABLE; without this the screen accepts -30.000
  // in total silence while every total in the system quietly drops the line.
  it('card 181: typing a negative explains that the line is excluded from every total', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Tiền đường khác'); // card 182300 — norms are locked; this rule is about editable driver actuals
    const field = screen.getByLabelText(/Thực chi/);

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
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Tiền đường khác'); // card 182300 — norms are locked; this rule is about editable driver actuals
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  // CP700-03 — "MỌI dòng nhóm DRIVER_SHIPMENT phải có ảnh biên lai (FE chặn +
  // BE từ chối)": the sign does not matter. A negative lot row is a refund
  // adjustment AND a lot-bucket row; the server answers 'Chi phí lô hàng phải
  // kèm ảnh biên lai trước khi lưu.' without the photo, so the form gates it
  // up front instead of letting the whole batch roll back server-side.
  it('CP700-03: a negative lot row still carries its biên lai — the server rejects it without', async () => {
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '-30000' } });
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Chi phí lô hàng phải kèm ảnh biên lai trước khi lưu.');
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', amount: -30000, receiptStorageKey: 'receipt.png' });
  });

  // Card 20261005 — "Người chi" (Tôi chi / Công ty chi) gỡ khỏi chi phí lái xe:
  // lái xe ghi khoản đã chi, kế toán quyết định bên thực chi. Form không còn
  // combobox Người chi, payload không mang payerKind, và dòng đã lưu không in
  // "Tôi chi" / "Công ty đã trả". Định mức đồng ý (Lưu ca) giữ nguyên: ghi đúng
  // số tiền định mức, không cộng thêm.
  it('records a fee norm with no payer choice — no Người chi control, no payerKind in the payload', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { ...entry, id: 24, costType: DriverIncidentalCostType.OTHER, costGroup: 'DRIVER_ROAD', feeName: 'Lưu ca', amount: '200000' },
    ]);
    setup(); await screen.findByText('Lưu ca');
    expect(screen.queryByText('Tôi chi')).toBeNull();
    expect(screen.queryByText('Công ty đã trả')).toBeNull();
    await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Lưu ca');
    expect(screen.queryByRole('combobox', { name: 'Người chi' })).toBeNull();
    // chiphispec §2 — money on the row ⇒ biên lai required.
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ costType: 'OTHER', feeNormCode: 'SHIFT', feeName: 'Lưu ca', amount: 200000 });
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('payerKind');
  });

  // Card 182300 — a configured norm keeps its SYSTEM amount on the payload: the
  // locked field cannot be overridden, and the server force (ignore-field)
  // mirrors it, so the amount the accountant sees at phơi phiếu is the norm's.
  it('card 182300: a configured custom norm submits its SYSTEM amount — the locked field cannot be overridden', async () => {
    api.getFeeNorms.mockResolvedValue({ items: [{ code: 'CUSTOM_HARBOR', label: 'Phụ cấp bãi kiểm thử mới', amount: '73000' }] });
    setup(); await open(); fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' })); await choose('Phụ cấp bãi kiểm thử mới');
    const field = screen.getByLabelText(/Thực chi/) as HTMLInputElement;
    expect(field).toHaveValue('73.000');
    expect(field).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledOnce());
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ feeNormCode: 'CUSTOM_HARBOR', amount: 73000, costGroup: 'DRIVER_ROAD' });
  });

  it('keeps manual entry available and exposes retry when norms fail to load', async () => {
    api.getFeeNorms.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [] });
    setup(); await open(); expect(await screen.findByText(/Không tải được định mức tiền đường/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '50000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại định mức' }));
    await waitFor(() => expect(api.getFeeNorms).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledOnce());
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).not.toHaveProperty('feeNormCode');
  });

  it('retries the same failed save with the same key and retained input', async () => {
    api.createIncidentalCosts.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce(entry);
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '123000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất phản hồi');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(2));
    expect(api.createIncidentalCosts.mock.calls[0][2]).toBe(api.createIncidentalCosts.mock.calls[1][2]);
  });

  it('blocks a repeated click while a save is unresolved', async () => {
    api.createIncidentalCosts.mockReturnValue(new Promise(() => {}));
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '50000' } });
    await uploadReceipt();
    const save = screen.getByRole('button', { name: /^Lưu tất cả/ });
    fireEvent.click(save); fireEvent.click(save);
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
  });

  it('keeps the amount when receipt upload fails and allows retry', async () => {
    api.uploadReceiptPhoto.mockRejectedValueOnce(new Error('Ảnh chưa tải')).mockResolvedValueOnce({ storageKey: 'receipt.png' });
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '35000' } });
    const file = new File(['photo'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ảnh chưa tải');
    expect((screen.getByLabelText(/Thực chi/) as HTMLInputElement).value).toBe('35.000');
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại ảnh' }));
    await screen.findByText('Ảnh sẽ gắn với khoản chi này');
    expect(api.uploadReceiptPhoto).toHaveBeenCalledTimes(2);
    expect(api.uploadReceiptPhoto.mock.calls[1][0].file).toBe(file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử tải lại ảnh' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Thực chi/)).toHaveValue('35.000');
    // An upload key does not prove that the separate protected photo read succeeded.
    expect(screen.queryByAltText('Biên lai đã chọn')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Biên lai đã chọn (không tải được)' })).toHaveTextContent('Không tải được');
    expect(document.querySelector('img[src=""]')).toBeNull();
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledOnce());
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: 35000, receiptStorageKey: 'receipt.png' });
  });

  it('does not autosave notes and explicitly stores the correct trip note once', async () => {
    setup(); await screen.findByText('Chưa có chi phí phát sinh');
    // Card _29: the note editor mounts only after expanding the collapsed row.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú cho kế toán' }));
    fireEvent.change(screen.getByLabelText('Ghi chú cho kế toán'), { target: { value: 'Kiểm tra phí cầu đường' } });
    expect(api.updateCostSubmissionNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() => expect(api.updateCostSubmissionNote).toHaveBeenCalledWith(42, 'Kiểm tra phí cầu đường'));
  });

  it('attempts the actual business request even when the browser connectivity hint is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    api.createIncidentalCosts.mockRejectedValue(new Error('Máy chủ chưa trả lời'));
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '99000' } });
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await screen.findByText('Máy chủ chưa trả lời');
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Thực chi/)).toHaveValue('99.000');
    window.dispatchEvent(new Event('online'));
    expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1);
  });

  it('displays Thực chi with vi-VN grouping while the saved amount stays a plain integer (card 20260924_1, image12)', async () => {
    setup(); await open();
    const field = screen.getByLabelText(/Thực chi/);
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
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú cho kế toán' }));
    expect(screen.getByLabelText('Ghi chú cho kế toán')).toBeDisabled();
  });
  it('card 163 → 141026230700: an invoiced lot-cost fee carries its catalog code, no typed invoice, photo mandatory', async () => {
    setup(); await open();
    // The typed invoice pair is gone for EVERY lot cost whatever the catalog
    // says; the server keeps its invoiced-catalog classification (the
    // charge-the-customer side) and now demands the biên lai photo instead.
    await choose('Phí vệ sinh');
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '50000' } });
    // CP700-03 — every lot row needs the biên lai; the copy is the server's
    // own line so the two gates can never disagree.
    expect(screen.getByRole('button', { name: /^Lưu tất cả/ })).toBeDisabled();
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Chi phí lô hàng phải kèm ảnh biên lai trước khi lưu.');
    await uploadReceipt();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({
      expenseTypeCode: 'FEE_CLEANING', evidenceKind: 'RECEIPT', receiptStorageKey: 'receipt.png', costGroup: 'DRIVER_SHIPMENT', feeName: 'Phí vệ sinh',
    });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
  });

  it('card 20260928_164: a no-invoice lot-cost fee offers no Số hóa đơn and never sends one', async () => {
    api.uploadReceiptPhoto.mockResolvedValue({ storageKey: 'receipt.png', url: 'blob:receipt' });
    setup(); await open();
    await choose('Đảo vỏ');
    // CONTAINER_SWAP is catalog-classified no-invoice and the row stays on the
    // default "Phiếu thu": there is no invoice field to type into, and even a
    // number left over from an earlier pick must not reach the payload — that is
    // what pushed these rows into phải thu khách hàng.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '90000' } });
    // "Phiếu thu" mandates the biên lai photo before the save opens (step 2).
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [new File(['photo'], 'receipt.png', { type: 'image/png' })] } });
    await screen.findByText('Ảnh sẽ gắn với khoản chi này');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu tất cả/ }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    const body = api.createIncidentalCosts.mock.calls[0][1][0];
    expect(body).toMatchObject({ expenseTypeCode: 'CONTAINER_SWAP', costGroup: 'DRIVER_SHIPMENT', feeName: 'Đảo vỏ', evidenceKind: 'RECEIPT' });
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
