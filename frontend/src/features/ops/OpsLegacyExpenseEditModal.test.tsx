import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsExpenseRow } from '../../api/opsClient';
import { OpsLegacyExpenseEditModal } from './OpsLegacyExpenseEditModal';

/**
 * Card 071026141580 — the trip-row editor's writable surface matches the trip
 * cost card (Số tiền trả = buyAmount, Số tiền thu = sellAmount) and routes
 * through PUT /trips/:id/expenses/:eid — the API the row's own author can
 * call. Only changed fields are sent.
 */
const { useInvalidateOpsMock, toastMock, updateTripMock } = vi.hoisted(() => ({
  useInvalidateOpsMock: vi.fn(),
  toastMock: vi.fn(),
  updateTripMock: vi.fn(),
}));

vi.mock('../../hooks/useOpsQueries', () => ({ useInvalidateOps: useInvalidateOpsMock }));
vi.mock('../../components/shared/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('../../api/tripClient', () => ({
  tripClient: { deleteTripExpense: vi.fn(), updateTripExpense: updateTripMock, createTripExpense: vi.fn() },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  useInvalidateOpsMock.mockReturnValue(vi.fn());
});

describe('OpsLegacyExpenseEditModal', () => {
  it('updates only the changed amount through the trip-expense API', async () => {
    updateTripMock.mockResolvedValue({});
    render(<OpsLegacyExpenseEditModal entry={tripRow()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Số tiền trả'), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(updateTripMock).toHaveBeenCalledWith(7, 55, { buyAmount: 25000 }));
  });

  it('sends sellAmount when only the receivable side changes', async () => {
    updateTripMock.mockResolvedValue({});
    render(<OpsLegacyExpenseEditModal entry={tripRow()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Số tiền thu'), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(updateTripMock).toHaveBeenCalledWith(7, 55, { sellAmount: 30000 }));
  });

  it('keeps the save inert until an amount actually changes', () => {
    render(<OpsLegacyExpenseEditModal entry={tripRow()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Lưu' })).toHaveProperty('disabled', true);
  });
});
