import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(),
    createCarrierFleetVehicle: vi.fn(),
  };
});

const getTrailersMock = vi.fn();
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

import { createCarrierFleetVehicle, listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
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
      // Canonical pool label (migration 0066) that the Lấy Lẻ auto-seed
      // writes into the driver note.
      { id: 4, label: 'ĐẢO VỎ' },
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
// Default trailer catalog for every describe: an empty list keeps the
// coupling-only default; the card-20261005_387 describe overrides per test.
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
  plannedEndAt: null,
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
    onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
    onEnsureFulfillment?: (row: DispatchDetailPlanRow) => Promise<DispatchDetailPlanRow | null>;
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
      onCompleteExternalTrip={(handlers.onCompleteExternalTrip as never) ?? (vi.fn() as never)}
      onIssueOrder={(handlers.onIssueOrder as never) ?? (defaultIssueOrder as never)}
      onEnsureFulfillment={handlers.onEnsureFulfillment}
    />,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Sửa ô điều phối/ }));
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

describe('UI52-B editor business identity', () => {
  it.each([
    { container: ' MSCU1234567 ', bill: 'BL-2026-010', expected: 'MSCU1234567' },
    { container: null, bill: ' BL-2026-010 ', expected: 'BL-2026-010' },
    { container: ' ', bill: ' BOOK-2026-010 ', expected: 'BOOK-2026-010' },
    { container: null, bill: null, expected: 'Chưa có số Bill/Booking' },
    { container: ' ', bill: ' ', expected: 'Chưa có số Bill/Booking' },
  ])('keeps $expected in the editor trigger/title and Cancel preserves the exact row', async ({ container, bill, expected }) => {
    mockFleetResources();
    const original = row();
    original.container = { ...original.container, containerNumber: container };
    original.docs = { ...original.docs, billNumber: bill };
    const onAtomicSave = vi.fn();
    renderCell(original, { onAtomicSave });
    const name = `Sửa ô điều phối ${expected}`;
    const trigger = screen.getByRole('button', { name });
    expect(trigger).toHaveAttribute('title', `Chỉnh sửa điều phối · ${expected}`);
    expect(trigger.getAttribute('aria-label')).not.toContain(original.shipmentCode);
    fireEvent.click(trigger);
    expect(await screen.findByRole('heading', { name: `Chỉnh sửa điều phối · ${expected}` })).toBeInTheDocument();
    expect(screen.getByLabelText('Nhà xe').id).toBe(`dispatch-carrier-${original.fulfillmentId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name })).toBe(trigger);
    expect(onAtomicSave).not.toHaveBeenCalled();
  });
});

describe('QA-AUDIT-UI-92 complete assignment facts', () => {
  it('keeps full facts outside one compact edit action and Cancel preserves the row', async () => {
    mockFleetResources();
    const original = row();
    original.dispatch = { ...original.dispatch, assignedDriverName: PAIRED_TRUCK.assignedDriverName };
    const saved = structuredClone(original);
    const onAtomicSave = vi.fn();
    const { container } = renderCell(original, { onAtomicSave });
    const trigger = screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' });
    expect(trigger).toHaveTextContent(/^Sửa$/);
    for (const text of [original.dispatch.carrierName ?? 'Chưa phân nhà xe', PAIRED_TRUCK.licensePlate, PAIRED_TRUCK.assignedDriverName, 'Đã điều xe']) {
      const fact = screen.getByText(text);
      expect(container.querySelector('.dispatch-assignment-cell')).toContainElement(fact);
      expect(trigger).not.toContainElement(fact);
    }
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' })).toBe(trigger);
    expect(trigger).toHaveFocus();
    expect(onAtomicSave).not.toHaveBeenCalled();
    expect(original).toEqual(saved);
  });
});

function issueButton(): HTMLButtonElement {
  // The row now carries its own labeled "Phát lệnh" action, so the dialog's
  // issue button is matched by its dedicated class, not by its text.
  return [...screen.getAllByRole('button')]
    .find((b) => b.classList.contains('dispatch-assignment-dialog__issue-btn')) as HTMLButtonElement;
}


describe('DispatchPlanEditorCell — assignment dialog validation', () => {
  beforeEach(() => { mockFleetResources(); });

  it('dialog form opts out of native constraint validation — app errors own empty submits', async () => {
    renderCell(row({ plannedEndAt: null }), {});
    await openDialog();
    expect(document.querySelector('form.dispatch-assignment-dialog')).toHaveAttribute('novalidate');
  });
});

describe('DispatchPlanEditorCell — Giờ trả hàng (customer request 26/09)', () => {
  const endField = () => screen.getByRole('group', { name: 'Giờ trả hàng' });
  const daySeg = () => screen.getByLabelText('Ngày — Giờ trả hàng') as HTMLInputElement;
  const hourSeg = () => screen.getByLabelText('Giờ — Giờ trả hàng') as HTMLInputElement;

  it('prefills the Giờ trả hàng field in Vietnam wall-clock', async () => {
    mockFleetResources();
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), {});
    await openDialog();
    expect(endField()).toBeTruthy();
    expect(daySeg().value).toBe('05');
    expect(hourSeg().value).toBe('15');
  });

  it('bug #316 prefills Giờ trả hàng from inherited runAt when plannedEndAt is null', async () => {
    mockFleetResources();
    renderCell(row({
      plannedEndAt: null,
      time: { deliveryDate: '2026-10-10', runAt: '2026-10-10T03:00:00.000Z', runHour: 10 },
    }), {});
    await openDialog();
    expect(endField()).toBeTruthy();
    expect(daySeg().value).toBe('10');
    expect(hourSeg().value).toBe('10');
  });

  it('bug #316 keeps plannedEndAt omitted when prefilled runAt is untouched', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.83' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
    });
    mockFleetResources();
    renderCell(row({
      plannedEndAt: null,
      time: { deliveryDate: '2026-10-10', runAt: '2026-10-10T03:00:00.000Z', runHour: 10 },
    }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect('plannedEndAt' in onAtomicSave.mock.calls[0]![1]).toBe(false);
  });

  it('sends zone-aware ISO on save (15:30 +07:00 → 08:30Z)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
    });
    mockFleetResources();
    renderCell(row({ plannedEndAt: null }), { onAtomicSave });
    await openDialog();
    fireEvent.change(screen.getByLabelText('Ngày — Giờ trả hàng'), { target: { value: '05/10/2026' } });
    fireEvent.change(hourSeg(), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Phút — Giờ trả hàng'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave.mock.calls[0]![1]).toMatchObject({ plannedEndAt: '2026-10-05T08:30:00.000Z' });
  });

  it('omits plannedEndAt from the save body when untouched — omit = untouched contract', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.83' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
    });
    mockFleetResources();
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect('plannedEndAt' in onAtomicSave.mock.calls[0]![1]).toBe(false);
  });

  it('QA-2026-09-26-23 blocks the save while the Giờ trả hàng edit is incomplete — no silent clear', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
    });
    mockFleetResources();
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    // Partial edit: EMPTY the day segment — the field reports incomplete, so
    // Lưu must be BLOCKED, never write a silent clear of the stored instant.
    fireEvent.change(screen.getByLabelText('Ngày — Giờ trả hàng'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).not.toHaveBeenCalled());
    expect(screen.getByText('Giờ trả hàng chưa hoàn chỉnh — chọn đủ ngày và giờ.')).toBeTruthy();
    expect((document.querySelector('[role=dialog]'))).toBeTruthy();
  });
});

describe('DispatchPlanEditorCell — driver note composer', () => {
  it('card 081026091120: the note field states it is the lot-shared note, not per-container', async () => {
    mockFleetResources();
    renderCell(row({ notes: { vehicleNote: null, customerNote: null } }), { onAtomicSave: vi.fn() });
    await openDialog();
    // The note is stored at the lot level — every container in the lot shows
    // it. The dialog must say so, or dispatchers read it as per-container.
    expect(await screen.findByText(/Ghi chú dùng chung cả lô/)).toBeTruthy();
  });

  it('composes chips + manual text into the atomic save body and re-anchors', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: 'Đặt đầu\ngọi lái trước 30p',
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
    expect(onAtomicSave.mock.calls[0]![1]).toMatchObject({ operationalNotes: 'Đặt đầu\ngọi lái trước 30p' });
    // Saving closes the dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

  it('routes in-flight (IN_TRANSIT) trips to the reassign flow too — the plan is no longer editable', () => {
    const onOpenTripReassign = vi.fn();
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', tripId: 55, tripStatus: 'IN_TRANSIT' },
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

  it('issues external rows without a driver name — the name is optional', async () => {
    const onIssueOrder = vi.fn().mockResolvedValue({
      fulfillmentId: 101, version: 4,
      trip: { id: 56, version: 1, tripCode: 'TRP-2', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'EXTERNAL', truckId: null, trailerId: null, driverId: null, externalCarrierId: 9, externalPlateNumber: 'E2E-QA1', externalDriverName: null, externalDriverPhone: null },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: false, pushAttempted: false },
      replayed: false,
    });
    renderCell(row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: 'E2E-QA1' },
    }), { onIssueOrder });
    await openDialog();
    expect(screen.getByText('Tên tài xế (nhà xe ngoài) — không bắt buộc')).toBeTruthy();
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    const [, body] = onIssueOrder.mock.calls[0];
    expect(body.carrierType).toBe('EXTERNAL');
    expect(body.externalDriverName).toBeFalsy();
  });

  it('flips the row chip to Đã hoàn thành and locks the editor once the trip completes', () => {
    const onOpenTripReassign = vi.fn();
    renderCell(row({
      taskStatus: 'COMPLETED',
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: 'E2E-QA1', tripId: 77, tripStatus: 'COMPLETED' },
    }), { onOpenTripReassign });
    expect(screen.getByText('Đã hoàn thành')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Phát lệnh nhanh/ })).toBeNull();
    // The plan is frozen history — the trigger locks with an explanation and
    // never opens the editor (its save would only 409 at the live-trip guard).
    const trigger = screen.getByRole('button', { name: /Sửa ô điều phối/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toMatch(/Chuyến đã hoàn thành/);
    fireEvent.click(trigger);
    expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull();
  });

  it('renders no date/time inputs — the customer ruling removed the picker', async () => {
    const onIssueOrder = vi.fn();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    expect(document.getElementById('dispatch-issue-start-101')).toBeNull();
    expect(document.getElementById('dispatch-issue-end-101')).toBeNull();
    expect(document.getElementById('dispatch-issue-date-101')).toBeNull();
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('issues an OWN order with schedule-derived times, resolved truck/driver, and closes the dialog', async () => {    const onIssueOrder = vi.fn().mockResolvedValue({
      fulfillmentId: 101, version: 4,
      trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
    renderCell(row(), { onIssueOrder });
    await openDialog();
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    const [item, body] = onIssueOrder.mock.calls[0];
    expect(item.fulfillmentId).toBe(101);
    expect(body.carrierType).toBe('OWN');
    expect(body.truckId).toBe(154);
    expect(body.driverId).toBe(8);
    expect(body.endTimeConfirmed).toBe(true);
    // Planned times derive from the row's CUS-locked schedule (2026-08-20 08:00 +2h).
    expect(body.plannedStartAt).toBe(new Date('2026-08-20T08:00+07:00').toISOString());
    expect(new Date(body.plannedEndAt).getTime()).toBeGreaterThan(new Date(body.plannedStartAt).getTime());
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });

  it('keeps the dialog open and surfaces the backend rejection message', async () => {
    const onIssueOrder = vi.fn().mockRejectedValue(new Error('Tài xế không còn hiệu lực để nhận lệnh.'));
    renderCell(row(), { onIssueOrder });
    await openDialog();
    fireEvent.click(issueButton());
    await waitFor(() => expect(screen.getByText(/Tài xế không còn hiệu lực để nhận lệnh/)).toBeTruthy());
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
  });

  it('end-after-start still holds when the row has no schedule hour (clock fallback)', async () => {
    const onIssueOrder = vi.fn().mockResolvedValue({
      fulfillmentId: 101, version: 4,
      trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
      replayed: false,
    });
    const unscheduled = { ...row(), time: { deliveryDate: null, runHour: null } };
    renderCell(unscheduled, { onIssueOrder });
    await openDialog();
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    const [, body] = onIssueOrder.mock.calls[0];
    expect(new Date(body.plannedEndAt).getTime()).toBeGreaterThan(new Date(body.plannedStartAt).getTime());
  });

  it('closes the dialog upon successful save', async () => {
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
    renderCell(row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }), { onAtomicSave });

    await openDialog();
    // Pick a truck from the vehicle select — draft now differs from the row.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15H-052' } });
    fireEvent.click(screen.getByRole('option', { name: /15H-052\.82/ }));

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    // A successful save must not surface the "cannot save" failure banner
    expect(screen.queryByText(/Không thể lưu kế hoạch/)).toBeNull();
    // And closes the dialog
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers the free-text plate option on a carrier-less row so plate→carrier autofill can fire', async () => {
    // Regression: the free-text option used to require a SELECTED external
    // carrier while the autofill guard requires NO carrier — mutually
    // exclusive, so the autofill UX was unreachable on carrier-less rows.
    renderCell(row({
      dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }));
    await openDialog();
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15H-061.14' } });
    expect(await screen.findByRole('option', { name: /Dùng biển số: 15H-061\.14/ })).toBeTruthy();
  });

  it('decomposes a fulfillment-less branch row before opening the editor', async () => {
    const onEnsureFulfillment = vi.fn(async (branch: DispatchDetailPlanRow) => (
      { ...branch, fulfillmentId: 999, version: 1 }
    ));
    renderCell(row({ fulfillmentId: null as unknown as number }), { onEnsureFulfillment });

    await openDialog();

    expect(onEnsureFulfillment).toHaveBeenCalledTimes(1);
    expect(onEnsureFulfillment.mock.calls[0]![0].fulfillmentId).toBeNull();
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
  });

  it('does not open the editor when the branch decompose fails', async () => {
    const onEnsureFulfillment = vi.fn(async () => null);
    renderCell(row({ fulfillmentId: null as unknown as number }), { onEnsureFulfillment });

    fireEvent.click(screen.getByRole('button', { name: /Sửa ô điều phối/ }));
    await waitFor(() => expect(onEnsureFulfillment).toHaveBeenCalledTimes(1));

    expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull();
  });

  it('surfaces the backend 409 reason inline when the plan save is rejected', async () => {
    const onAtomicSave = vi.fn().mockRejectedValue({ status: 409, message: 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.' });
    renderCell(row(), { onAtomicSave });
    await openDialog();
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(screen.getByText(/Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe/)).toBeTruthy());
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
  });

  it('falls back to the generic save-failure text for non-409 rejections', async () => {
    const onAtomicSave = vi.fn().mockRejectedValue({ status: 500, message: 'Lỗi máy chủ' });
    renderCell(row(), { onAtomicSave });
    await openDialog();
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(screen.getByText(/Không thể lưu kế hoạch\. Kiểm tra thông báo của bảng/)).toBeTruthy());
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

  it('offers Lẻ ONLY on LCL rows — never Lấy Lẻ, never the cont models (card 20261006_392)', async () => {
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
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    // Card 20261006_392: an LCL lot is ONE whole-lot LCL_SHIPMENT fulfillment and
    // shipment_fulfillments_lcl_dispatch_classification_check pins its
    // classification to 'LCL'. Offering 'Lấy Lẻ' here produced a save that died
    // on that constraint as a raw 23514 surfaced as HTTP 500 — the option list
    // must not offer a value the row can never store.
    expect(screen.getByRole('option', { name: 'Lẻ' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Lấy Lẻ' })).toBeNull();
    // The cont models stay off an LCL lot — it is bound to its cargo mode.
    expect(screen.queryByRole('option', { name: 'Đơn' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Kẹp' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Kết hợp' })).toBeNull();

    // Re-pick the current value to close the list (an open listbox replaces
    // the dialog's save row) and leave the draft untouched.
    fireEvent.click(screen.getByRole('option', { name: 'Lẻ' }));
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ classification: 'LCL' }),
    );
  });

  it('choosing Lấy Lẻ seeds NO tag on a CONTAINER row — the note stays the dispatcher\'s own (card 362)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'LCL_PICKUP',
      isCombined: false,
      operationalNotes: 'ĐẢO VỎ\nhọp chị An 8h',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    // Card 20261006_392 moved this case off the LCL lot: 'Lấy Lẻ' is the 40'
    // empty-shell pickup run and belongs on a CONTAINER row. It cannot be stored
    // on an LCL_SHIPMENT row at all. Card 362's intent — no shell-tag seed — is
    // preserved, on the row type where the option is legal.
    renderCell(row({
      cargoMode: 'FCL',
      fulfillmentType: 'FCL_CONTAINER',
      container: { containerNumber: 'MSKU1234565', containerTypeLabel: "20'DC", cargoWeightKg: null } as never,
      classification: 'SINGLE' as never,
      notes: { vehicleNote: 'họp chị An 8h', customerNote: null },
    }), { onAtomicSave });
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: /Phân loại/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Lấy Lẻ' }));
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        classification: 'LCL_PICKUP',
        // Card 20261005_362: no shell-tag seed — the note is untouched; the
        // dispatcher picks task tags manually.
        operationalNotes: 'họp chị An 8h',
      }),
    );
  });
});

describe('DispatchPlanEditorCell — editor mount stability across background refreshes', () => {
  // Background refetches give the row prop a fresh object identity. The
  // editor cell must survive that re-render with its open state and unsaved
  // draft intact — in production the grid used to unmount it wholesale by
  // flipping to the skeleton on every 30s auto-refresh (2026-09-09 bug).
  function cellProps(item: DispatchDetailPlanRow) {
    return {
      row: item,
      onAtomicSave: vi.fn().mockResolvedValue({
        fulfillmentVersion: 4,
        shipmentVersion: 6,
        classification: 'SINGLE',
        isCombined: false,
        operationalNotes: null,
        dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
        estimates: { plannedRevenue: null, plannedCarrierCost: null },
        lotFullyPlated: false,
      }),
      onOpenTripReassign: vi.fn(),
      onCompleteExternalTrip: vi.fn(),
      onIssueOrder: vi.fn().mockResolvedValue({
        fulfillmentId: 101,
        version: 4,
        trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
        notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
        replayed: false,
      }),
    };
  }

  it('stays open with the draft intact across a fresh row-object render, and closes on Hủy', async () => {
    mockFleetResources();
    const view = render(<DispatchPlanEditorCell {...cellProps(row())} />);
    await openDialog();

    // Unsaved draft work the refresh must not discard.
    fireEvent.change(screen.getByLabelText('Ghi chú thêm'), { target: { value: 'bảo lãnh trước 30p' } });

    // Background refresh: same fulfillmentId, new object identity + version.
    view.rerender(<DispatchPlanEditorCell {...cellProps(row({ version: 4 }))} />);

    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
    expect((screen.getByLabelText('Ghi chú thêm') as HTMLTextAreaElement).value).toBe('bảo lãnh trước 30p');

    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });

  it('auto-loads the own-fleet TRUCK list when the editor opens on a carrier-less row', async () => {
    const carrierLess = row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });
    mockFleetResources();
    renderCell(carrierLess);
    await openDialog();

    await waitFor(() => expect(listResourcesMock).toHaveBeenCalledWith('TRUCK', expect.objectContaining({ fulfillmentId: 101 })));
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn biển số xe'))!);
    expect((await screen.findAllByText(/15H-052\.82/)).length).toBeGreaterThan(0);
  });

  it('promotes a truck pick on a carrier-less row to the OWN carrier so save passes', async () => {
    const carrierLess = row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(carrierLess, { onAtomicSave });
    await openDialog();

    // Open the vehicle combobox and pick the own-fleet truck.
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn biển số xe'))!);
    const truckOption = (await screen.findAllByText(/15H-052\.82/))[0];
    fireEvent.click(truckOption);
    expect(screen.getByText('SilverSea — xe nội bộ')).toBeTruthy();

    // Save must now pass the carrier check with the promoted OWN carrier.
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.carrierType).toBe('OWN');
    expect(body.truckId).toBe(154);
  });

  it("fills a linked truck's owning carrier instead of the internal default", async () => {
    const carrierLess = row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });
    // One page truck carries an ACTIVE fleet carrier link — the explicit link
    // must win over the generic SilverSea default.
    mockFleetResources();
    listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
      if (resource === 'EXTERNAL_CARRIER') {
        return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
      }
      if (resource === 'EXTERNAL_VEHICLE') {
        return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
      }
      return {
        items: [PAIRED_TRUCK, { ...OTHER_TRUCK, id: 156, licensePlate: '15E-016.26', carrierId: 9, carrierName: 'Carrier QA' }],
        nextCursor: null,
        total: 2,
        limit: filters.limit ?? 50,
        suggestedItems: [],
      };
    }) as never);
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: '15E-016.26' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(carrierLess, { onAtomicSave });
    await openDialog();

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn biển số xe'))!);
    const linkedOption = (await screen.findAllByText(/15E-016\.26/))[0];
    fireEvent.click(linkedOption);

    // Carrier select shows the owning nhà xe — not "SilverSea — xe nội bộ".
    expect(screen.getByText('Carrier QA')).toBeTruthy();

    // Save sends the EXTERNAL carrier + the linked plate as free text (the
    // truck rides as its owning carrier's plate).
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.carrierType).toBe('EXTERNAL');
    expect(body.externalCarrierId).toBe(9);
    expect(body.plateNumber).toBe('15E-016.26');
    expect(body.truckId).toBeUndefined();
  });

  it('refines the issued chip to Đã nhận lệnh once the driver acknowledged', async () => {
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: {
        ...row().dispatch,
        tripId: 55,
        driverAccepted: true,
      } as never,
    }));
    await openDialog();

    expect(screen.getByText('Đã nhận lệnh')).toBeTruthy();
    expect(screen.queryByText('Đã phát lệnh cho tài xế')).toBeNull();
  });

  it('keeps the external path intact on an external-carrier row (regression)', async () => {
    const externalRow = row({ dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null } });
    mockFleetResources();
    renderCell(externalRow);
    await openDialog();

    await waitFor(() => expect(listResourcesMock).toHaveBeenCalledWith('EXTERNAL_VEHICLE', expect.objectContaining({ carrierId: 9 })));
  });

  it('points the vehicle list at the picked external carrier on a carrier-less row (EXTERNAL pick must not stay own-fleet)', async () => {
    listResourcesMock.mockClear();
    const carrierLess = row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });
    mockFleetResources();
    renderCell(carrierLess);
    await openDialog();

    // Carrier-less default: own-fleet TRUCK auto-load.
    await waitFor(() => expect(listResourcesMock).toHaveBeenCalledWith('TRUCK', expect.objectContaining({ fulfillmentId: 101 })));

    // Picking an external carrier must switch the vehicle list to that carrier's fleet.
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn nhà xe'))!);
    fireEvent.click((await screen.findAllByText('Carrier QA'))[0]);
    await waitFor(() => expect(listResourcesMock).toHaveBeenCalledWith('EXTERNAL_VEHICLE', expect.objectContaining({ carrierId: 9 })));

    // …and no own-fleet reload may follow the EXTERNAL pick.
    const externalCallIndex = listResourcesMock.mock.calls.findIndex(([resource]) => resource === 'EXTERNAL_VEHICLE');
    expect(externalCallIndex).toBeGreaterThan(-1);
    expect(listResourcesMock.mock.calls.slice(externalCallIndex + 1).some(([resource]) => resource === 'TRUCK')).toBe(false);
  });

  it('surfaces fleet-fetch failures with a retry instead of a fake-empty list', async () => {
    listResourcesMock.mockRejectedValue(new Error('outage'));
    const carrierLess = row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });
    renderCell(carrierLess);
    await openDialog();

    expect(await screen.findByText(/Không tải được danh sách xe/)).toBeTruthy();
    // Restore the fleet and retry via the vehicle-select retry affordance.
    mockFleetResources();
    const retryButtons = screen.getAllByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn biển số xe'))!);
    expect((await screen.findAllByText(/15H-052\.82/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Không tải được danh sách xe/)).toBeNull();
  });
});

describe('DispatchPlanEditorCell — vehicle picker trailer compatibility', () => {
  // Mirrors of the backend issue gate (inferTrailerTypeFromContainerCode):
  // a container code starting with 20 needs a 20FT trailer, anything else a
  // 40FT one — a provable mismatch 409s at Phát lệnh ("Rơ-moóc không phù hợp
  // với loại container").
  // The capacity advisory (AC DISP-MP-02) shares the ⚠ glyph, so the
  // trailer tests assert on the 'rơ-moóc' copy instead of the glyph alone.
  const FIT_TRUCK = PAIRED_TRUCK; // 20FT, plate 15H-052.82
  const MISMATCH_TRUCK = { ...OTHER_TRUCK, id: 156, licensePlate: '60C-123.45', trailerType: '40FT' };
  const UNKNOWN_TRUCK = { ...PAIRED_TRUCK, id: 157, licensePlate: '70H-000.01', trailerType: null };

  function mockTruckPage(trucks: Array<Record<string, unknown>>, suggestedItems: Array<Record<string, unknown>> = []) {
    listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
      if (resource === 'EXTERNAL_CARRIER') return { items: [], nextCursor: null, total: 0, limit: 50 };
      if (resource === 'EXTERNAL_VEHICLE') return { items: [], nextCursor: null, total: 0, limit: 50 };
      if (filters.limit === 5 && filters.q) return { items: trucks, nextCursor: null, total: trucks.length, limit: 5 };
      return { items: trucks, nextCursor: null, total: trucks.length, limit: 50, suggestedItems };
    }) as never);
  }

  async function openVehicleDropdown() {
    await openDialog();
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    return (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
  }

  it('annotates and demotes a trailer-incompatible truck on a 20-foot container row', async () => {
    // The fleet serves the mismatch first — the picker must not let the
    // operator's first pick be a truck the issue gate will reject.
    mockTruckPage([MISMATCH_TRUCK, FIT_TRUCK]);
    renderCell(row());
    const options = await openVehicleDropdown();

    const fitLabel = options.find((label) => label.includes('15H-052.82'))!;
    const mismatchLabel = options.find((label) => label.includes('60C-123.45'))!;
    expect(fitLabel).not.toContain('rơ-moóc');
    expect(mismatchLabel).toContain('⚠ rơ-moóc 40FT, cần 20FT');
    expect(options.indexOf(mismatchLabel)).toBe(options.length - 1);
  });

  it('VID-DSP-03 ranks a40FT moóc as compatible for two20ft Kẹp containers', async () => {
    mockTruckPage([FIT_TRUCK, MISMATCH_TRUCK]);
    renderCell(row({ classification: 'DOUBLE' }));
    const options = await openVehicleDropdown();
    expect(options.find((label) => label.includes('60C-123.45'))).not.toContain('rơ-moóc');
    expect(options.find((label) => label.includes('15H-052.82'))).toContain('cần 40FT');
  });

  it('keeps an unknown trailer type unannotated but below a fitting truck', async () => {
    mockTruckPage([UNKNOWN_TRUCK, FIT_TRUCK]);
    renderCell(row());
    const options = await openVehicleDropdown();

    // No provable mismatch → no warning; the fit still outranks "unknown".
    expect(options.every((label) => !label.includes('rơ-moóc'))).toBe(true);
    expect(options.findIndex((label) => label.includes('15H-052.82'))).toBeLessThan(options.findIndex((label) => label.includes('70H-000.01')));
  });

  it('mirrors the backend rule in the 40-foot direction too', async () => {
    // The row's current plate is pinned to the top of the list by the
    // current-vehicle fold — point it at the fitting truck so the ranking of
    // the fetched options is what's under test.
    mockTruckPage([FIT_TRUCK, MISMATCH_TRUCK]);
    renderCell(row({
      container: { containerNumber: 'MSCU7654321', containerTypeLabel: '40HC', cargoWeightKg: '24000.00' },
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '60C-123.45' },
    }));
    const options = await openVehicleDropdown();

    const fitLabel = options.find((label) => label.includes('60C-123.45'))!;
    const mismatchLabel = options.find((label) => label.includes('15H-052.82'))!;
    expect(fitLabel).not.toContain('rơ-moóc');
    expect(mismatchLabel).toContain('⚠ rơ-moóc 20FT, cần 40FT');
    expect(options.indexOf(mismatchLabel)).toBe(options.length - 1);
  });

  it('keeps the row\'s current plate pinned first but annotated when it mismatches', async () => {
    // The current assignment must stay findable at the top (it's the existing
    // choice), yet visibly warn so the operator knows Phát lệnh will reject it.
    mockTruckPage([FIT_TRUCK, MISMATCH_TRUCK]);
    renderCell(row({ container: { containerNumber: 'MSCU7654321', containerTypeLabel: '40HC', cargoWeightKg: '24000.00' } }));
    const options = await openVehicleDropdown();

    expect(options[0]).toContain('15H-052.82');
    expect(options[0]).toContain('⚠ rơ-moóc 20FT, cần 40FT');
    expect(options[options.length - 1]).not.toContain('rơ-moóc');
  });

  it('marks an option whose capacity is below the row cargo weight and leaves a fitting one unmarked (AC DISP-MP-02)', async () => {
    // Same 20FT trailer in both cases — only the inferred capacity differs
    // (backend TRAILER_CAPACITY_KG: 20FT → 18000, 40FT → 30000).
    const overloaded = { ...FIT_TRUCK, id: 158, licensePlate: '51C-111.11', capacityKg: '18000' };
    const fitting = { ...FIT_TRUCK, id: 159, licensePlate: '51C-222.22', capacityKg: '30000' };
    mockTruckPage([overloaded, fitting]);
    renderCell(row());
    const options = await openVehicleDropdown();

    expect(options.find((label) => label.includes('51C-111.11'))).toContain('⚠ Vượt tải trọng khả dụng');
    expect(options.find((label) => label.includes('51C-222.22'))).not.toContain('⚠');
  });

  it('carries the mismatch warning on pinned D±1 suggestion labels too', async () => {
    // The proximity suggestion pins the truck to the top of the list — the
    // warning must travel with the pinned label, not just the page list.
    mockTruckPage([FIT_TRUCK, MISMATCH_TRUCK], [{ truckId: 156, plateNumber: '60C-123.45', reasons: ['D-1_DROP'] }]);
    renderCell(row());
    const options = await openVehicleDropdown();

    expect(options.some((label) => label.includes('60C-123.45 — Hạ tại khu vực D-1 — ⚠ rơ-moóc 40FT, cần 20FT'))).toBe(true);
  });
});

describe('DispatchPlanEditorCell — quick-add plate for the selected carrier (card 20261004_357)', () => {
  const createVehicleMock = vi.mocked(createCarrierFleetVehicle);

  beforeEach(() => {
    createVehicleMock.mockReset();
  });

  // Carrier-less rows render the 'Chọn nhà xe' placeholder — the same trigger
  // pattern the vehicle combobox tests drive.
  const carrierLessRow = () => row({ dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } });

  async function selectExternalCarrier() {
    // Open the Nhà xe combobox and pick the mocked external carrier (EXT:9).
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn nhà xe'))!);
    const carrierOption = await screen.findAllByText('Carrier QA');
    fireEvent.click(carrierOption[carrierOption.length - 1]);
    await waitFor(() => expect(screen.getByText('Carrier QA')).toBeTruthy());
  }

  it('offers "+ Thêm nhanh" only while an external carrier is selected, and absent for OWN', async () => {
    mockFleetResources();
    renderCell(carrierLessRow());
    await openDialog();

    // No carrier yet: no affordance.
    expect(screen.queryByText('Thêm nhanh')).toBeNull();

    await selectExternalCarrier();
    expect(screen.getByText('Thêm nhanh')).toBeTruthy();
  });

  it('creates the plate through the Xe ngoài API and preselects it', async () => {
    mockFleetResources();
    createVehicleMock.mockResolvedValue({ id: 77, carrierId: 9, licensePlate: '29C-111.22', isActive: true });
    renderCell(carrierLessRow());
    await openDialog();
    await selectExternalCarrier();

    fireEvent.click(screen.getByText('Thêm nhanh'));
    expect(await screen.findByText('Thêm nhanh biển số xe')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29c 111.22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createVehicleMock).toHaveBeenCalledWith({ carrierId: 9, licensePlate: '29C 111.22' }));
    // Dialog closes; the new plate is preselected in the combobox trigger.
    await waitFor(() => expect(screen.queryByText('Thêm nhanh biển số xe')).toBeNull());
    await waitFor(() => expect(screen.getAllByText('29C-111.22').length).toBeGreaterThan(0));
  });

  it('surfaces the API error inline instead of closing', async () => {
    mockFleetResources();
    createVehicleMock.mockRejectedValue(new Error('Biển số xe đã tồn tại'));
    renderCell(carrierLessRow());
    await openDialog();
    await selectExternalCarrier();

    fireEvent.click(screen.getByText('Thêm nhanh'));
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29C-111.22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(await screen.findByText('Biển số xe đã tồn tại')).toBeTruthy();
    // Dialog stays open for correction.
    expect(screen.getByText('Thêm nhanh biển số xe')).toBeTruthy();
  });
});

describe('DispatchPlanEditorCell — "Bổ sung sau" deferred plate (card 20261004_359)', () => {
  const deferredRow = () => row({
    taskStatus: 'READY',
    dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null },
  });

  it('leads the EXTERNAL vehicle list with "Bổ sung sau"; absent for OWN', async () => {
    mockFleetResources();
    renderCell(deferredRow());
    await openDialog();

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn hoặc nhập biển số'))!);
    const listbox = await screen.findAllByRole('listbox');
    void listbox;
    const option = screen.getAllByText('Bổ sung sau')[0];
    expect(option).toBeTruthy();
    // First among the vehicle options rendered inside the dropdown panel.
    const dropdownOptions = [...document.querySelectorAll('[role=option], .searchable-select__option')].map((el) => el.textContent?.trim());
    expect(dropdownOptions[0]).toBe('Bổ sung sau');
  });

  it('saves the deferred choice as carrier-with-no-vehicle-fields (no plate on the wire)', async () => {
    mockFleetResources();
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(deferredRow(), { onAtomicSave });
    await openDialog();

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn hoặc nhập biển số'))!);
    fireEvent.click((await screen.findAllByText('Bổ sung sau'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.carrierType).toBe('EXTERNAL');
    expect(body.externalCarrierId).toBe(9);
    expect(body.externalCarrierVehicleId).toBeUndefined();
    expect(body.plateNumber).toBeUndefined();
    expect(body.truckId).toBeUndefined();
  });

  it('shows the Phát lệnh section for a saved deferred row (AWAITING_PLATE is issuable)', async () => {
    mockFleetResources();
    renderCell(deferredRow());
    await openDialog();

    // AWAITING_PLATE (carrier assigned, no plate) — the issue section and its
    // Phát lệnh button are reachable exactly like a plated row.
    expect(screen.getByText('Phát lệnh cho tài xế')).toBeTruthy();
  });
});

// Card 20261005_387 — per-trip trailer override on the EXISTING issue API
// (POST /shipments/:id/dispatch already accepts trailerId; until now no FE
// sent it, so every trip rode the tractor's current coupling). Default stays
// the coupling (trailerId omitted from the body); a picked trailer rides as
// trailerId with a comparison note naming both plates; the backend's three
// 409 trailer gates surface through the issue error line untouched.
describe('DispatchPlanEditorCell — trailer override on phát lệnh (card 20261005_387)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetResources();
    getTrailersMock.mockResolvedValue([
      { id: 2, licensePlate: '15R-182.06', type: '20FT', status: 'ACTIVE' },
      { id: 7, licensePlate: '30R-555.55', type: '40FT', status: 'ACTIVE' },
      { id: 8, licensePlate: 'OLD-TRAILER', type: null, status: 'INACTIVE' },
    ]);
  });

  const issueOk = () => vi.fn().mockResolvedValue({
    fulfillmentId: 101, version: 4,
    trip: { id: 55, version: 1, tripCode: 'TRP-1', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 154, trailerId: 2, driverId: 8, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
    notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true },
    replayed: false,
  });

  it('shows the tractor coupling and omits trailerId when no override is picked', async () => {
    const onIssueOrder = issueOk();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    expect(await screen.findByText(/Moóc đang ghép: 15R-182\.06/)).toBeTruthy();
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    const [, body] = onIssueOrder.mock.calls[0];
    expect(body.trailerId).toBeUndefined();
  });

  it('sends trailerId and names both plates when an override is picked', async () => {
    const onIssueOrder = issueOk();
    renderCell(row(), { onIssueOrder });
    await openDialog();
    // UuiSelectField is React Aria: click the trigger, then the portalled
    // option (the PhoiPhieuControlPage.selection idiom).
    fireEvent.click(await screen.findByRole('button', { name: /Moóc cho chuyến \(ghi đè\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: /30R-555\.55 · 40FT/ }, { timeout: 10_000 }));
    expect(screen.getByText(/Ghi đè moóc: 30R-555\.55/)).toBeTruthy();
    expect(screen.getByText(/thay cho moóc đang ghép 15R-182\.06/)).toBeTruthy();
    fireEvent.click(issueButton());
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    expect(onIssueOrder.mock.calls[0][1].trailerId).toBe(7);
  });

  it('keeps an inactive trailer out of the override options', async () => {
    renderCell(row());
    await openDialog();
    fireEvent.click(await screen.findByRole('button', { name: /Moóc cho chuyến \(ghi đè\)/ }));
    expect(await screen.findByRole('option', { name: /30R-555\.55 · 40FT/ }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /OLD-TRAILER/ })).toBeNull();
  });

  it('surfaces the backend 409 trailer gate message on issue', async () => {
    const onIssueOrder = vi.fn().mockRejectedValue(new Error('Rơ-moóc không phù hợp với loại container.'));
    renderCell(row(), { onIssueOrder });
    await openDialog();
    fireEvent.click(issueButton());
    expect(await screen.findByText('Rơ-moóc không phù hợp với loại container.')).toBeTruthy();
  });
});

describe('DispatchPlanEditorCell — completed-trip overlap confirm (card 061026172804)', () => {
  it('a 409 RIG_OVERLAP_COMPLETED warns via confirm; confirming retries the save with the flag', async () => {
    const apiError = Object.assign(new Error('Đầu xe 15H-052.82 có 1 chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?'), {
      status: 409,
      raw: { code: 'RIG_OVERLAP_COMPLETED' },
    });
    const onAtomicSave = vi.fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValue({
        fulfillmentVersion: 5,
        shipmentVersion: 7,
        classification: 'SINGLE',
        isCombined: false,
        operationalNotes: null,
        dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
        estimates: { plannedRevenue: null, plannedCarrierCost: null },
        lotFullyPlated: false,
      });
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    // The warning surfaces as the house confirm dialog, not an inline error.
    expect(await screen.findByText('Xác nhận')).toBeTruthy();
    expect(screen.getByText(/chuyến đã hoàn thành trùng khung giờ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(2));
    const retryBody = onAtomicSave.mock.calls[1][1] as { rigOverlapCompletedConfirmed?: boolean };
    expect(retryBody.rigOverlapCompletedConfirmed).toBe(true);
    // The retry closed the dialog (save succeeded).
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });
});
