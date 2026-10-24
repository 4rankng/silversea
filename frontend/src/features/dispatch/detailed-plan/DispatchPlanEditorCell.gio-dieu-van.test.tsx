import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(),
    createCarrierFleetVehicle: vi.fn(),
    createInternalTruck: vi.fn(),
    updateLclTruck: vi.fn(),
  };
});

const getTrailersMock = vi.fn();
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';
import { detailRowKey } from './DispatchPlanCellValues';

// The note composer pulls the tag pool through react-query; pin it so the
// modal tests stay provider-free and deterministic.
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({
    tags: [{ id: 1, label: 'Đặt đầu' }],
    isLoading: false,
    error: null,
  }),
  useCreateDispatchTaskTag: () => ({
    createTag: vi.fn(async (label: string) => ({ id: 99, label })),
    isCreating: false,
  }),
}));

getTrailersMock.mockResolvedValue([]);

const PAIRED_TRUCK = {
  id: 154,
  licensePlate: '15H-052.82',
  status: 'ACTIVE',
  trailerType: '20FT',
  currentTrailerId: 2,
  currentTrailerPlate: '15R-182.06',
  capacityKg: '18000',
  assignedDriverId: 8,
  assignedDriverName: 'Phạm Văn Hùng',
};

/**
 * SIL-473 (QA Glint R41, regression of SIL-80/DIS-05) — the 'Sửa điều phối'
 * dialog must carry BOTH times: 'Giờ điều vận' (the row's run schedule —
 * the container appointment the time column displays) AND 'Giờ trả hàng'
 * (the staged fulfillment override). QA repro: the dialog shipped only
 * 'Giờ trả hàng'; 'Giờ điều vận' was nowhere in it.
 */
const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentContainerId: 777,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  // Appointment 13:00 VN — 06:00Z.
  time: { deliveryDate: '2026-10-26', runAt: '2026-10-26T06:00:00.000Z', runHour: 13 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho Bình Dương', routeName: null },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: '15H-052.82',
  },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE' as DispatchDetailPlanRow['classification'],
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

function mockFleetResources() {
  vi.mocked(listDispatchFleetResources).mockImplementation((async (resource: string) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [], nextCursor: null, total: 0, limit: 50 };
    }
    return { items: [PAIRED_TRUCK], nextCursor: null, total: 1, limit: 50, suggestedItems: [] };
  }) as never);
}

const savedPlan = (): AtomicPlanSaveResult => ({
  fulfillmentVersion: 4,
  shipmentVersion: 6,
  classification: 'SINGLE',
  isCombined: false,
  operationalNotes: null,
  plannedEndAt: null,
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
});

function renderCell(item: DispatchDetailPlanRow, onAtomicSave: ReturnType<typeof vi.fn>) {
  const key = detailRowKey(item);
  const element = (nonce: number) => (
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={onAtomicSave as never}
      onOpenTripReassign={vi.fn() as never}
      onCompleteExternalTrip={vi.fn() as never}
      onIssueOrder={vi.fn() as never}
      openRequest={{ key, nonce }}
      onOpenRequestConsumed={vi.fn()}
    />
  );
  return render(element(1));
}

async function openDialog() {
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

const runDay = () => screen.getByLabelText('Ngày — Giờ điều vận') as HTMLInputElement;
const runHour = () => screen.getByLabelText('Giờ — Giờ điều vận') as HTMLInputElement;
const runMinute = () => screen.getByLabelText('Phút — Giờ điều vận') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Lưu thay đổi/ });

describe('SIL-473 — the Sửa điều phối dialog carries Giờ điều vận beside Giờ trả hàng', () => {
  it('renders the Giờ điều vận field (the regression: it was absent) next to Giờ trả hàng', async () => {
    mockFleetResources();
    renderCell(row(), vi.fn().mockResolvedValue(savedPlan()));
    await openDialog();
    expect(screen.getByLabelText('Giờ điều vận')).toBeTruthy();
    expect(screen.getByLabelText('Giờ trả hàng')).toBeTruthy();
  });

  it('prefills Giờ điều vận from the row run timestamp in Vietnam wall-clock', async () => {
    mockFleetResources();
    renderCell(row(), vi.fn().mockResolvedValue(savedPlan()));
    await openDialog();
    // Split-datetime segments: the date group reads dd/mm/yyyy per segment.
    expect(runDay().value).toBe('26');
    expect(runHour().value).toBe('13');
    expect(runMinute().value).toBe('00');
  });

  it('saves an edited Giờ điều vận as the zone-aware appointment ISO (14:00 +07:00 → 07:00Z)', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.change(runHour(), { target: { value: '14' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.customerAppointmentAt).toBe('2026-10-26T07:00:00.000Z');
    // Giờ trả hàng untouched — its omit law still holds on this save.
    expect('plannedEndAt' in body).toBe(false);
  });

  it('saves BOTH times when both are edited (QA expected: cả Giờ điều vận LẪN Giờ trả hàng)', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.change(runHour(), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Ngày — Giờ trả hàng'), { target: { value: '27/10/2026' } });
    fireEvent.change(screen.getByLabelText('Giờ — Giờ trả hàng'), { target: { value: '08' } });
    fireEvent.change(screen.getByLabelText('Phút — Giờ trả hàng'), { target: { value: '30' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.customerAppointmentAt).toBe('2026-10-26T07:00:00.000Z');
    expect(body.plannedEndAt).toBe('2026-10-27T01:30:00.000Z');
  });

  it('omits customerAppointmentAt from the save body when the field is untouched — omit = untouched', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect('customerAppointmentAt' in body).toBe(false);
  });

  it('blocks the save while the Giờ điều vận edit is incomplete — no silent clear (same law as Giờ trả hàng)', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.change(runHour(), { target: { value: '' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText('Giờ điều vận chưa hoàn chỉnh — chọn đủ ngày và giờ.')).toBeTruthy());
    expect(onAtomicSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role=dialog]')).toBeTruthy();
  });

  it('emptying the segments can never silently clear the saved appointment — blocked as incomplete', async () => {
    // The widget's own law (same as Giờ trả hàng, QA-2026-09-26-23): a
    // segment-emptied edit is 'incomplete', never a clean clear — Lưu must
    // block it instead of writing a silent null over the stored schedule.
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.change(runDay(), { target: { value: '' } });
    fireEvent.change(runHour(), { target: { value: '' } });
    fireEvent.change(runMinute(), { target: { value: '' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText('Giờ điều vận chưa hoàn chỉnh — chọn đủ ngày và giờ.')).toBeTruthy());
    expect(onAtomicSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role=dialog]')).toBeTruthy();
  });

  it('LCL lot rows render the field disabled with the reason — no per-container appointment authority', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue(savedPlan());
    renderCell(row({
      cargoMode: 'LCL',
      fulfillmentType: 'LCL_SHIPMENT',
      shipmentContainerId: null,
    }), onAtomicSave);
    await openDialog();
    expect(runHour()).toBeDisabled();
    expect(screen.getByText('Lô hàng lẻ (LCL) không có lịch hẹn theo container — giờ chạy theo lịch của lô.')).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect('customerAppointmentAt' in body).toBe(false);
  });

  it('an edited Giờ điều vận marks the plan dirty — Phát lệnh stays locked until the save', async () => {
    mockFleetResources();
    renderCell(row(), vi.fn().mockResolvedValue(savedPlan()));
    await openDialog();
    const issueButton = () => [...screen.getAllByRole('button')]
      .find((b) => b.classList.contains('dispatch-assignment-dialog__issue-btn')) as HTMLButtonElement;
    // No reason → no aria-disabled attribute at all (DisabledActionTip law).
    expect(issueButton().getAttribute('aria-disabled')).toBeNull();
    fireEvent.change(runHour(), { target: { value: '14' } });
    expect(issueButton().getAttribute('aria-disabled')).toBe('true');
  });
});
