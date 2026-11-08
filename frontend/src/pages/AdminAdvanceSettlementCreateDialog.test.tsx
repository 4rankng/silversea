import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAdvanceSettlementCreateDialog from './AdminAdvanceSettlementCreateDialog';

const { state, mutateAsync } = vi.hoisted(() => ({
  state: {
    balances: [] as Array<Record<string, unknown>>,
    advances: [] as Array<Record<string, unknown>>,
    expenses: [] as Array<Record<string, unknown>>,
  },
  mutateAsync: vi.fn(),
}));
vi.mock('../hooks/useForwarderQueries', () => ({
  useAdminAdvanceBalances: () => ({ data: { items: state.balances } }),
  useAdminSettlementEligibility: () => ({ data: { advances: state.advances, expenses: state.expenses }, isPending: false, isError: false, error: null }),
  useCreateAdvanceSettlementForForwarder: () => ({ mutateAsync, isPending: false, error: null, reset: () => {} }),
}));
vi.mock('../hooks/useCatalogs', () => ({ useCatalogs: () => ({ data: {} }) }));

function dialog() {
  return <AdminAdvanceSettlementCreateDialog open onClose={() => {}} />;
}

describe('SIL-751 — accountant settlement dialog auto-fills the refund balance', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ id: 21, code: 'HU-21' });
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
