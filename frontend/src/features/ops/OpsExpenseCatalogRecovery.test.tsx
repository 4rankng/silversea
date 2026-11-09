import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsExpenseRow, OpsOrderItem } from '../../api/opsClient';
import { OpsExpenseFormModal } from './OpsExpenseFormModal';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
// SIL-761 — same role mock contract as the containers cluster: null default
// keeps the non-Ops view for every pre-761 case; Ops cases flip it.
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));
const types = { items: [{ id: 1, code: 'HANDLING', name: 'Làm hàng', requiresInvoice: false }] };
const order: OpsOrderItem = { id: 8, shipmentCode: 'OPS-RECOVERY', status: 'CREATED', tradeDirection: 'IMPORT', billRef: 'BL-RECOVERY', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null, containerCount: 0, containerNumbers: [], containerIds: [] };
const entry: OpsExpenseRow = { id: 7, shipmentId: 8, shipmentCode: 'OPS-RECOVERY', billRef: 'BL-RECOVERY', containerNumber: null, expenseTypeCode: 'HANDLING', expenseTypeName: 'Làm hàng', requiresInvoice: false, amount: '100000', paidAt: '2026-09-17', note: 'Nội dung cũ', approvalStatus: 'RECORDED', rejectionReason: null, opsSettlementId: null, hasPhoto: false, paidById: 12, paidByName: 'Ops', createdAt: '2026-09-17T00:00:00Z', version: 2 };
function show(edit = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>{edit ? <OpsExpenseEditModal entry={entry} onClose={close} /> : <OpsExpenseFormModal order={order} onClose={close} />}</ToastProvider></MemoryRouter></QueryClientProvider>);
  return { client, close };
}
async function chooseFee() {
  fireEvent.click(screen.getByRole('button', { name: /Loại phí/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Làm hàng' }));
}

// Long interaction chain through the real modal (catalog fail → retry →
// fill → save): the tabs restructure pushed the create path past vitest's
// 5s default, so this cluster carries the explicit deadline like the other
// interaction-chain suites in this repo.
describe('OPS expense catalog failure recovery', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.role = null;
    api.getExpensePhotos.mockResolvedValue({ items: [] });
    api.getContainerClaimants.mockResolvedValue([]);
    api.createExpense.mockResolvedValue(entry);
    api.updateExpense.mockResolvedValue(entry);
  });
  it.each([false, true])('retains draft and retries the catalog without submitting (edit=%s)', async edit => {
    api.getExpenseTypes.mockRejectedValueOnce(new Error('Catalog unavailable')).mockResolvedValue(types);
    const { client, close } = show(edit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh mục loại phí');
    // Create rows carry the SIL-760 spec label "Số tiền (VNĐ)"; the edit
    // modal keeps its own "Thực chi (VND)" wording (not in ticket scope).
    fireEvent.change(screen.getByLabelText(edit ? /Thực chi/ : /Số tiền \(VNĐ\)/), { target: { value: '125000' } });
    fireEvent.change(screen.getByLabelText('Ghi chú', { exact: true }), { target: { value: 'Giữ bản đang nhập' } });
    if (edit) fireEvent.change(screen.getByLabelText(/Lý do điều chỉnh/), { target: { value: 'Sửa số thực chi' } });
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(api.createExpense).not.toHaveBeenCalled();
    expect(api.updateExpense).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại loại phí' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText(edit ? /Thực chi/ : /Số tiền \(VNĐ\)/)).toHaveValue('125.000');
    expect(screen.getByLabelText('Ghi chú', { exact: true })).toHaveValue('Giữ bản đang nhập');
    expect(close).not.toHaveBeenCalled();
    if (!edit) await chooseFee();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    if (edit) expect(api.updateExpense).toHaveBeenCalledWith(7, expect.objectContaining({ amount: '125000', note: 'Giữ bản đang nhập', reason: 'Sửa số thực chi', expectedVersion: 2 }));
    else expect(api.createExpense.mock.calls[0][0]).toMatchObject({ amount: '125000', note: 'Giữ bản đang nhập', expenseTypeCode: 'HANDLING' });
    client.clear();
  });
  it('distinguishes an empty catalog from a failed request and disables save', async () => {
    api.getExpenseTypes.mockResolvedValue({ items: [] });
    const { client } = show();
    expect(await screen.findByText(/Chưa có loại phí đang sử dụng/)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử tải lại loại phí' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(api.createExpense).not.toHaveBeenCalled();
    client.clear();
  });
  it('SIL-761 — an Ops editor of an own no-invoice row sees no thu-khách fields', async () => {
    authState.role = 'OPS';
    api.getExpenseTypes.mockResolvedValue(types);
    const { client } = show(true);
    await screen.findByRole('dialog', { name: /Sửa khoản chi/ });
    expect(screen.queryByLabelText('Thực thu (thu khách)')).toBeNull();
    expect(screen.queryByLabelText('Ghi chú thu khách')).toBeNull();
    expect(screen.queryByText(/Thực thu/)).toBeNull();
    client.clear();
  });
  it('SIL-761 — a non-Ops editor keeps the thu-khách fields', async () => {
    api.getExpenseTypes.mockResolvedValue(types);
    const { client } = show(true);
    expect(await screen.findByLabelText('Thực thu (thu khách)')).toBeInTheDocument();
    expect(screen.getByLabelText('Ghi chú thu khách')).toBeInTheDocument();
    client.clear();
  });
});
