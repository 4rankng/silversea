import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry, ExpenseAccountingList } from '@tingting/shared';
const list = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { list, confirm } }));
import { ExpenseBoard } from './ExpenseBoard';

/** Card 20260928_168 AC2 — an approved row keeps status RECORDED and only gains
 *  `confirmedAt`, so a predicate that reads `status` alone re-selects it. The
 *  build then gets one of two user-visible failures: the batch is refused
 *  wholesale with `đã đối chiếu.` (phiếu/reconciliation paths), or the
 *  đối-chiếu button goes dead because an approved row is also `locked`. Both
 *  are the same root cause, so both are pinned here. */
const approved: ExpenseAccountingEntry = {
  sourceKind: 'OPS', sourceId: 2, version: 4, status: 'RECORDED', locked: true,
  feeName: 'Phí đã duyệt', shipmentCode: 'QA-168-A', amount: 400000,
  customerChargeAmount: 400000, expenseDate: '2026-09-20', confirmedAt: '2026-09-21T02:00:00.000Z', confirmedById: 9,
  confirmedByName: 'Kế toán A',
} as ExpenseAccountingEntry;
const pending: ExpenseAccountingEntry = {
  sourceKind: 'OPS', sourceId: 3, version: 1, status: 'RECORDED', locked: false,
  feeName: 'Phí chưa duyệt', shipmentCode: 'QA-168-P', amount: 150000,
  customerChargeAmount: 150000, expenseDate: '2026-09-20', confirmedAt: null, confirmedById: null,
  confirmedByName: null,
} as ExpenseAccountingEntry;

const page: ExpenseAccountingList = {
  items: [approved, pending], total: 2, page: 1, limit: 25, canViewPayments: true,
  unknownReceivableCount: 0, unknownPayableCount: 0,
  totals: { amount: 550000, customerChargeAmount: 550000, receivedAmount: 0, paidAmount: 0, outstandingReceivable: 550000, outstandingPayable: 0 },
};

const catalog = {
  staff: [], accounts: [], accountants: [], opsUsers: [], advances: [], suppliers: [], expenseTypes: [],
};

function show() {
  const onVoucher = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ExpenseBoard
        view="ops"
        filters={{ page: 1, limit: 25 } as never}
        catalog={catalog as never}
        setPage={vi.fn()}
        onEdit={vi.fn()}
        onWork={vi.fn()}
        onVoucher={onVoucher}
        onReconcile={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onVoucher };
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(page);
  confirm.mockReset().mockResolvedValue({ items: [] });
});

it('AC2: "Chọn trang này" leaves the approved row out, so đối chiếu still reaches the pending one', async () => {
  show();
  await screen.findByText('Phí đã duyệt');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn trang này' }));
  expect(screen.getByText('1 khoản đã chọn')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu chi phí' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith([{ sourceKind: 'OPS', sourceId: 3, expectedVersion: 1 }]));
});

it('AC2: "Chọn tất cả" leaves the approved row out, so the batch never carries an already-approved row', async () => {
  const { onVoucher } = show();
  await screen.findByText('Phí đã duyệt');
  fireEvent.click(screen.getByRole('button', { name: /Chọn tất cả 2 kết quả/ }));
  await waitFor(() => expect(screen.getByText('1 khoản đã chọn')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Lập phiếu thu' }));
  expect(onVoucher).toHaveBeenCalledWith([pending], 'IN');
});

/** Card 20260928_168 (PM ruling 2026-09-29 câu 3): the duyệt action lives in
 *  the 'Ngày duyệt' column — per row, on the same confirm wiring the batch
 *  button uses, so confirmedAt/confirmedById are recorded identically. */
it('AC1: the per-row Duyệt control in the Ngày duyệt column posts the single-row confirm', async () => {
  show();
  await screen.findByText('Phí chưa duyệt');
  // The approved row carries no control — only its date and approver.
  expect(screen.queryAllByRole('button', { name: 'Duyệt' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith([{ sourceKind: 'OPS', sourceId: 3, expectedVersion: 1 }]));
  // A per-row duyệt never selects the row for a batch the accountant did not choose.
  expect(screen.queryByText(/khoản đã chọn/)).not.toBeInTheDocument();
});
