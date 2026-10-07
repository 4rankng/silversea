import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsExpenseRow } from '../../api/opsClient';
import { OpsExpenseHistory } from './OpsExpenseHistory';

/**
 * Card 071026141580 — the wallet's "khai chi hộ" (TRIP-sourced) rows must show
 * the catalog label and carry Sửa/Xóa like any other editable row. The QA
 * repro saw raw "OTHER" and an empty actions column on the fresh row. Trip
 * rows route Sửa/Xóa through the trip-expense API (their own contract: a
 * plain confirm on delete, no reason field), native Ops rows keep the Q10
 * reason-prompt delete.
 */
const {
  useOpsWalletExpensesMock,
  useDeleteOpsExpenseMock,
  useInvalidateOpsMock,
  deleteTripMock,
  deleteMock,
  promptMock,
  confirmMock,
  toastMock,
} = vi.hoisted(() => ({
  useOpsWalletExpensesMock: vi.fn(),
  useDeleteOpsExpenseMock: vi.fn(),
  useInvalidateOpsMock: vi.fn(),
  deleteTripMock: vi.fn(),
  deleteMock: vi.fn(),
  promptMock: vi.fn(),
  confirmMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../../hooks/useOpsQueries', () => ({
  useOpsWalletExpenses: useOpsWalletExpensesMock,
  useDeleteOpsExpense: useDeleteOpsExpenseMock,
  useInvalidateOps: useInvalidateOpsMock,
}));
vi.mock('../../api/tripClient', () => ({ tripClient: { deleteTripExpense: deleteTripMock, updateTripExpense: vi.fn(), createTripExpense: vi.fn() } }));
vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: { get: vi.fn(), update: vi.fn(), correct: vi.fn() },
}));
vi.mock('../../components/reason-prompt', () => ({
  useReasonPrompt: () => ({ prompt: promptMock, dialog: null }),
}));
vi.mock('../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));
vi.mock('../../components/UI', () => ({
  Drawer: ({ isOpen, children }: { isOpen?: boolean; children?: unknown }) => (isOpen ? <div>{children as never}</div> : null),
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));
vi.mock('./OpsExpensePhotosModal', () => ({ OpsExpensePhotosModal: () => null }));
vi.mock('./OpsExpenseEditModal', () => ({ OpsExpenseEditModal: () => <div data-testid="native-edit" /> }));
vi.mock('./OpsLegacyExpenseEditModal', () => ({ OpsLegacyExpenseEditModal: () => <div data-testid="legacy-edit" /> }));

function tripRow(over: Partial<OpsExpenseRow> = {}): OpsExpenseRow {
  return {
    id: -55,
    sourceKind: 'TRIP',
    sourceId: 55,
    tripId: 7,
    shipmentId: 3,
    shipmentCode: 'DSP-SHP',
    billRef: 'BK-1',
    containerNumber: null,
    expenseTypeCode: 'OTHER',
    expenseTypeName: 'Phí chi hộ khác',
    requiresInvoice: false,
    amount: '20000',
    paidAt: '2026-10-07',
    note: 'Vé cầu đường',
    approvalStatus: 'RECORDED',
    rejectionReason: null,
    opsSettlementId: null,
    hasPhoto: false,
    paidById: 1,
    paidByName: 'Ops',
    createdAt: '2026-10-07T10:00:00Z',
    version: 2,
    confirmedAt: null,
    feeName: null,
    ...over,
  };
}

function renderHistory(items: OpsExpenseRow[]) {
  useOpsWalletExpensesMock.mockReturnValue({ data: { items }, isLoading: false, isError: false, refetch: vi.fn() });
  return render(<OpsExpenseHistory />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeleteOpsExpenseMock.mockReturnValue({ mutateAsync: deleteMock });
  useInvalidateOpsMock.mockReturnValue(vi.fn());
});

describe('trip-sourced wallet rows (card 071026141580)', () => {
  it('shows the resolved label and both actions on the fresh row', () => {
    renderHistory([tripRow()]);
    expect(screen.getByText('Phí chi hộ khác')).toBeTruthy();
    expect(screen.queryByText('OTHER')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sửa khoản chi BK-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa khoản chi BK-1' })).toBeTruthy();
  });

  it('deletes through the trip-expense API after a confirm and refreshes the wallet', async () => {
    const invalidate = vi.fn();
    useInvalidateOpsMock.mockReturnValue(invalidate);
    deleteTripMock.mockResolvedValue({ ok: true });
    confirmMock.mockResolvedValue(true);
    renderHistory([tripRow()]);

    fireEvent.click(screen.getByRole('button', { name: 'Xóa khoản chi BK-1' }));
    await waitFor(() => expect(deleteTripMock).toHaveBeenCalledWith(7, 55));
    expect(invalidate).toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('aborts the delete without any request when the confirm is cancelled', async () => {
    deleteTripMock.mockResolvedValue({ ok: true });
    confirmMock.mockResolvedValue(false);
    renderHistory([tripRow()]);

    fireEvent.click(screen.getByRole('button', { name: 'Xóa khoản chi BK-1' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteTripMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('routes Sửa to the trip-row editor, not the native one', () => {
    renderHistory([tripRow()]);
    fireEvent.click(screen.getByRole('button', { name: 'Sửa khoản chi BK-1' }));
    expect(screen.getByTestId('legacy-edit')).toBeTruthy();
    expect(screen.queryByTestId('native-edit')).toBeNull();
  });

  it('keeps native rows on the native editor and the Q10 reason-prompt delete', async () => {
    deleteMock.mockResolvedValue(undefined);
    promptMock.mockResolvedValue('Nhập nhầm');
    renderHistory([tripRow({ id: 21, sourceKind: 'OPS', sourceId: undefined, tripId: undefined })]);

    fireEvent.click(screen.getByRole('button', { name: 'Sửa khoản chi BK-1' }));
    expect(screen.getByTestId('native-edit')).toBeTruthy();
    expect(screen.queryByTestId('legacy-edit')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa khoản chi BK-1' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith({ id: 21, reason: 'Nhập nhầm' }));
    expect(deleteTripMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('locked rows state their rule (card 071026210520)', () => {
  it('a đối-chiếu row prints "Đã đối chiếu" instead of a silent blank actions cell', () => {
    renderHistory([
      tripRow(),
      tripRow({ id: -56, sourceId: 56, confirmedAt: '2026-10-07T11:00:00Z' }),
    ]);
    expect(screen.getByText('Đã đối chiếu')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sửa khoản chi BK-1' })).toHaveLength(1);
  });

  it('a settled row prints "Đã quyết toán" — the rule order follows the write guards', () => {
    renderHistory([
      tripRow({ id: -57, sourceId: 57, opsSettlementId: 9, confirmedAt: '2026-10-07T11:00:00Z' }),
    ]);
    expect(screen.getByText('Đã quyết toán')).toBeTruthy();
  });

  it('keeps the actions column (with rules) even when every row is locked', () => {
    renderHistory([
      tripRow({ id: -58, sourceId: 58, confirmedAt: '2026-10-07T11:00:00Z' }),
      tripRow({ id: -59, sourceId: 59, approvalStatus: 'VOIDED' }),
    ]);
    expect(screen.getAllByRole('cell', { name: 'Thao tác' })).toHaveLength(2);
    expect(screen.getByText('Đã đối chiếu')).toBeTruthy();
    expect(screen.getByText('Đã hủy / từ chối')).toBeTruthy();
  });
});
