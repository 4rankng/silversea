import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const api = vi.hoisted(() => ({ listIncidentalCosts: vi.fn(), createIncidentalCost: vi.fn(), uploadReceiptPhoto: vi.fn(), updateCostSubmissionNote: vi.fn(), getFeeNorms: vi.fn() }));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));
import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

const entry = { id: 1, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: 'DRIVER_SHIPMENT', feeName: 'Nâng container', amount: '500000', occurredAt: '2026-09-16', note: 'Cảng A', receiptStorageKey: null, invoiceNumber: 'HD-101', createdAt: '2026-09-16T02:00:00Z' };
function setup(props: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShipmentCostEntryForm tripId={42} totalRoadAllowance={null} {...props} /></QueryClientProvider>);
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí' })); }
async function choose(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Loại chi phí' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

describe('driver expense workflow — TC-CP-LX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidentalCosts.mockResolvedValue([]);
    api.getFeeNorms.mockResolvedValue({ items: [{ code: 'NIGHT_RETURN', label: 'Trả đêm', amount: '100000' }, { code: 'OVERLOAD', label: 'Chạy quá tải', amount: '200000' }, { code: 'SHIFT', label: 'Lưu ca', amount: '200000' }] });
    api.createIncidentalCost.mockResolvedValue(entry);
    api.updateCostSubmissionNote.mockResolvedValue({});
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('shows unknown route rates and does not create money automatically', async () => {
    setup();
    await screen.findByText('Chưa có chi phí phát sinh nào.');
    expect(screen.getByTestId('shipment-cost-route-reference').textContent).toContain('Chưa có định mức');
    expect(api.createIncidentalCost).not.toHaveBeenCalled();
  });

  it('reads saved fee names, invoice numbers and actual amounts', async () => {
    api.listIncidentalCosts.mockResolvedValue([entry]);
    setup();
    expect(await screen.findByText('Nâng container')).toBeTruthy();
    expect(screen.getByText('HĐ HD-101')).toBeTruthy();
    expect(screen.getByText('500.000 ₫')).toBeTruthy();
  });

  it('submits invoice metadata without claiming customer cash received', async () => {
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('Số hóa đơn'), { target: { value: 'HD-101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCost.mock.calls[0][1]).toMatchObject({ costGroup: 'DRIVER_SHIPMENT', amount: 500000, invoiceNumber: 'HD-101', feeName: 'Phí nâng' });
    expect(api.createIncidentalCost.mock.calls[0][1]).not.toHaveProperty('customerChargeAmount');
    expect(api.createIncidentalCost.mock.calls[0][1]).not.toHaveProperty('receivedAmount');
    await waitFor(() => expect(api.listIncidentalCosts).toHaveBeenCalledTimes(2));
  });

  it('offers editable suggestions and cancellation creates no expense', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Trả đêm');
    expect((screen.getByLabelText(/Thực chi/) as HTMLInputElement).value).toBe('100000');
    expect(screen.getByText(/Gợi ý 100.000/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(api.createIncidentalCost).not.toHaveBeenCalled();
  });

  it('records road money by explicit selected category, without an invoice or cash charge', async () => {
    setup(); await open();
    fireEvent.change(screen.getByLabelText('Số hóa đơn'), { target: { value: 'OLD-INVOICE' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Chạy quá tải');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCost.mock.calls[0][1]).toMatchObject({ costType: 'OTHER', costGroup: 'DRIVER_ROAD', feeName: 'Chạy quá tải', amount: 200000 });
    expect(api.createIncidentalCost.mock.calls[0][1].invoiceNumber).toBeUndefined();
  });

  it('distinguishes company-paid money and documents agreed shift allowance without adding an extra', async () => {
    setup(); await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' }));
    await choose('Lưu ca');
    fireEvent.click(screen.getByRole('button', { name: /Người chi/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Công ty đã trả' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCost.mock.calls[0][1]).toMatchObject({ payerKind: 'COMPANY', costType: 'OTHER', feeNormCode: 'SHIFT', feeName: 'Lưu ca', amount: 200000 });
  });

  it('uses a configured custom fee and amount while preserving its authoritative code', async () => {
    api.getFeeNorms.mockResolvedValue({ items: [{ code: 'CUSTOM_HARBOR', label: 'Phụ cấp bãi kiểm thử mới', amount: '73000' }] });
    setup(); await open(); fireEvent.click(screen.getByRole('tab', { name: 'Tiền đường' })); await choose('Phụ cấp bãi kiểm thử mới');
    expect(screen.getByLabelText(/Thực chi/)).toHaveValue(73000);
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '75000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledOnce());
    expect(api.createIncidentalCost.mock.calls[0][1]).toMatchObject({ feeNormCode: 'CUSTOM_HARBOR', amount: 75000, costGroup: 'DRIVER_ROAD' });
  });

  it('keeps manual entry available and exposes retry when norms fail to load', async () => {
    api.getFeeNorms.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [] });
    setup(); await open(); expect(await screen.findByText(/Không tải được định mức tiền đường/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại định mức' }));
    await waitFor(() => expect(api.getFeeNorms).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledOnce());
    expect(api.createIncidentalCost.mock.calls[0][1]).not.toHaveProperty('feeNormCode');
  });

  it('retries the same failed save with the same key and retained input', async () => {
    api.createIncidentalCost.mockRejectedValueOnce(new Error('Mất phản hồi')).mockResolvedValueOnce(entry);
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '123000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất phản hồi');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(api.createIncidentalCost).toHaveBeenCalledTimes(2));
    expect(api.createIncidentalCost.mock.calls[0][2]).toBe(api.createIncidentalCost.mock.calls[1][2]);
  });

  it('blocks a repeated click while a save is unresolved', async () => {
    api.createIncidentalCost.mockReturnValue(new Promise(() => {}));
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '50000' } });
    const save = screen.getByRole('button', { name: 'Lưu chi phí' });
    fireEvent.click(save); fireEvent.click(save);
    expect(api.createIncidentalCost).toHaveBeenCalledTimes(1);
  });

  it('keeps the amount when receipt upload fails and allows retry', async () => {
    api.uploadReceiptPhoto.mockRejectedValueOnce(new Error('Ảnh chưa tải')).mockResolvedValueOnce({ storageKey: 'receipt.png' });
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '35000' } });
    const file = new File(['photo'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ảnh chưa tải');
    expect((screen.getByLabelText(/Thực chi/) as HTMLInputElement).value).toBe('35000');
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại ảnh' }));
    await screen.findByAltText('Biên lai đã chọn');
    expect(api.uploadReceiptPhoto.mock.calls[1][0].file).toBe(file);
    expect(api.createIncidentalCost).not.toHaveBeenCalled();
  });

  it('does not autosave notes and explicitly stores the correct trip note once', async () => {
    setup(); await screen.findByText('Chưa có chi phí phát sinh nào.');
    fireEvent.change(screen.getByLabelText('Ghi chú cho kế toán'), { target: { value: 'Kiểm tra phí cầu đường' } });
    expect(api.updateCostSubmissionNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ghi chú' }));
    await waitFor(() => expect(api.updateCostSubmissionNote).toHaveBeenCalledWith(42, 'Kiểm tra phí cầu đường'));
  });

  it('attempts the actual business request even when the browser connectivity hint is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    api.createIncidentalCost.mockRejectedValue(new Error('Máy chủ chưa trả lời'));
    setup(); await open();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '99000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await screen.findByText('Máy chủ chưa trả lời');
    expect(api.createIncidentalCost).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Thực chi/)).toHaveValue(99000);
    window.dispatchEvent(new Event('online'));
    expect(api.createIncidentalCost).toHaveBeenCalledTimes(1);
  });

  it('keeps cancelled/locked trip expenses read-only', async () => {
    api.listIncidentalCosts.mockResolvedValue([entry]);
    setup({ readOnly: true });
    await screen.findByText('Nâng container');
    expect(screen.queryByRole('button', { name: 'Thêm chi phí' })).toBeNull();
    expect(screen.getByLabelText('Ghi chú cho kế toán')).toBeDisabled();
  });
  it('does not claim there are no costs when the list read fails and recovers explicitly', async () => {
    api.listIncidentalCosts.mockRejectedValueOnce(new Error('Không tải được chi phí QA'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được chi phí QA');
    expect(screen.queryByText('Chưa có chi phí phát sinh nào.')).toBeNull();
    api.listIncidentalCosts.mockResolvedValue([entry]);
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
    expect(await screen.findByText('Nâng container')).toBeTruthy();
    expect(screen.queryByText('Không tải được chi phí QA')).toBeNull();
    expect(api.createIncidentalCost).not.toHaveBeenCalled();
  });

});
