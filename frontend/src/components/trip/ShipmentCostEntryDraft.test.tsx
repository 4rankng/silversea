import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const api = vi.hoisted(() => ({ listIncidentalCosts: vi.fn(), createIncidentalCost: vi.fn(), createIncidentalCosts: vi.fn(), uploadReceiptPhoto: vi.fn(), updateCostSubmissionNote: vi.fn() }));
vi.mock('../../api/driverClient', () => ({ driverClient: api }));
import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

function setup(props: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ShipmentCostEntryForm tripId={42} totalRoadAllowance={null} {...props} /></QueryClientProvider>);
}
async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí' }));
}
async function chooseRowOption(index: number, label: string) {
  // SIL-759 — each row is one horizontal line; the fee dropdown is the row's
  // first control and the ONLY kind picker left (the evidence ticks are gone).
  fireEvent.click(screen.getAllByRole('combobox', { name: 'Tên chi phí' })[index]);
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
async function attachReceipt(index: number, name: string) {
  fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[index], { target: { files: [new File(['photo'], name, { type: 'image/png' })] } });
  await screen.findAllByText('Đã đính kèm biên lai.');
}

// Step 3 (draft table saved in one all-or-nothing batch) + SIL-759 derived
// evidence kinds. Sibling behaviour (payer removal, locked system rows, the
// road tạm tính band) is pinned in ShipmentCostEntryForm.test.tsx.
describe('driver cost draft table — derived evidence kind + all-or-nothing batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listIncidentalCosts.mockResolvedValue([]);
    api.createIncidentalCosts.mockResolvedValue({ items: [] });
    api.uploadReceiptPhoto.mockResolvedValue({ storageKey: 'receipt.png', url: 'blob:receipt' });
    api.updateCostSubmissionNote.mockResolvedValue({});
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('SIL-759: the invoiced default fee (Phí nâng) derives INVOICE from the catalog — no tick exists', async () => {
    setup(); await openForm();
    // Default is "Phiếu thu" (most lot costs are cash with no VAT invoice);
    // card 141026230700 removed the typed invoice pair entirely — the photo is
    // the evidence for the default pick, and SIL-769 keeps that pick (Phí
    // nâng — LIFTING) among the three photo-mandatory fees.
    expect(screen.queryByRole('group', { name: 'Loại chứng từ' })).toBeNull();
    expect(screen.queryByLabelText('Số hóa đơn')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '500000' } });

    // The reminder is the requiresReceipt mechanism — one rule, one testid —
    // carrying the server's SIL-769 wording naming the fee.
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).toBeDisabled();
    expect(screen.getByTestId('shipment-cost-receipt-required').textContent).toBe('Phí nâng phải kèm ảnh biên lai trước khi lưu.');

    await attachReceipt(0, 'receipt.png');
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1]).toHaveLength(1);
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ evidenceKind: 'INVOICE', expenseTypeCode: 'LIFTING', amount: 500000, receiptStorageKey: 'receipt.png' });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceDate).toBeUndefined();
  });

  it('SIL-769 REV2: hàn cont derives RECEIPT from the catalog and saves WITHOUT a photo', async () => {
    // SIL-759 keeps the catalog derivation (CONTAINER_WELD is catalog
    // no-invoice ⇒ RECEIPT). SIL-769 (customer CR-006 2B) narrows the photo
    // mandate to exactly LIFTING/LOWERING/YARD_STORAGE — 'Hàn container' is
    // NOT one of the three photo-mandatory fees, so the row saves WITHOUT a
    // biên lai and never blocks the batch.
    setup(); await openForm();
    await chooseRowOption(0, 'Hàn container');
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '500000' } });
    // Not one of SIL-769's three photo-mandatory fees (LIFTING/LOWERING/
    // YARD_STORAGE) — the row saves immediately, no biên lai reminder.
    expect(screen.queryByTestId('shipment-cost-receipt-required')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (1 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ evidenceKind: 'RECEIPT', expenseTypeCode: 'CONTAINER_WELD', amount: 500000 });
    expect(api.createIncidentalCosts.mock.calls[0][1][0].receiptStorageKey).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceNumber).toBeUndefined();
    expect(api.createIncidentalCosts.mock.calls[0][1][0].invoiceDate).toBeUndefined();
  });

  it('two draft rows save as ONE batch call carrying both items with their own derived kinds', async () => {
    setup(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    expect(screen.getAllByRole('combobox', { name: 'Tên chi phí' })).toHaveLength(2);
    // Row 1 keeps the invoiced default (Phí nâng → INVOICE); row 2 picks a
    // no-invoice fee (Đảo vỏ → RECEIPT). Choosing an option RESETS that row's
    // amount (option.amount ?? ''), so amounts come AFTER the picks.
    await chooseRowOption(1, 'Đảo vỏ');
    const amounts = screen.getAllByLabelText(/Số tiền/);
    fireEvent.change(amounts[0], { target: { value: '50000' } });
    fireEvent.change(amounts[1], { target: { value: '70000' } });
    // One upload at a time (the hook's operation lock) — row 1's photo must
    // land before row 2's starts, exactly like a real tap sequence.
    await attachReceipt(0, 'a.png');
    await attachReceipt(1, 'b.png');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (2 dòng)' }));
    await waitFor(() => expect(api.createIncidentalCosts).toHaveBeenCalledTimes(1));
    expect(api.createIncidentalCosts.mock.calls[0][1]).toHaveLength(2);
    expect(api.createIncidentalCosts.mock.calls[0][1][0]).toMatchObject({ amount: 50000, evidenceKind: 'INVOICE' });
    expect(api.createIncidentalCosts.mock.calls[0][1][1]).toMatchObject({ amount: 70000, evidenceKind: 'RECEIPT', feeName: 'Đảo vỏ' });
  });

  it('one invalid row blocks the whole batch and the error names that row number', async () => {
    setup(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    const amounts = screen.getAllByLabelText(/Số tiền/);
    fireEvent.change(amounts[0], { target: { value: '50000' } });
    // Row 2 is the empty one (0) — nothing may be written for row 1 either.
    fireEvent.change(amounts[1], { target: { value: '0' } });
    // One upload at a time (the hook's operation lock) — row 1's photo must
    // land before row 2's starts, exactly like a real tap sequence.
    await attachReceipt(0, 'a.png');
    await attachReceipt(1, 'b.png');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu tất cả (2 dòng)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dòng 2:');
    expect(api.createIncidentalCosts).not.toHaveBeenCalled();
  });

  it('SIL-759: removing the first draft row shifts the upload retry block with its row', async () => {
    setup(); await openForm();
    fireEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    // Row 1's upload FAILS — its retry block belongs to that row.
    api.uploadReceiptPhoto.mockRejectedValueOnce(new Error('Ảnh chưa tải'));
    fireEvent.change(screen.getAllByLabelText('Chọn ảnh biên lai')[0], { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    expect(await screen.findByText('a.png · Chưa tải thành công')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 1' }));
    // Dropping the row drops its retry block; the surviving row is the old row 2.
    expect(screen.queryByText('a.png · Chưa tải thành công')).toBeNull();
    expect(screen.getAllByRole('combobox', { name: 'Tên chi phí' })).toHaveLength(1);
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
