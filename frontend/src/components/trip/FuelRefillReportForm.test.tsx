import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const {
  listIncidentalCostsMock,
  createIncidentalCostMock,
  uploadReceiptPhotoMock,
  hasAccountantMock,
} = vi.hoisted(() => ({
  listIncidentalCostsMock: vi.fn(),
  createIncidentalCostMock: vi.fn(),
  uploadReceiptPhotoMock: vi.fn(),
  hasAccountantMock: vi.fn(),
}));

vi.mock('../../api/driverCostAssignment', () => ({
  tripHasPhoiPhieuAccountant: hasAccountantMock,
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: {
    listIncidentalCosts: listIncidentalCostsMock,
    createIncidentalCost: createIncidentalCostMock,
    uploadReceiptPhoto: uploadReceiptPhotoMock,
  },
}));

import { FuelRefillReportForm } from './FuelRefillReportForm';

function makeEntry(overrides: Partial<{
  id: number;
  tripId: number;
  driverId: number;
  costType: DriverIncidentalCostType;
  amount: string;
  occurredAt: string;
  note: string | null;
  receiptStorageKey: string | null;
  createdAt: string;
}> = {}) {
  return {
    id: 1,
    tripId: 42,
    driverId: 7,
    costType: DriverIncidentalCostType.FUEL,
    amount: '200000',
    occurredAt: '2026-08-20',
    note: null,
    receiptStorageKey: null,
    createdAt: '2026-08-20T01:00:00.000Z',
    ...overrides,
  };
}

function renderForm(tripId = 42) {
  return render(<FuelRefillReportForm tripId={tripId} />);
}

describe('FuelRefillReportForm', () => {
  beforeEach(() => {
    listIncidentalCostsMock.mockReset();
    hasAccountantMock.mockReset();
    createIncidentalCostMock.mockReset();
    uploadReceiptPhotoMock.mockReset();
  });

  it('renders the empty state when there are no existing refill reports', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    hasAccountantMock.mockResolvedValue(true);
    renderForm();

    expect(await screen.findByText(/Chưa có lần đổ dầu nào được báo cáo/)).toBeTruthy();
    expect(listIncidentalCostsMock).toHaveBeenCalledWith(42);
  });

  it('only shows FUEL-type entries, filtering out other incidental costs returned by the shared list endpoint', async () => {
    listIncidentalCostsMock.mockResolvedValue([
      makeEntry({ id: 5, amount: '150000', note: '80 lít tại Km12' }),
      makeEntry({ id: 6, costType: DriverIncidentalCostType.TOLL, amount: '40000' }),
    ]);
    renderForm();

    expect(await screen.findByText('150.000 ₫')).toBeTruthy();
    expect(screen.getByText('80 lít tại Km12')).toBeTruthy();
    expect(screen.queryByText('40.000 ₫')).toBeNull();
  });

  it('submits a refill report with costType FUEL, an idempotency key, and refreshes the list', async () => {
    listIncidentalCostsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEntry({ id: 9, amount: '300000' })]);
    createIncidentalCostMock.mockResolvedValue({
      id: 9,
      tripId: 42,
      driverId: 7,
      costType: DriverIncidentalCostType.FUEL,
      amount: '300000',
      occurredAt: '2026-08-20',
      note: null,
      receiptStorageKey: null,
      createdAt: '2026-08-20T01:00:00.000Z',
    });

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /Thêm lần đổ dầu/ }));

    const amountInput = await screen.findByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '300000' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu lần đổ dầu/ }));

    await waitFor(() => expect(createIncidentalCostMock).toHaveBeenCalledTimes(1));
    const [tripIdArg, bodyArg, idempotencyKeyArg] = createIncidentalCostMock.mock.calls[0];
    expect(tripIdArg).toBe(42);
    expect(bodyArg).toMatchObject({ costType: DriverIncidentalCostType.FUEL, amount: 300000 });
    expect(typeof idempotencyKeyArg).toBe('string');
    expect(idempotencyKeyArg.length).toBeGreaterThan(0);

    await waitFor(() => expect(listIncidentalCostsMock).toHaveBeenCalledTimes(2));
  });

  // Card 20260928_166 AC2 — the truck has no live phơi-phiếu accountant.
  // The contract is WARN, NOT BLOCK: the PM wanted the split for convenience
  // when checking road fees, and a hard gate would stop 32 of 40 trucks as the
  // data stands. So the banner must appear AND the add button must stay usable.
  it('warns when the truck has no accountant, and still lets the driver record a cost', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    hasAccountantMock.mockResolvedValue(false);
    renderForm();

    // The advisory banner is identified by its seam, not by its sentence —
    // the copy is trimmed freely (card 20260930_216, law §8).
    expect(await screen.findByTestId('cost-entry-no-accountant')).toBeTruthy();
    // Advisory, not an error: it must not be announced as an alert.
    expect(screen.queryByRole('alert')).toBeNull();
    // And crucially NOT a gate — the form is still operable.
    expect(screen.getByRole('button', { name: /Thêm lần đổ dầu/ })).toBeEnabled();
  });

  it('shows no assignment warning when the truck has an accountant', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    hasAccountantMock.mockResolvedValue(true);
    renderForm();

    expect(await screen.findByText(/Chưa có lần đổ dầu nào được báo cáo/)).toBeTruthy();
    expect(screen.queryByTestId('cost-entry-no-accountant')).toBeNull();
  });

  it('shows an inline error message when createIncidentalCost rejects', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    hasAccountantMock.mockResolvedValue(true);
    createIncidentalCostMock.mockRejectedValue(new Error('Không thể lưu lần đổ dầu do lỗi máy chủ.'));

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /Thêm lần đổ dầu/ }));

    const amountInput = await screen.findByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '15000' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu lần đổ dầu/ }));

    expect(await screen.findByText('Không thể lưu lần đổ dầu do lỗi máy chủ.')).toBeTruthy();
  });
});
