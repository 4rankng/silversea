// SIL-966 — KB §8.1.3: the Ops "Khai báo chi phí" form must refuse to save a
// fee of the nâng / hạ / Lưu-cont kinds ("Phí nâng/hạ theo vùng" in the QA
// repro) without a receipt photo: the Ảnh-chứng-từ cell carries the * while
// the row's type demands it, Lưu stays dead with the KB message beside it,
// and the photo upload reopens the save. Other fee kinds keep the
// optional-photo path exactly as before. Mock harness mirrors
// OpsExpenseCatalogRecovery.test.tsx (opsClient mock + null auth).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsExpenseRow, OpsOrderItem } from '../../api/opsClient';
import { OpsExpenseFormModal } from './OpsExpenseFormModal';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), uploadExpensePhoto: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
vi.mock('../../lib/imageCompression', () => ({ compressImageFile: async (file: File) => file }));
vi.mock('../../lib/api/photo', () => ({ useAuthedPhotoUrls: () => [] }));
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));

const types = {
  items: [
    { id: 1, code: 'ZONE_SURCHARGE', name: 'Phí nâng/hạ theo vùng', requiresInvoice: false, category: 'ZONE_SURCHARGE' },
    { id: 2, code: 'FEE_CLEANING', name: 'Vệ sinh container', requiresInvoice: false, category: 'PHAT_SINH' },
  ],
};
const KB_MESSAGE = 'Ảnh chứng từ là bắt buộc với phí nâng, phí hạ và lưu cont.';
const order: OpsOrderItem = { id: 8, shipmentCode: 'QA3C-2411-02', status: 'CREATED', tradeDirection: 'IMPORT', billRef: 'BL-966', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null, containerCount: 0, containerNumbers: [], containerIds: [] };
const entry: OpsExpenseRow = { id: 7, shipmentId: 8, shipmentCode: 'QA3C-2411-02', billRef: 'BL-966', containerNumber: null, expenseTypeCode: 'ZONE_SURCHARGE', expenseTypeName: 'Phí nâng/hạ theo vùng', requiresInvoice: false, amount: '20000', paidAt: '2026-11-24', note: null, approvalStatus: 'RECORDED', rejectionReason: null, opsSettlementId: null, hasPhoto: false, paidById: 12, paidByName: 'Giao nhận', createdAt: '2026-11-24T00:00:00Z', version: 1 };

function show(edit = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>{edit ? <OpsExpenseEditModal entry={entry} onClose={close} /> : <OpsExpenseFormModal order={order} onClose={close} />}</ToastProvider></MemoryRouter></QueryClientProvider>);
  return { client, close };
}

async function chooseFee(label: string) {
  // The type trigger is `disabled={!typesReady}` until the catalog lands —
  // wait for the gate, then open the plain click-to-open list (containers
  // cluster's chooseType contract).
  const trigger = screen.getByRole('button', { name: /Loại phí/ });
  await waitFor(() => expect(trigger).toBeEnabled());
  await act(async () => { fireEvent.click(trigger); });
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

function attachPhoto(name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'image/jpeg' })] } });
}

describe('SIL-966 — phí nâng/hạ/Lưu cont bắt buộc ảnh chứng từ trên form khai chi phí', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.role = null;
    api.getExpenseTypes.mockResolvedValue(types);
    api.getExpensePhotos.mockResolvedValue({ items: [] });
    api.getContainerClaimants.mockResolvedValue([]);
    api.createExpense.mockResolvedValue(entry);
    api.updateExpense.mockResolvedValue(entry);
    api.uploadExpensePhoto.mockResolvedValue({ storageKey: 'ops-expense-photos/12/aaaa.jpg', url: '/api/photos/aaaa.jpg' });
  });

  it('the QA repro row (Phí nâng/hạ theo vùng, no photo) blocks Lưu with the KB message and the * caption', async () => {
    const { client } = show();
    await chooseFee('Phí nâng/hạ theo vùng');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '20000' } });

    expect(screen.getByText('Ảnh chứng từ *')).toBeTruthy();
    expect(screen.getAllByText(KB_MESSAGE).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(api.createExpense).not.toHaveBeenCalled();
    client.clear();
  });

  it('attaching the receipt photo reopens Lưu for the same row', async () => {
    const { client, close } = show();
    await chooseFee('Phí nâng/hạ theo vùng');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '20000' } });
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();

    attachPhoto('bien-lai.jpg');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled());
    expect(screen.getByText('Ảnh chứng từ * (1)')).toBeTruthy();
    expect(screen.queryByText(KB_MESSAGE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'ZONE_SURCHARGE', amount: '20000', photoStorageKeys: ['ops-expense-photos/12/aaaa.jpg'] });
    client.clear();
  });

  it('a fee outside the photo law (Vệ sinh container) keeps its optional-photo path', async () => {
    const { client, close } = show();
    await chooseFee('Vệ sinh container');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '50000' } });

    expect(screen.getByText('Ảnh chứng từ', { exact: true })).toBeTruthy();
    expect(screen.queryByText(KB_MESSAGE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'FEE_CLEANING', amount: '50000' });
    client.clear();
  });

  it('the edit modal refuses to re-save a photo-less row of a photo-required kind until evidence exists', async () => {
    const { client } = show(true);
    await screen.findByRole('dialog', { name: /Sửa khoản chi/ });
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'SIL-966 test' } });

    expect(screen.getByText('Ảnh biên lai (0) *')).toBeTruthy();
    expect(screen.getAllByText(KB_MESSAGE).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(api.updateExpense).not.toHaveBeenCalled();
    client.clear();
  });

  it('the edit modal reopens Lưu once the receipt photo exists', async () => {
    api.getExpensePhotos.mockResolvedValue({ items: [{ id: 91, storageKey: 'ops-expense-photos/12/aaaa.jpg', url: '/api/photos/aaaa.jpg' }] });
    const { client, close } = show(true);
    await screen.findByRole('dialog', { name: /Sửa khoản chi/ });
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'SIL-966 test' } });

    expect(screen.getByText('Ảnh biên lai (1) *')).toBeTruthy();
    expect(screen.queryByText(KB_MESSAGE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.updateExpense).toHaveBeenCalledWith(7, expect.objectContaining({ reason: 'SIL-966 test', expectedVersion: 1 }));
    client.clear();
  });
});
