import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const {
  listIncidentalCostsMock,
  createIncidentalCostMock,
  uploadReceiptPhotoMock,
} = vi.hoisted(() => ({
  listIncidentalCostsMock: vi.fn(),
  createIncidentalCostMock: vi.fn(),
  uploadReceiptPhotoMock: vi.fn(),
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: {
    listIncidentalCosts: listIncidentalCostsMock,
    createIncidentalCost: createIncidentalCostMock,
    uploadReceiptPhoto: uploadReceiptPhotoMock,
  },
}));

import { ShipmentCostEntryForm } from './ShipmentCostEntryForm';

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
    costType: DriverIncidentalCostType.TOLL,
    amount: '50000',
    occurredAt: '2026-08-20',
    note: null,
    receiptStorageKey: null,
    createdAt: '2026-08-20T01:00:00.000Z',
    ...overrides,
  };
}

function renderForm(tripId = 42) {
  return render(<ShipmentCostEntryForm tripId={tripId} />);
}

describe('ShipmentCostEntryForm', () => {
  beforeEach(() => {
    listIncidentalCostsMock.mockReset();
    createIncidentalCostMock.mockReset();
    uploadReceiptPhotoMock.mockReset();
  });

  it('renders the empty state when there are no existing entries', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    renderForm();

    expect(await screen.findByText(/Chưa có chi phí phát sinh nào/)).toBeTruthy();
    expect(listIncidentalCostsMock).toHaveBeenCalledWith(42);
  });

  it('renders existing cost entries returned by the API', async () => {
    listIncidentalCostsMock.mockResolvedValue([
      makeEntry({ id: 5, costType: DriverIncidentalCostType.LIFT_FEE, amount: '120000', note: 'Phí nâng cont' }),
    ]);
    renderForm();

    expect(await screen.findByText('Phí nâng')).toBeTruthy();
    expect(screen.getByText('120.000 ₫')).toBeTruthy();
    expect(screen.getByText('Phí nâng cont')).toBeTruthy();
  });

  it('submits the inline form with an idempotency key and refreshes the list', async () => {
    listIncidentalCostsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEntry({ id: 9, costType: DriverIncidentalCostType.PARKING, amount: '30000' })]);
    createIncidentalCostMock.mockResolvedValue({
      id: 9,
      tripId: 42,
      driverId: 7,
      costType: DriverIncidentalCostType.PARKING,
      amount: '30000',
      occurredAt: '2026-08-20',
      note: null,
      receiptStorageKey: null,
      createdAt: '2026-08-20T01:00:00.000Z',
    });

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /Thêm chi phí/ }));

    const amountInput = await screen.findByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '30000' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu chi phí/ }));

    await waitFor(() => expect(createIncidentalCostMock).toHaveBeenCalledTimes(1));
    const [tripIdArg, bodyArg, idempotencyKeyArg] = createIncidentalCostMock.mock.calls[0];
    expect(tripIdArg).toBe(42);
    expect(bodyArg).toMatchObject({ amount: 30000 });
    expect(typeof idempotencyKeyArg).toBe('string');
    expect(idempotencyKeyArg.length).toBeGreaterThan(0);

    await waitFor(() => expect(listIncidentalCostsMock).toHaveBeenCalledTimes(2));
  });

  it('shows an inline error message when createIncidentalCost rejects', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    createIncidentalCostMock.mockRejectedValue(new Error('Không thể lưu chi phí do lỗi máy chủ.'));

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /Thêm chi phí/ }));

    const amountInput = await screen.findByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '15000' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu chi phí/ }));

    expect(await screen.findByText('Không thể lưu chi phí do lỗi máy chủ.')).toBeTruthy();
  });
});
