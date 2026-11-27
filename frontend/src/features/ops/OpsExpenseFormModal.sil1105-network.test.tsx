// SIL-1105 (K2.161) — the lot cost dialog's save catch used to print the raw
// engine English ('NetworkError when attempting to fetch resource.') when the
// machine was offline: the request never left, nothing saved, and the driver
// of the error was a browser TypeError, not a server reason. The catch now
// routes through the site's single mapping (actionErrorMessage, SIL-1035's
// law) so a fetch/network TypeError becomes the one offline sentence, while
// SIL-1101's invoice-conflict 400 (a REAL server refusal) stays verbatim.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsOrderItem } from '../../api/opsClient';
import { ApiError } from '../../lib/api/errors';
import { OpsExpenseFormModal } from './OpsExpenseFormModal';

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), checkExpenseDuplicates: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));
const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role == null ? null : { role: authState.role } }) }));

const types = { items: [
  { id: 1, code: 'SOI_CHIEU', name: 'Phí soi chiếu', requiresInvoice: true },
  { id: 2, code: 'KIEM_HOA', name: 'Phí kiểm hóa', requiresInvoice: true },
  { id: 3, code: 'BOC_XEP', name: 'Bốc xếp hàng', requiresInvoice: true },
  { id: 4, code: 'CONG_NHAN', name: 'Chi công nhân', requiresInvoice: false },
  { id: 5, code: 'SUA_TO_KHAI', name: 'Sửa tờ khai', requiresInvoice: false },
  { id: 6, code: 'NANG_VO', name: 'Phí nâng vỏ', requiresInvoice: false },
  { id: 7, code: 'HA_VO', name: 'Phí hạ vỏ', requiresInvoice: false },
] };

const order: OpsOrderItem = {
  id: 8, shipmentCode: 'SHP-20260923-0028', status: 'IN_PROGRESS', tradeDirection: 'IMPORT',
  billRef: 'YMLU8923410', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null,
  containerCount: 1, containerNumbers: ['TGHU1234567'], containerIds: [33],
};

beforeEach(() => {
  vi.resetAllMocks();
  authState.role = 'OPS';
  api.getExpenseTypes.mockResolvedValue(types);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.getContainerClaimants.mockResolvedValue([]);
  api.checkExpenseDuplicates.mockResolvedValue({ items: [] });
  api.createExpense.mockResolvedValue({ id: 7 });
  api.createExpenseType.mockResolvedValue({ item: types.items[0], created: true });
});

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OpsExpenseFormModal order={order} onClose={close} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('tab', { name: 'PHÍ KHÔNG HÓA ĐƠN' });
}

async function fillOneNoInvoiceRow() {
  const row = screen.getByRole('region', { name: 'Khoản 1' });
  await waitFor(() => {
    const control = within(row).queryByRole('combobox')
      ?? within(row).queryByRole('button', { name: /Loại phí/ });
    expect(control).toBeEnabled();
  });
  const combo = within(row).queryByRole('combobox');
  if (combo) {
    await act(async () => { combo.focus(); fireEvent.click(combo); });
    fireEvent.click(await screen.findByRole('option', { name: 'Chi công nhân' }));
  } else {
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: /Loại phí/ })); });
    fireEvent.click(await screen.findByRole('option', { name: 'Chi công nhân' }));
  }
  fireEvent.change(within(row).getByLabelText(/Số tiền \(VNĐ\)/), { target: { value: '250000' } });
}

async function submitSave() {
  fireEvent.submit((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).form!);
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
}

describe('SIL-1105 — offline save shows the Vietnamese offline sentence, never engine English', () => {
  it('maps a fetch TypeError to the save sentence that says it did NOT save', { timeout: 20_000 }, async () => {
    api.createExpense.mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'));
    await show();
    await fillOneNoInvoiceRow();
    await submitSave();

    const alert = screen.getByRole('alert');
    // KB §2.5.1 K2.161 — say what did NOT happen and when to retry.
    expect(alert).toHaveTextContent('Mất kết nối, chưa lưu được.');
    expect(alert).toHaveTextContent('thử lại khi có mạng');
    expect(alert.textContent).not.toContain('NetworkError when attempting to fetch resource.');
  });

  it('maps Chrome\'s "Failed to fetch" the same way', { timeout: 20_000 }, async () => {
    api.createExpense.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await show();
    await fillOneNoInvoiceRow();
    await submitSave();

    expect(screen.getByRole('alert'))
      .toHaveTextContent('Mất kết nối, chưa lưu được. Giữ nguyên nội dung và thử lại khi có mạng.');
  });
});

describe('SIL-1101 — a real server invoice-conflict 400 keeps its verbatim message', () => {
  it('shows the server sentence naming the conflicting lot/trip inline', { timeout: 20_000 }, async () => {
    api.createExpense.mockRejectedValueOnce(new ApiError(
      400,
      { code: 'EXPENSE_INVOICE_NUMBER_CONFLICT', conflict: { invoiceNumber: 'QA-R2F2-119', shipmentId: 548, shipmentCode: 'LOT-548', tripId: 151, tripCode: 'TC-151' } },
      'Số hóa đơn QA-R2F2-119 đã tồn tại trên lô LOT-548, chuyến TC-151.',
    ));
    await show();
    await fillOneNoInvoiceRow();
    await submitSave();

    expect(screen.getByRole('alert')).toHaveTextContent('Số hóa đơn QA-R2F2-119 đã tồn tại trên lô LOT-548, chuyến TC-151.');
  });
});
