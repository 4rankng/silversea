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

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), checkExpenseDuplicates: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), uploadExpensePhoto: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
vi.mock('../../lib/imageCompression', () => ({ compressImageFile: async (file: File) => file }));
vi.mock('../../lib/api/photo', () => ({ useAuthedPhotoUrls: () => [] }));
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));

const types = {
  items: [
    // QA FAIL 04:05 25/11 (build 9a96af4a) — production truth: the ladder
    // classifies "Phí nâng/hạ theo vùng" PHAT_SINH (settlement bucket, card
    // 20260919_3) and the fill-only seed never rewrites it, so the live row
    // NEVER carries category 'ZONE_SURCHARGE'. The gate must fire on the
    // structural CODE.
    { id: 1, code: 'ZONE_SURCHARGE', name: 'Phí nâng/hạ theo vùng', requiresInvoice: false, category: 'PHAT_SINH' },
    // The category axis still fires on its own — an admin-reclassified row
    // (ForwarderExpenseTypesConfigPage offers 'Phụ phí vùng') or any custom
    // code under a LIFT/DROP/ZONE_SURCHARGE category.
    { id: 3, code: 'ZONE_HN', name: 'Phí nâng/hạ theo vùng (miền Bắc)', requiresInvoice: false, category: 'ZONE_SURCHARGE' },
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

describe('Ops expense form — receipt photo is optional for all fee types', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.role = null;
    api.getExpenseTypes.mockResolvedValue(types);
    api.getExpensePhotos.mockResolvedValue({ items: [] });
    api.getContainerClaimants.mockResolvedValue([]);
    api.checkExpenseDuplicates.mockResolvedValue({ items: [] });
    api.createExpense.mockResolvedValue(entry);
    api.updateExpense.mockResolvedValue(entry);
    api.uploadExpensePhoto.mockResolvedValue({ storageKey: 'ops-expense-photos/12/aaaa.jpg', url: '/api/photos/aaaa.jpg' });
  });

  it('allows saving ZONE_SURCHARGE (Phí nâng/hạ theo vùng) without a receipt photo and shows no asterisk', async () => {
    const { client, close } = show();
    await chooseFee('Phí nâng/hạ theo vùng');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '20000' } });

    expect(screen.getByText('Ảnh chứng từ', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Ảnh chứng từ *')).toBeNull();
    expect(screen.queryByText(KB_MESSAGE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'ZONE_SURCHARGE', amount: '20000', photoStorageKeys: [] });
    client.clear();
  });

  it('still allows optional receipt photo upload', async () => {
    const { client, close } = show();
    await chooseFee('Phí nâng/hạ theo vùng');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '20000' } });

    attachPhoto('bien-lai.jpg');
    await waitFor(() => expect(screen.getByText('Ảnh chứng từ (1)')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'ZONE_SURCHARGE', amount: '20000', photoStorageKeys: ['ops-expense-photos/12/aaaa.jpg'] });
    client.clear();
  });

  it('allows saving category ZONE_SURCHARGE without a receipt photo', async () => {
    const { client, close } = show();
    await chooseFee('Phí nâng/hạ theo vùng (miền Bắc)');
    fireEvent.change(screen.getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '30000' } });

    expect(screen.getByText('Ảnh chứng từ', { exact: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    client.clear();
  });

  it('the edit modal allows saving without a receipt photo and shows no asterisk', async () => {
    const { client, close } = show(true);
    await screen.findByRole('dialog', { name: /Sửa khoản chi/ });
    fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Edit without photo' } });

    expect(screen.getByText('Ảnh biên lai (0)')).toBeTruthy();
    expect(screen.queryByText(KB_MESSAGE)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api.updateExpense).toHaveBeenCalledWith(7, expect.objectContaining({ reason: 'Edit without photo', expectedVersion: 1 }));
    client.clear();
  });
});
