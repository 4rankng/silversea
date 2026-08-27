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
    createIncidentalCostMock.mockReset();
    uploadReceiptPhotoMock.mockReset();
  });

  it('renders the empty state when there are no existing refill reports', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
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

  it('shows an inline error message when createIncidentalCost rejects', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    createIncidentalCostMock.mockRejectedValue(new Error('Không thể lưu lần đổ dầu do lỗi máy chủ.'));

    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: /Thêm lần đổ dầu/ }));

    const amountInput = await screen.findByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '15000' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu lần đổ dầu/ }));

    expect(await screen.findByText('Không thể lưu lần đổ dầu do lỗi máy chủ.')).toBeTruthy();
  });
});
