// SIL-1240 (K5.34 — KB Ch.5 §5.4.5) — the Ops "Khai báo chi phí" popup opens
// its Số tiền cell at the 1.000.000 default. QA 28/11 saw 0 right after
// picking a fee type; the law says the default is 1,000,000. The untouched
// default stays a placeholder row (never saves, never blocks Lưu) via
// isEmptyDraft — only a picked type turns it into the real 1.000.000 record.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import type { OpsOrderItem } from '../../api/opsClient';
import { OpsExpenseFormModal } from './OpsExpenseFormModal';

const api = vi.hoisted(() => ({ getExpenseTypes: vi.fn(), getExpensePhotos: vi.fn(), getContainerClaimants: vi.fn(), checkExpenseDuplicates: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), createExpenseType: vi.fn() }));
vi.mock('../../api/opsClient', () => ({ opsClient: api }));

const types = { items: [
  { id: 4, code: 'CONG_NHAN', name: 'Chi công nhân', requiresInvoice: false },
  { id: 5, code: 'SUA_TO_KHAI', name: 'Sửa tờ khai', requiresInvoice: false },
] };

const order: OpsOrderItem = {
  id: 8, shipmentCode: 'SHP-20260923-0028', status: 'IN_PROGRESS', tradeDirection: 'IMPORT',
  billRef: 'YMLU8923410', customerName: 'Khách hàng', routeName: 'Hải Phòng', pinned: false, pinnedAt: null,
  containerCount: 2, containerNumbers: ['TGHU1234567', 'TGHU7654321'], containerIds: [33, 44],
};

const entry = { id: 7, shipmentId: 8, shipmentCode: order.shipmentCode, billRef: order.billRef, containerNumber: null, expenseTypeCode: 'CONG_NHAN', expenseTypeName: 'Chi công nhân', requiresInvoice: false, amount: '1000000', paidAt: '2026-09-23', note: null as string | null, approvalStatus: 'RECORDED', rejectionReason: null as string | null, opsSettlementId: null as number | null, hasPhoto: false, paidById: 12, paidByName: 'Ops', createdAt: '2026-09-23T00:00:00Z', version: 1 };

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
  return { client, close };
}

function block(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

async function chooseType(blockName: string, name: string) {
  const trigger = within(block(blockName)).getByRole('button', { name: /Loại phí/ });
  await waitFor(() => expect(trigger).toBeEnabled());
  await act(async () => { fireEvent.click(trigger); });
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getExpenseTypes.mockResolvedValue(types);
  api.getExpensePhotos.mockResolvedValue({ items: [] });
  api.getContainerClaimants.mockResolvedValue([]);
  api.checkExpenseDuplicates.mockResolvedValue({ items: [] });
  api.createExpense.mockResolvedValue(entry);
  api.createExpenseType.mockResolvedValue({ item: types.items[0], created: true });
});

describe('ops expense form — K5.34 default amount (SIL-1240)', { timeout: 20_000 }, () => {
  it('the fresh Số tiền cell opens at 1.000.000, not the "0" placeholder', async () => {
    await show();
    expect(screen.getByLabelText(/Số tiền \(VNĐ\)/)).toHaveValue('1.000.000');
  });

  it('the untouched default row stays a placeholder — no premature error, footer still names the empty state', async () => {
    await show();
    // Placeholder semantics: an all-untouched row never paints the row error
    // and Lưu's footer still says nothing was filled. The footer reason only
    // renders once the catalog gate (typesReady) opens — await it.
    expect(screen.queryByText('Chọn "Loại phí".')).toBeNull();
    expect(await screen.findByText(/Chưa điền khoản chi nào/)).toBeTruthy();
  });

  it('picking the fee type saves 1.000.000 without touching the amount', async () => {
    await show();
    await chooseType('Phí không hóa đơn', 'Chi công nhân');
    const save = screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.submit(save.form!);
    await vi.waitFor(() => expect(api.createExpense).toHaveBeenCalledTimes(1));
    expect(api.createExpense.mock.calls[0][0]).toMatchObject({ expenseTypeCode: 'CONG_NHAN', amount: '1000000' });
  });
});
