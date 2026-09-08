import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(),
  };
});

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';

// The note composer pulls the tag pool through react-query; pin it so the
// modal tests stay provider-free and deterministic.
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({
    tags: [
      { id: 1, label: 'Đặt đầu' },
      { id: 2, label: 'Đặt đuôi' },
      { id: 3, label: 'Lấy vỏ ICD đi đóng' },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateDispatchTaskTag: () => ({
    createTag: vi.fn(async (label: string) => ({ id: 99, label })),
    isCreating: false,
  }),
}));

const listResourcesMock = vi.mocked(listDispatchFleetResources);

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
const OTHER_TRUCK = {
  ...PAIRED_TRUCK,
  id: 155,
  licensePlate: '30C-999.99',
  assignedDriverId: 9,
  assignedDriverName: 'Nguyễn Văn Khác',
};

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
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
  ...overrides,
} as DispatchDetailPlanRow);

/** Resource-aware fleet mock: the dialog issues TRUCK lookups in two shapes —
 *  the issue-time plate search ({q, limit:5}) and the vehicle-picker page
 *  ({limit:50}) — plus carrier/external lists on open. */
function mockFleetResources(opts: { issueLookup?: Array<typeof PAIRED_TRUCK> } = {}) {
  const trucks = opts.issueLookup ?? [PAIRED_TRUCK];
  listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
    }
    // TRUCK
    if (filters.limit === 5 && filters.q) {
      return { items: trucks, nextCursor: null, total: trucks.length, limit: 5 };
    }
    return { items: [PAIRED_TRUCK, OTHER_TRUCK], nextCursor: null, total: 2, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

type IssueOrderBody = Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>;

function renderCell(
  item: DispatchDetailPlanRow,
  handlers: {
    onAtomicSave?: (row: DispatchDetailPlanRow, body: Record<string, unknown>) => Promise<AtomicPlanSaveResult>;
    onIssueOrder?: (row: DispatchDetailPlanRow, body: IssueOrderBody) => Promise<DispatchShipmentResponse>;
    onOpenTripReassign?: (tripId: number) => void;
  } = {},
) {
  const defaultAtomicSave = vi.fn().mockResolvedValue({
    fulfillmentVersion: 4,
    shipmentVersion: 6,
    classification: 'SINGLE',
    isCombined: false,
    operationalNotes: null,
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    lotFullyPlated: false,
  });
  const defaultIssueOrder = vi.fn().mockResolvedValue({
    fulfillmentId: 101,
    version: 4,
    trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
    notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
    replayed: false,
  });
  return render(
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={(handlers.onAtomicSave as never) ?? (defaultAtomicSave as never)}
      onOpenTripReassign={(handlers.onOpenTripReassign as never) ?? (vi.fn() as never)}
      onIssueOrder={(handlers.onIssueOrder as never) ?? (defaultIssueOrder as never)}
    />,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Sửa ô điều phối/ }));
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

function issueButton(): HTMLButtonElement {
  return [...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Phát lệnh')) as HTMLButtonElement;
}

function setIssueTimes(start: string, end: string) {
  fireEvent.change(document.getElementById('dispatch-issue-start-101')!, { target: { value: start } });
  fireEvent.change(document.getElementById('dispatch-issue-end-101')!, { target: { value: end } });
}

describe('DispatchPlanEditorCell — driver note composer', () => {
  it('composes chips + manual text into the atomic save body and re-anchors', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: 'Đặt đầu; gọi lái trước 30p',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    mockFleetResources();
    renderCell(row({ notes: { vehicleNote: null, customerNote: null } }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt đầu' }));
    fireEvent.change(screen.getByLabelText('Ghi chú thêm'), { target: { value: 'gọi lái trước 30p' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave.mock.calls[0]![1]).toMatchObject({ operationalNotes: 'Đặt đầu; gọi lái trước 30p' });
    // Re-anchor: the draft now mirrors the stored note.
    await waitFor(() => expect(screen.getByText('Hiển thị: Đặt đầu; gọi lái trước 30p')).toBeTruthy());
  });
});

describe('DispatchPlanEditorCell — phát lệnh issue section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetResources();
  });

  it('hides the issue section and button for UNASSIGNED rows', async () => {
    renderCell(row({ dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } }));
    await openDialog();
    expect(screen.queryByText('Phát lệnh cho tài xế')).toBeNull();
    expect(issueButton()).toBeUndefined();
  });

  it('routes ISSUED rows to the trip-reassign flow instead of the editor', () => {
    const onOpenTripReassign = vi.fn();
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', tripId: 55, tripStatus: 'CREATED' },
    }), { onOpenTripReassign });
    fireEvent.click(screen.getByRole('button', { name: /Phân xe lại/ }));
    expect(onOpenTripReassign).toHaveBeenCalledWith(55);
    expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull();
  });

  it('shows the paired driver read-only and an enabled button for plated OWN rows', async () => {
    renderCell(row());
    await openDialog();
    expect(screen.getByText('Phát lệnh cho tài xế')).toBeTruthy();
    // Vehicle picker now labels options with the driver name too (recognizability
    // fix), so scope this assertion to the issue section's own driver line.
    expect(document.querySelector('.dispatch-assignment-dialog__issue-driver')?.textContent).toMatch(/Phạm Văn Hùng/);
    // The ownTruck plate lookup runs against the TRUCK search endpoint.
    expect(listResourcesMock).toHaveBeenCalledWith('TRUCK', expect.objectContaining({ q: '15H-052.82', limit: 5 }));
    await waitFor(() => expect(issueButton().disabled).toBe(false));
  });

  it('blocks issuing and explains when the plated truck has no paired driver', async () => {
    mockFleetResources({ issueLookup: [] }); // plate resolves to nothing
    const onIssueOrder = vi.fn();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    await waitFor(() => expect(screen.getByText(/chưa gán tài xế/)).toBeTruthy());
    expect(screen.getByText(/Danh mục Xe nội bộ/)).toBeTruthy();
    fireEvent.click(issueButton());
    await waitFor(() => expect(screen.getByText(/Xe chưa gán tài xế/)).toBeTruthy());
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('asks for the external driver name and blocks empty-name submission', async () => {
    const onIssueOrder = vi.fn();
    renderCell(row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: 'E2E-QA1' },
    }), { onIssueOrder });
    await openDialog();
    expect(screen.getByText('Tên tài xế (nhà xe ngoài)')).toBeTruthy();
    expect(screen.getByText('SĐT tài xế (nhà xe ngoài)')).toBeTruthy();
    fireEvent.click(issueButton());
    await waitFor(() => expect(screen.getByText(/Nhập tên tài xế nhà xe ngoài/)).toBeTruthy());
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('pre-fills issue times from the row schedule instead of the wall clock', async () => {
    const onIssueOrder = vi.fn();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    const startInput = document.getElementById('dispatch-issue-start-101') as HTMLInputElement;
    const endInput = document.getElementById('dispatch-issue-end-101') as HTMLInputElement;
    expect(startInput.value).toBe('2026-08-20T08:00');
    expect(endInput.value).toBe('2026-08-20T10:00');
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('issues an OWN order with the resolved truck/driver and closes the dialog', async () => {    const onIssueOrder = vi.fn().mockResolvedValue({
      fulfillmentId: 101, version: 4,
      trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
    renderCell(row(), { onIssueOrder });
    await openDialog();
    setIssueTimes('2026-08-30T08:00', '2026-08-30T12:00');
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    const [item, body] = onIssueOrder.mock.calls[0];
    expect(item.fulfillmentId).toBe(101);
    expect(body.carrierType).toBe('OWN');
    expect(body.truckId).toBe(154);
    expect(body.driverId).toBe(8);
    expect(body.endTimeConfirmed).toBe(true);
    expect(Number.isNaN(Date.parse(body.plannedStartAt))).toBe(false);
    expect(Number.isNaN(Date.parse(body.plannedEndAt))).toBe(false);
    expect(new Date(body.plannedEndAt).getTime()).toBeGreaterThan(new Date(body.plannedStartAt).getTime());
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });

  it('keeps the dialog open and surfaces the backend rejection message', async () => {
    const onIssueOrder = vi.fn().mockRejectedValue(new Error('Tài xế không còn hiệu lực để nhận lệnh.'));
    renderCell(row(), { onIssueOrder });
    await openDialog();
    setIssueTimes('2026-08-30T08:00', '2026-08-30T12:00');
    fireEvent.click(issueButton());
    await waitFor(() => expect(screen.getByText(/Tài xế không còn hiệu lực để nhận lệnh/)).toBeTruthy());
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
  });

  it('validates locally that the end time follows the start time', async () => {
    const onIssueOrder = vi.fn();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    setIssueTimes('2026-08-30T08:00', '2026-08-30T07:00');
    fireEvent.click(issueButton());
    await waitFor(() => expect(screen.getByText(/Giờ kết thúc phải sau giờ chạy/)).toBeTruthy());
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('re-anchors the draft after a keep-open save so issuing unblocks (03f9fcd2 regression)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    // Start from an unplated row: the dispatcher picks the truck in-dialog.
    const { rerender } = renderCell(row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }), { onAtomicSave });

    await openDialog();
    // Pick a truck from the vehicle select — draft now differs from the row.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15H-052' } });
    fireEvent.click(screen.getByRole('option', { name: /15H-052\.82/ }));
    // planDirty: no issue fieldset content yet, and the (absent) button would be disabled.
    expect(screen.queryByText('Phát lệnh cho tài xế')).toBeNull();

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    // A successful save must not surface the "cannot save" failure banner
    // (regression: a mangled try/catch made this fire unconditionally).
    expect(screen.queryByText(/Không thể lưu kế hoạch/)).toBeNull();
    // The parent would swap in the freshly plated row — mirror that here.
    rerender(
      <DispatchPlanEditorCell
        row={row({ version: 4, dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' } })}
        onAtomicSave={onAtomicSave as never}
        onOpenTripReassign={vi.fn() as never}
        onIssueOrder={vi.fn().mockResolvedValue({ fulfillmentId: 101, version: 5, trip: { id: 56, version: 1, tripCode: 'TRP-2', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null }, notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: false }, replayed: false }) as never}
      />,
    );
    // Draft re-anchored to the saved result: the issue section appears with the
    // paired driver and an ENABLED button — no close/reopen needed.
    await waitFor(() => expect(screen.getByText('Phát lệnh cho tài xế')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.dispatch-assignment-dialog__issue-driver')?.textContent).toContain('Phạm Văn Hùng'));
    await waitFor(() => expect(issueButton().disabled).toBe(false));
    expect(screen.queryByText(/Lưu thay đổi điều phối ở trên trước khi phát lệnh/)).toBeNull();
  });

  it('surfaces the failure banner when the plan save is rejected', async () => {
    const onAtomicSave = vi.fn().mockRejectedValue(new Error('Lô hàng đã thay đổi.'));
    renderCell(row(), { onAtomicSave });
    await openDialog();
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(screen.getByText(/Không thể lưu kế hoạch/)).toBeTruthy());
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
  });

  it('offers the dispatcher the three cont-model classifications and saves the chosen one', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'COMBINED',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(row({ classification: 'SINGLE' }), { onAtomicSave });
    await openDialog();

    // Exactly the three cont models — Lẻ is not offered on cont rows.
    fireEvent.click(screen.getByRole('button', { name: 'Đơn Phân loại' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Kết hợp' }));

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ classification: 'COMBINED' }),
    );
    // The lot-level flag has no control here — redundant with Kết hợp.
    expect(screen.queryByText('Đóng kết hợp (kẹp chuyến)')).toBeNull();
  });

  it('locks Phân loại to Lẻ on LCL rows (cargo-mode bound, not a per-cont choice)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'LCL',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(row({
      cargoMode: 'LCL',
      fulfillmentType: 'LCL_SHIPMENT',
      container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null } as never,
      classification: 'LCL' as never,
    }), { onAtomicSave });
    await openDialog();

    const trigger = screen.getByRole('button', { name: 'Lẻ Phân loại' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    // Locked select never opens a list offering the cont models.
    fireEvent.click(trigger);
    expect(screen.queryByRole('option', { name: 'Đơn' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Kết hợp' })).toBeNull();

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ classification: 'LCL' }),
    );
  });
});
