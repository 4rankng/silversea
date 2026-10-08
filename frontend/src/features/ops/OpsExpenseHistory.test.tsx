import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsExpenseRow, OpsExpenseStatusCounts } from '../../api/opsClient';
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

describe('negative adjusting entries (card 071026210530)', () => {
  it('a negative RECORDED row labels itself as the adjusting entry; a positive row stays plain', () => {
    renderHistory([
      tripRow({ id: -61, amount: '-50000', expenseTypeName: 'Lưu bãi (lúc nâng)' }),
      tripRow({ id: -62, amount: '50000', expenseTypeName: 'Phí chi hộ khác' }),
    ]);
    const negativeRow = screen.getByText('-50.000 ₫').closest('tr')!;
    // Adjacent JSX text nodes concatenate without whitespace — assert the
    // qualifier as its own substring, never a joined sentence.
    expect(negativeRow.textContent).toContain('Đã ghi nhận');
    expect(negativeRow.textContent).toContain('— bút toán điều chỉnh (dòng âm)');
    const positiveRow = screen.getByText('50.000 ₫').closest('tr')!;
    expect(positiveRow.textContent).toContain('Đã ghi nhận');
    expect(positiveRow.textContent).not.toContain('bút toán điều chỉnh');
  });
});

describe('status filter tab counts (card 20261008_2)', () => {
  function renderWithCounts(counts: OpsExpenseStatusCounts | undefined) {
    useOpsWalletExpensesMock.mockReturnValue({
      data: counts ? { items: [tripRow()], statusCounts: counts } : { items: [] },
      isLoading: counts === undefined,
      isError: false,
      refetch: vi.fn(),
    });
    return render(<OpsExpenseHistory />);
  }

  /** label → the numeral the tab renders (the count slot is its own span, so
   *  the pin reads the mapping, not a concatenated string). */
  function countsByTab(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const label = tab.querySelector('.ds-tabs__label')!.textContent!;
      out[label] = tab.querySelector('.ds-tabs__count')?.textContent ?? '';
    }
    return out;
  }

  it('maps every tab to its own bucket — the numeral is the tab lens, never a neighbor', () => {
    renderWithCounts({ all: 6, DRAFT: 2, RECORDED: 3, VOIDED: 5, PENDING: 1, APPROVED: 4, REJECTED: 0 });
    expect(countsByTab()).toEqual({
      'Tất cả': '6', 'Cần bổ sung': '2', 'Đã ghi nhận': '3', 'Đã hủy': '5',
    });
  });

  it('renders an empty bucket as a visible 0, never blank', () => {
    renderWithCounts({ all: 1, DRAFT: 0, RECORDED: 1, VOIDED: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 });
    const counts = countsByTab();
    expect(counts['Tất cả']).toBe('1');
    expect(counts['Cần bổ sung']).toBe('0');
    expect(counts['Đã hủy']).toBe('0');
  });

  it('prints 0 across the board before the envelope arrives — never a blank chip', () => {
    renderWithCounts(undefined);
    expect(countsByTab()).toEqual({
      'Tất cả': '0', 'Cần bổ sung': '0', 'Đã ghi nhận': '0', 'Đã hủy': '0',
    });
  });

  it('keeps the census in view when the status lens changes (counts are not page-derived)', () => {
    renderWithCounts({ all: 6, DRAFT: 2, RECORDED: 3, VOIDED: 5, PENDING: 1, APPROVED: 4, REJECTED: 0 });
    fireEvent.click(screen.getByRole('tab', { name: /Cần bổ sung/ }));
    expect(useOpsWalletExpensesMock).toHaveBeenLastCalledWith('DRAFT');
    expect(countsByTab()).toEqual({
      'Tất cả': '6', 'Cần bổ sung': '2', 'Đã ghi nhận': '3', 'Đã hủy': '5',
    });
  });
});
