import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverIncidentalCostType } from '@tingting/shared';

const {
  listIncidentalCostsMock,
  createIncidentalCostMock,
  uploadReceiptPhotoMock,
  updateCostSubmissionNoteMock,
} = vi.hoisted(() => ({
  listIncidentalCostsMock: vi.fn(),
  createIncidentalCostMock: vi.fn(),
  uploadReceiptPhotoMock: vi.fn(),
  updateCostSubmissionNoteMock: vi.fn(),
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: {
    listIncidentalCosts: listIncidentalCostsMock,
    createIncidentalCost: createIncidentalCostMock,
    uploadReceiptPhoto: uploadReceiptPhotoMock,
    updateCostSubmissionNote: updateCostSubmissionNoteMock,
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

function renderForm(
  tripId = 42,
  overrides: Partial<React.ComponentProps<typeof ShipmentCostEntryForm>> = {},
) {
  return render(
    <ShipmentCostEntryForm
      tripId={tripId}
      totalRoadAllowance="600000"
      pickupLocation="Cảng Nam Đình Vũ"
      deliveryLocation="Nhà máy Sunrise Bắc Giang"
      pickupPortName="Cảng Nam Đình Vũ"
      dropPortName="Nhà máy Sunrise Bắc Giang"
      pickupWarehouseName="Kho Nam Đình Vũ"
      dropWarehouseName="Kho Sunrise Bắc Giang"
      {...overrides}
    />,
  );
}

describe('ShipmentCostEntryForm', () => {
  beforeEach(() => {
    listIncidentalCostsMock.mockReset();
    createIncidentalCostMock.mockReset();
    uploadReceiptPhotoMock.mockReset();
    updateCostSubmissionNoteMock.mockReset();
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

  it('excludes FUEL from the cost-type dropdown and from the rendered list — it has its own dedicated report form', async () => {
    listIncidentalCostsMock.mockResolvedValue([
      makeEntry({ id: 3, costType: DriverIncidentalCostType.FUEL, amount: '200000', note: 'Đổ dầu Km30' }),
      makeEntry({ id: 4, costType: DriverIncidentalCostType.TOLL, amount: '40000' }),
    ]);
    renderForm();

    await screen.findByText('Phí cầu đường');
    expect(screen.queryByText('Tiền dầu')).toBeNull();
    expect(screen.queryByText('Đổ dầu Km30')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Thêm chi phí/ }));
    // UuiSelectField renders a button trigger for short option lists, or a
    // searchable combobox input once the list is long enough — the cost-type
    // list here has more than a few entries.
    fireEvent.click(await screen.findByRole('combobox', { name: /Loại chi phí/i }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).not.toContain('Tiền dầu');
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

  // 27.8 cost-section Ghi chú — driver-written note for accounting to
  // re-check the auto-recorded costs (Tiền đường / Phí Lạch Huyện).
  it('autosaves the section-level Ghi chú after the driver edits and pauses typing', async () => {
    updateCostSubmissionNoteMock.mockResolvedValue({ tripId: 42, costSubmissionNote: 'Tiền đường chưa đúng' });
    listIncidentalCostsMock.mockResolvedValue([]);

    renderForm(42, { costSubmissionNote: '' });

    const textarea = await screen.findByLabelText(/^Ghi chú$/);
    fireEvent.change(textarea, { target: { value: 'Tiền đường chưa đúng' } });

    await waitFor(
      () => expect(updateCostSubmissionNoteMock).toHaveBeenCalledWith(42, 'Tiền đường chưa đúng'),
      { timeout: 1500 },
    );
  });

  it('does not autosave the section-level Ghi chú when the value is unchanged', async () => {
    listIncidentalCostsMock.mockResolvedValue([]);
    renderForm(42, { costSubmissionNote: 'Đã có sẵn' });

    // Field renders with the seeded value
    const textarea = await screen.findByLabelText(/^Ghi chú$/);
    expect((textarea as HTMLTextAreaElement).value).toBe('Đã có sẵn');

    // Wait long enough for the 600ms debounce + a small buffer
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(updateCostSubmissionNoteMock).not.toHaveBeenCalled();
  });
});
