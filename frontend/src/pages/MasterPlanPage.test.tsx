import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../api/shipmentClient';

const { updateShipment, toast, plan } = vi.hoisted(() => ({
  updateShipment: vi.fn(),
  toast: vi.fn(),
  plan: { items: [] as ShipmentListItem[], role: 'DISPATCHER' },
}));

vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/shipmentClient')>()),
  updateShipment,
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: plan.role } }),
}));

vi.mock('../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn(async () => ({ items: [] })) },
}));

vi.mock('../features/dispatch/master-plan/useDispatchMasterPlan', () => ({
  useDispatchMasterPlan: () => ({
    filters: {
      q: '', tradeDirection: '', allocationStatus: '',
      deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [],
    },
    updateFilters: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    items: plan.items,
    total: plan.items.length,
    totalPages: 1,
    loading: false,
    error: null,
    refetch: vi.fn(),
    replaceItem: vi.fn(),
    pageSize: 20,
    dispatchSummary: null,
    presence: null,
  }),
}));

import { ApiError } from '../lib/api';
import MasterPlanPage from './MasterPlanPage';

const row = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-08-20',
  customsCutoffAt: '2026-08-01T05:00:00.000Z',
  operationalNotes: 'Ghi chú cũ',
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

function mount() {
  return render(<MemoryRouter><MasterPlanPage /></MemoryRouter>);
}

describe('MasterPlanPage note editing (dispatcher gate)', () => {
  beforeEach(() => {
    updateShipment.mockReset();
    toast.mockReset();
    plan.items = [];
    plan.role = 'DISPATCHER';
  });

  it('does not offer the note edit a DISPATCHER can never save', () => {
    plan.items = [row({ status: ShipmentStatus.DISPATCHED })];
    mount();

    expect(screen.getByText('Ghi chú cũ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' })).toBeNull();
  });

  it('toasts the server reason when a note save is refused', async () => {
    plan.items = [row()];
    updateShipment.mockRejectedValue(new ApiError(
      403,
      { error: 'Điều vận chỉ được cập nhật lô hàng trong giai đoạn tiếp nhận.' },
      'Điều vận chỉ được cập nhật lô hàng trong giai đoạn tiếp nhận.',
    ));
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' }));
    fireEvent.change(screen.getByLabelText('Ghi chú điều phối'), { target: { value: 'Ghi chú mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Điều vận chỉ được cập nhật lô hàng trong giai đoạn tiếp nhận.',
    }));
  });

  it('keeps the generic message when the failure carries no server reason', async () => {
    plan.role = 'ADMIN';
    plan.items = [row()];
    updateShipment.mockRejectedValue(new TypeError('Failed to fetch'));
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa ghi chú điều phối' }));
    fireEvent.change(screen.getByLabelText('Ghi chú điều phối'), { target: { value: 'Ghi chú mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Không lưu được ghi chú điều phối. Vui lòng thử lại.',
    }));
  });
});
