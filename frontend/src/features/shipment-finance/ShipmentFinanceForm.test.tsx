import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ options: vi.fn(), saveInvoice: vi.fn(), saveDeposit: vi.fn() }));
vi.mock('../../api/shipmentFinanceClient', () => ({ shipmentFinanceClient: api }));
vi.mock('../../api/shipmentClient', () => ({ listShipments: vi.fn() }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ShipmentFinanceForm } from './ShipmentFinanceForm';

function show(editor: Parameters<typeof ShipmentFinanceForm>[0]['editor']) {
  const saved = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><ShipmentFinanceForm editor={editor} shipmentId={12} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>);
  return saved;
}
const invoice = { id: 5, shipmentId: 12, shipmentCode: 'BL-12', customerName: 'Nhà máy', supplierId: 3, supplierName: 'Hãng tàu', invoiceNumber: 'VAT-16', invoiceDate: '2026-09-16', faceAmount: '1000000', supplierFeeAmount: '50000', sourceExpenseId: null, version: 2, note: null };

describe('shipment finance entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.options.mockResolvedValue({ suppliers: [{ id: 3, name: 'Hãng tàu' }], expenses: [] });
  });
  it('KT-16 keeps invoice face value separate from supplier cost on save', async () => {
    api.saveInvoice.mockResolvedValue({ id: 5 });
    const saved = show({ kind: 'invoice', record: invoice });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.saveInvoice.mock.calls[0][1]).toMatchObject({ faceAmount: 1000000, supplierFeeAmount: 50000, expectedVersion: 2 });
    expect(api.saveDeposit).not.toHaveBeenCalled();
  });
  it('KT-20 retains the draft and command key after ambiguous failure, changes key for a changed payload', async () => {
    api.saveInvoice.mockRejectedValueOnce(new Error('Mất kết nối')).mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValue({ id: 5 });
    const saved = show({ kind: 'invoice', record: invoice });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await screen.findByText('Mất kết nối');
    expect(screen.getByLabelText(/Giá trị hóa đơn \(đ\)/)).toHaveValue('1.000.000'); // grouped display (spec 19/10)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(api.saveInvoice).toHaveBeenCalledTimes(2));
    await screen.findByText('Mất kết nối');
    expect(api.saveInvoice.mock.calls[0][2]).toBe(api.saveInvoice.mock.calls[1][2]);
    fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Bổ sung thông tin' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.saveInvoice.mock.calls[2][2]).not.toBe(api.saveInvoice.mock.calls[1][2]);
  });
  it('KT-18 blocks refund above deposit while preserving both entered amounts', async () => {
    show({ kind: 'deposit', record: { id: 6, shipmentId: 12, shipmentCode: 'BL-12', customerName: 'Nhà máy', billNumber: 'BL-12', shippingLineName: 'MSC', amount: '2000000', recoveredAmount: '500000', outstandingAmount: '1500000', depositDate: '2026-09-16', documentsSubmittedDate: null, refundReceivedDate: '2026-09-18', status: 'PARTIAL', version: 1, note: null } });
    fireEvent.change(screen.getByLabelText(/Đã nhận hoàn \(đ\)/), { target: { value: '2500000' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tiền hoàn không được vượt tiền cược');
    expect(screen.getByLabelText(/Tiền cược \(đ\)/)).toHaveValue('2.000.000'); // grouped display (spec 19/10)
    expect(screen.getByLabelText(/Đã nhận hoàn \(đ\)/)).toHaveValue('2.500.000'); // grouped display (spec 19/10)
    expect(api.saveDeposit).not.toHaveBeenCalled();
  });
});

it('FIX-WS-17: locked deposit preserves principal controls while allowing documentary refund follow-up', () => {
  const cache = new QueryClient();
  render(<QueryClientProvider client={cache}><ShipmentFinanceForm principalLocked shipmentId={12} editor={{ kind: 'deposit', record: { id: 6, shipmentId: 12, shipmentCode: 'BL-12', customerName: 'Customer', billNumber: 'BL-12', shippingLineName: 'MSC', amount: '2000000', recoveredAmount: '0', outstandingAmount: '2000000', depositDate: '2026-09-16', documentsSubmittedDate: null, refundReceivedDate: null, status: 'WAITING_DOCUMENTS', version: 1, note: null } }} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>);
  expect(screen.getByLabelText(/Tiền cược \(đ\)/)).toBeDisabled();
  expect(screen.getByLabelText(/Số Bill/)).toBeDisabled();
  expect(screen.getByLabelText(/Hãng tàu/)).toBeDisabled();
  expect(screen.getByLabelText(/Đã nhận hoàn \(đ\)/)).not.toBeDisabled();
  expect(screen.getByLabelText('Ghi chú')).not.toBeDisabled();
});

// CPB-02 (accountant P0): a cost form mounted before the lot context arrives
// must pick the lot up reactively — the old one-shot useState captured ''
// at mount and never adopted the lot, so the save refused forever with
// 'Chọn lô hàng trước khi lưu.'.
describe('CPB-02 — lot context arrives after mount', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.options.mockResolvedValue({ suppliers: [{ id: 3, name: 'Hãng tàu' }], expenses: [] });
    api.saveDeposit.mockResolvedValue({ id: 9 });
  });
  const fillDepositDraft = () => {
    fireEvent.change(screen.getByLabelText(/Số Bill/), { target: { value: 'BL-44' } });
    fireEvent.change(screen.getByLabelText(/Hãng tàu/), { target: { value: 'MSC' } });
    fireEvent.change(screen.getByLabelText(/Tiền cược \(đ\)/), { target: { value: '2000000' } });
  };
  it('adopts a late-arriving shipmentId instead of refusing forever', async () => {
    // Mount with NO lot context (the create-from-global path), then hand the
    // same mounted form its lot context — the save must target that lot.
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={cache}><ShipmentFinanceForm editor={{ kind: 'deposit' }} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>,
    );
    fillDepositDraft();
    rerender(
      <QueryClientProvider client={cache}><ShipmentFinanceForm editor={{ kind: 'deposit' }} shipmentId={44} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(api.saveDeposit).toHaveBeenCalledTimes(1));
    expect(api.saveDeposit.mock.calls[0][0]).toBe(44);
  });
  it('saves against the panel lot context when no explicit choice was made', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cache}><ShipmentFinanceForm editor={{ kind: 'deposit' }} shipmentId={12} onClose={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>,
    );
    fillDepositDraft();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu hồ sơ' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(api.saveDeposit).toHaveBeenCalledTimes(1));
    expect(api.saveDeposit.mock.calls[0][0]).toBe(12);
  });
});
