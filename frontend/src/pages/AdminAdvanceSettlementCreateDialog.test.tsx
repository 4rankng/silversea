import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAdvanceSettlementCreateDialog from './AdminAdvanceSettlementCreateDialog';

const { state, mutateAsync, toastMock, mutationStore } = vi.hoisted(() => {
  // Mirrors the real mutation hook: after a rejected mutateAsync the hook
  // exposes the failure on `error` AND re-renders its subscribers (TanStack
  // Query does that through its own state update) — without the reactive
  // read the dialog would never re-render to show the inline alert.
  const store = {
    error: null as Error | null,
    listeners: new Set<() => void>(),
    set(next: Error | null) {
      store.error = next;
      for (const listener of store.listeners) listener();
    },
    subscribe(listener: () => void) {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
  };
  return {
    state: {
      balances: [] as Array<Record<string, unknown>>,
      advances: [] as Array<Record<string, unknown>>,
      expenses: [] as Array<Record<string, unknown>>,
    },
    mutateAsync: vi.fn(),
    toastMock: vi.fn(),
    mutationStore: store,
  };
});
vi.mock('../hooks/useForwarderQueries', async () => {
  // vi.mock factories are hoisted ABOVE the file's static imports, so `react`
  // cannot be reached statically here — the factory-time dynamic import is
  // the only shape vitest allows.
  const { useSyncExternalStore } = await import('react');
  return {
    useAdminAdvanceBalances: () => ({ data: { items: state.balances } }),
    useAdminSettlementEligibility: () => ({ data: { advances: state.advances, expenses: state.expenses }, isPending: false, isError: false, error: null }),
    useCreateAdvanceSettlementForForwarder: () => ({
      mutateAsync: async (...args: Parameters<typeof mutateAsync>) => {
        try {
          mutationStore.set(null);
          return await mutateAsync(...args);
        } catch (cause) {
          mutationStore.set(cause as Error);
          throw cause;
        }
      },
      isPending: false,
      error: useSyncExternalStore(mutationStore.subscribe, () => mutationStore.error),
      reset: () => {},
    }),
  };
});
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: {} }) }));

function dialog() {
  return <AdminAdvanceSettlementCreateDialog open onClose={() => {}} />;
}

describe('SIL-751 — accountant settlement dialog auto-fills the refund balance', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 21, code: 'HU-21' });
    toastMock.mockReset();
    mutationStore.set(null);
    state.balances = [{ forwarderId: 1, name: 'NV QA', outstanding: '1000000' }];
    state.advances = [{ id: 5, amount: '1000000', reason: 'Ứng đã nhận', createdAt: '2026-11-01T00:00:00.000Z' }];
    state.expenses = [{ id: 9, buyAmount: '250000', expenseType: 'TOLL', tripCode: 'T-QA-9', completionStatus: 'COMPLETED' }];
  });

  it('the refund box tracks tạm ứng − chi phí and the phiếu balances on first submit', async () => {
    render(dialog());
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /TOLL/ }));
    const refund = screen.getByLabelText('Tiền hoàn lại') as HTMLInputElement;
    expect(refund).toHaveValue('750.000');
    expect(screen.queryByText(/Chênh lệch/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      forwarderId: 1, refundAmount: 750000, note: undefined,
      advanceRequestIds: [5], tripExpenseIds: [9],
    }));
  });

  it('a typed partial refund wins over the suggestion and the Chênh lệch warning states the gap', async () => {
    render(dialog());
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Ứng đã nhận/ }));
    const refund = screen.getByLabelText('Tiền hoàn lại') as HTMLInputElement;
    expect(refund).toHaveValue('1.000.000');
    fireEvent.change(refund, { target: { value: '600000' } });
    expect(refund).toHaveValue('600.000');
    expect(screen.getByText(/Chênh lệch/)).toHaveTextContent('400.000');
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ refundAmount: 600000, advanceRequestIds: [5] }),
    ));
  });
});

// ── SIL-1056 — số dư âm + toast ghi nhận ────────────────────────────────────
describe('SIL-1056 — negative balance reads as công ty chi bù and the landed phiếu announces itself', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 30, code: 'PT-2611-0012' });
    toastMock.mockReset();
    mutationStore.set(null);
    // The staging shape: chi vượt ứng → canonical balance âm (công ty trả thêm).
    state.balances = [{ forwarderId: 7, name: 'Nguyễn Huy Hoàng', outstanding: '-2479000' }];
    state.advances = [];
    state.expenses = [];
  });

  it('a negative balance labels the money line Tiền công ty chi bù (not Tiền hoàn lại) and prefills the signed deficit', () => {
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    expect(screen.getByText('Tiền công ty chi bù')).toBeTruthy();
    expect(screen.queryByText('Tiền hoàn lại')).toBeNull();
    // Direction-locked (SIL-1056 bounce #4): the box reads the MAGNITUDE —
    // the label carries the direction, the payload carries the sign.
    expect(screen.getByLabelText('Tiền công ty chi bù')).toHaveValue('2.479.000');
  });

  it('a positive number typed under the chi-bù label cannot flip the phiếu — the payload stays company-pays negative', async () => {
    // The QA repro (build 5c2a7a03): typing 123000 into 'Tiền công ty chi bù'
    // on a −123.000 row posted a staff-returns phiếu (+123.000) — the
    // refetched report read −246.000 with the [Lập phiếu] button still live
    // while server truth was 0. The direction belongs to the balance.
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    const refund = screen.getByLabelText('Tiền công ty chi bù') as HTMLInputElement;
    fireEvent.change(refund, { target: { value: '123000' } });
    expect(refund).toHaveValue('123.000');
    expect(screen.getByText('Tiền công ty chi bù')).toBeTruthy();
    expect(screen.queryByText('Tiền hoàn lại')).toBeNull();
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ forwarderId: 7, refundAmount: -123000 }),
    ));
  });

  it('a positive balance keeps the Tiền hoàn lại label', () => {
    state.balances = [{ forwarderId: 1, name: 'NV QA', outstanding: '500000' }];
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: /NV QA/ }));
    expect(screen.getByText('Tiền hoàn lại')).toBeTruthy();
    expect(screen.queryByText('Tiền công ty chi bù')).toBeNull();
  });

  it('a successful Ghi nhận phiếu fires the green toast naming the phiếu code, then hands control back to the caller', async () => {
    const onClose = vi.fn();
    render(<AdminAdvanceSettlementCreateDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Đã ghi nhận phiếu hoàn ứng PT-2611-0012 thành công.' }));
    // The parent owns `open`; the dialog's close contract is the onClose call.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a refusal (4xx/5xx) keeps the draft, surfaces the API error, fires no success toast and never closes', async () => {
    // The mocked mutateAsync only rejects; the mock hook's wrapper is what
    // lands the failure on the mutation's `error` (TanStack's contract), and
    // that is what makes the dialog render the inline alert and keep the
    // modal + selections alive.
    mutateAsync.mockRejectedValue(new Error('Phiếu chưa cân đối'));
    const onClose = vi.fn();
    render(<AdminAdvanceSettlementCreateDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /Nguyễn Huy Hoàng/ }));
    fireEvent.click(screen.getByLabelText('Xác nhận hoàn ứng'));
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận phiếu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiếu chưa cân đối');
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
