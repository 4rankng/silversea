import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const api = vi.hoisted(() => ({ listIncidentalCosts: vi.fn(), createIncidentalCost: vi.fn(), createIncidentalCosts: vi.fn(), uploadReceiptPhoto: vi.fn(), updateCostSubmissionNote: vi.fn(), getFeeNorms: vi.fn() }));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));
import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

function setup(props: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShipmentCostEntryForm tripId={42} totalRoadAllowance={null} {...props} /></QueryClientProvider>);
}
async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí' }));
}
async function chooseEvidence(index: number, label: 'Hóa đơn' | 'Phiếu thu') {
  // Card 141026230700 — Hóa đơn / Phiếu thu are two small toggle buttons, one
  // pair per draft row (no dropdown trigger anymore).
  fireEvent.click(screen.getAllByRole('button', { name: label })[index]);
}

// Step 2 (Loại chứng từ Hóa đơn / Phiếu thu) + step 3 (draft table saved in one
// all-or-nothing batch). Sibling behaviour (payer removal, locked system rows)
// is pinned in ShipmentCostEntryForm.test.tsx.
describe('driver cost draft table — evidence kind + all-or-nothing batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidentalCosts.mockResolvedValue([]);
    api.getFeeNorms.mockResolvedValue({ items: [] });
    api.createIncidentalCosts.mockResolvedValue({ items: [] });
    api.uploadReceiptPhoto.mockResolvedValue({ storageKey: 'receipt.png', url: 'blob:receipt' });
    api.updateCostSubmissionNote.mockResolvedValue({});
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('Phiếu thu: the save stays disabled until the biên lai photo exists, and the payload carries evidenceKind', async () => {
    setup(); await openForm();
    // Default is "Phiếu thu" (most lot costs are cash with no VAT invoice);
    // card 141026230700 removed the typed invoice pair entirely — the photo is
    // the evidence for EVERY lot cost, whatever the tick says.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '500000' } });

    // The reminder is the existing requiresReceipt mechanism — one rule, one
    // testid — carrying the chiphispec §2 wording for every spending lot cost.
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).toBeDisabled();
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Chụp biên lai cho khoản có chi phí.');

    const file = new File(['photo'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [file] } });
    await screen.findByText('Ảnh sẽ gắn với khoản chi này');
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1]).toHaveLength(1);
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ evidenceKind: 'RECEIPT', amount: 500000, receiptStorageKey: 'receipt.png' });
  });

  it('Hóa đơn: no invoice fields mount, the photo is still mandatory, and only the kind rides the payload', async () => {
    setup(); await openForm();
    await chooseEvidence(0, 'Hóa đơn');
    // Card 141026230700 — the driver surface lost Số/Ngày hóa đơn; the tick is
    // data for kế toán phơi phiếu and the biên lai photo is the paper.
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    expect(screen.queryByLabelText('Ngày hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Thực chi/), { target: { value: '500000' } });
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chọn ảnh biên lai'), { target: { files: [new File(['photo'], 'receipt.png', { type: 'image/png' })] } });
    await screen.findByText('Ảnh sẽ gắn với khoản chi này');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ evidenceKind: 'INVOICE', amount: 500000, receiptStorageKey: 'receipt.png' });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceDate).toBeUndefined();
  });

  it('two draft rows save as ONE batch call carrying both items', async () => {
    setup(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    expect(screen.getAllByRole('group', { name: 'Loại chứng từ' })).toHaveLength(2);
    // Both rows are lot costs, so both need their biên lai before the batch
    // opens; the batch rule itself is what is under test here.
    await chooseEvidence(0, 'Hóa đơn');
    await chooseEvidence(1, 'Phiếu thu');
    const amounts = screen.getAllByLabelText(/Thực chi/);
    fireEvent.change(amounts[0], { target: { value: '50000' } });
    fireEvent.change(amounts[1], { target: { value: '70000' } });
    // One upload at a time (the hook's operation lock) — row 1's photo must
    // land before row 2's starts, exactly like a real tap sequence.
    fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[0], { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    await screen.findAllByText('Ảnh sẽ gắn với khoản chi này');
    fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[1], { target: { files: [new File(['photo'], 'b.png', { type: 'image/png' })] } });
    await screen.findAllByText('Ảnh sẽ gắn với khoản chi này');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (2 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1]).toHaveLength(2);
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: 50000 });
    expect(api.createIncidentalCosts.mock.calls[0][1][1]).toMatchObject({ amount: 70000 });
  });

  it('one invalid row blocks the whole batch and the error names that row number', async () => {
    setup(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    await chooseEvidence(0, 'Hóa đơn');
    await chooseEvidence(1, 'Phiếu thu');
    const amounts = screen.getAllByLabelText(/Thực chi/);
    fireEvent.change(amounts[0], { target: { value: '50000' } });
    // Row 2 is the empty one (0) — nothing may be written for row 1 either.
    fireEvent.change(amounts[1], { target: { value: '0' } });
    // One upload at a time (the hook's operation lock) — row 1's photo must
    // land before row 2's starts, exactly like a real tap sequence.
    fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[0], { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    await screen.findAllByText('Ảnh sẽ gắn với khoản chi này');
    fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[1], { target: { files: [new File(['photo'], 'b.png', { type: 'image/png' })] } });
    await screen.findAllByText('Ảnh sẽ gắn với khoản chi này');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (2 dòng)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dòng 2:');
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  it('saved rows carry an evidence caption; legacy rows (evidence_kind NULL) are never backfilled', async () => {
    api.listIncidentalCosts.mockResolvedValue([
      { id: 1, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.LIFT_FEE, costGroup: 'DRIVER_SHIPMENT', feeName: 'Nâng container', amount: '500000', occurredAt: '2026-09-16', note: null, receiptStorageKey: null, evidenceKind: 'INVOICE', invoiceNumber: 'HD-101', invoiceDate: null, createdAt: '2026-09-16T02:00:00Z' },
      { id: 2, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.CONTAINER_WASH, costGroup: 'DRIVER_SHIPMENT', feeName: 'Phí vệ sinh', amount: '50000', occurredAt: '2026-09-16', note: null, receiptStorageKey: null, evidenceKind: 'INVOICE', invoiceNumber: null, invoiceDate: null, createdAt: '2026-09-16T02:00:00Z' },
      { id: 3, tripId: 42, driverId: 7, costType: DriverIncidentalCostType.TOLL, costGroup: 'DRIVER_ROAD', feeName: 'Vé cầu đường', amount: '30000', occurredAt: '2026-09-16', note: null, receiptStorageKey: null, evidenceKind: null, invoiceNumber: null, invoiceDate: null, createdAt: '2026-09-16T02:00:00Z' },
    ]);
    setup();
    // Card 141026230700 — drivers no longer type invoice numbers: a Hóa đơn
    // row with a legacy number still shows it; without one it names its kind.
    expect(await screen.findByText('HĐ HD-101')).toBeTruthy();
    expect(screen.getByText('Hóa đơn')).toBeTruthy();
    expect(screen.getByText('Chưa phân loại chứng từ')).toBeTruthy();
  });
});
