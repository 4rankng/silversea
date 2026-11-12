import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// SIL-796 r2 — the dialog's cước-trả seed folds the container class code +
// weight onto the board's LIGHT/HEAVY class ids; the hook is mocked (this
// file renders without a QueryClientProvider) with the seeded catalog ids.
const { sizeClassesFixture } = vi.hoisted(() => ({
  sizeClassesFixture: [
    { id: 1, code: 'CONT20.LIGHT', name: 'Cont 20 - Trọng tải < 20 tấn' },
    { id: 2, code: 'CONT20.HEAVY', name: 'Cont 20 - Trọng tải > 20 tấn' },
    { id: 3, code: 'CONT40.LIGHT', name: 'Cont 40 nhẹ - Trọng tải < 20 tấn' },
    { id: 4, code: 'CONT40.HEAVY', name: 'Cont 40 nặng - Trọng tải > 20 tấn' },
  ],
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: sizeClassesFixture }),
}));

import { createCarrierFleetVehicle, createInternalTruck, listDispatchFleetResources, updateLclTruck } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';
import { detailRowKey } from './DispatchPlanCellValues';

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
// SIL-796 — the signed-price preview is a query collaborator: each test
// seeds the engine answer it wants (undefined = no answer yet).
const freightPreviewMock = vi.fn<(input: unknown) => { data?: { source: 'AUTO' | 'MANUAL'; total: number; formula: string } }>(() => ({ data: undefined }));
// SIL-796 r2 — the cước-trả seed reads the nhà-xe board cascade (matched
// null = unpriced lane).
const carrierPriceMock = vi.fn<(input: unknown) => { data?: { price: number; matched: 'SUPPLIER' | 'GENERIC' | null } }>(() => ({ data: undefined }));
vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: (input: unknown) => freightPreviewMock(input),
  useCarrierPricePreview: (input: unknown) => carrierPriceMock(input),
}));
// Card 191026100010 (DV-B1-04) — the grouped-row save law: updateLclTruck
// rides BEFORE the atomic save and its failure aborts it.
const updateLclTruckMock = vi.mocked(updateLclTruck);
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
// Non-ACTIVE tractors the fleet list still returns (deletedAt null) — the
// picker must not offer what the plan save would reject with 409.
const EXPIRED_TRUCK = {
  ...PAIRED_TRUCK,
  id: 156,
  licensePlate: '60C-567.89',
  status: 'INACTIVE',
  assignedDriverId: 10,
  assignedDriverName: 'Lê Văn Hết Hạn',
};
const MAINTENANCE_TRUCK = {
  ...PAIRED_TRUCK,
  id: 157,
  licensePlate: '30C-111.22',
  status: 'MAINTENANCE',
  assignedDriverId: 11,
  assignedDriverName: 'Trần Văn Sửa Xe',
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
function mockFleetResources(opts: { issueLookup?: Array<typeof PAIRED_TRUCK>; pageTrucks?: Array<typeof PAIRED_TRUCK | typeof EXPIRED_TRUCK | typeof MAINTENANCE_TRUCK> } = {}) {
  const trucks = opts.issueLookup ?? [PAIRED_TRUCK];
  const pageTrucks = opts.pageTrucks ?? [PAIRED_TRUCK, OTHER_TRUCK];
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
    return { items: pageTrucks, nextCursor: null, total: pageTrucks.length, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

type IssueOrderBody = Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>;

function renderCell(
  item: DispatchDetailPlanRow,
  handlers: {
    onAtomicSave?: (row: DispatchDetailPlanRow, body: Record<string, unknown>) => Promise<AtomicPlanSaveResult>;
    onIssueOrder?: (row: DispatchDetailPlanRow, body: IssueOrderBody) => Promise<DispatchShipmentResponse>;
    onCancelDispatch?: (row: DispatchDetailPlanRow) => void;
    onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
    onEnsureFulfillment?: (row: DispatchDetailPlanRow) => Promise<DispatchDetailPlanRow | null>;
    onChangeGroupTruck?: (row: DispatchDetailPlanRow) => void;
  } = {},
  /** SIL-500 — the cell's carrier line is click-to-edit again; the row ⋯ menu
   *  opens the same editor through the openRequest signal. `open: true`
   *  mounts with the signal already fired (the dialog opens on mount); tests
   *  that need to click the carrier themselves use `open: false`. */
  options: { open?: boolean } = {},
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
  const key = detailRowKey(item);
  const element = (open: boolean, nonce: number) => (
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={(handlers.onAtomicSave as never) ?? (defaultAtomicSave as never)}
      onCancelDispatch={handlers.onCancelDispatch}
      onCompleteExternalTrip={(handlers.onCompleteExternalTrip as never) ?? (vi.fn() as never)}
      onIssueOrder={(handlers.onIssueOrder as never) ?? (defaultIssueOrder as never)}
      onEnsureFulfillment={handlers.onEnsureFulfillment}
      onChangeGroupTruck={handlers.onChangeGroupTruck}
      openRequest={open ? { key, nonce } : null}
      onOpenRequestConsumed={vi.fn()}
    />
  );
  const view = render(element(options.open !== false, 1));
  let nonce = 1;
  return {
    ...view,
    /** Bumps the signal so the cell re-opens its editor (menu re-click). */
    reopenEditor() {
      nonce += 1;
      view.rerender(element(true, nonce));
    },
  };
}

async function openDialog() {
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

describe('UI52-B editor business identity', () => {
  it.each([
    { container: ' MSCU1234567 ', bill: 'BL-2026-010', expected: 'MSCU1234567' },
    { container: null, bill: ' BL-2026-010 ', expected: 'BL-2026-010' },
    { container: ' ', bill: ' BOOK-2026-010 ', expected: 'BOOK-2026-010' },
    { container: null, bill: null, expected: 'Chưa có số Bill/Booking' },
    { container: ' ', bill: ' ', expected: 'Chưa có số Bill/Booking' },
  ])('keeps $expected in the editor title and Cancel preserves the exact row', async ({ container, bill, expected }) => {
    mockFleetResources();
    const original = row();
    original.container = { ...original.container, containerNumber: container };
    original.docs = { ...original.docs, billNumber: bill };
    const onAtomicSave = vi.fn();
    renderCell(original, { onAtomicSave });
    // Owner redesign 23/10: the identity lives in the dialog title (the row
    // ⋯ menu names it too); the internal shipment code never surfaces.
    expect(await screen.findByRole('heading', { name: `Chỉnh sửa điều phối · ${expected}` })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(original.shipmentCode ?? 'SS-SENTINEL');
    expect(screen.getByLabelText('Nhà xe').id).toBe(`dispatch-carrier-${original.fulfillmentId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onAtomicSave).not.toHaveBeenCalled();
  });
});

describe('QA-AUDIT-UI-92 complete assignment facts', () => {
  it('keeps the cell as one-line facts with the carrier as the click-to-edit verb, and Cancel preserves the row', async () => {
    mockFleetResources();
    const original = row();
    original.dispatch = { ...original.dispatch, assignedDriverName: PAIRED_TRUCK.assignedDriverName };
    const saved = structuredClone(original);
    const onAtomicSave = vi.fn();
    const { container } = renderCell(original, { onAtomicSave });
    // SIL-500 (KHĐ 26/10): the carrier line is the cell's ONLY button — the
    // click-to-edit verb restored (the row ⋯ menu keeps its openRequest path).
    const cell = container.querySelector('.dispatch-assignment-cell') as HTMLElement;
    expect(cell?.querySelectorAll('button')).toHaveLength(1);
    expect(within(cell).getByRole('button', { name: 'Sửa điều phối · SilverSea · MSCU1234567' })).toHaveTextContent('SilverSea');
    for (const text of [original.dispatch.carrierName ?? 'Chưa phân nhà xe', PAIRED_TRUCK.licensePlate, PAIRED_TRUCK.assignedDriverName, 'Đã điều xe']) {
      const fact = within(cell).getByText(text);
      expect(cell).toContainElement(fact);
    }
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onAtomicSave).not.toHaveBeenCalled();
    expect(original).toEqual(saved);
  });

  it('stacks plate, driver name and SĐT as own lines in the Điều phối block (FB-036 + SIL-517)', () => {
    mockFleetResources();
    const plated = row();
    plated.dispatch = {
      ...plated.dispatch,
      assignedDriverName: 'Đinh Thanh Thịnh',
      assignedDriverPhone: '0901234567',
    };
    const { container } = renderCell(plated);
    const cell = container.querySelector('.dispatch-assignment-cell') as HTMLElement;
    const phone = screen.getByText('0901234567');
    expect(cell).toContainElement(phone);
    // SIL-517: the three facts are siblings of the same vehicle group, and
    // the group's CSS stacks them ONE PER LINE (the styles pin holds the
    // geometry; this holds the structure — no fact merged into a run).
    const group = phone.closest('.dispatch-assignment-cell__vehicle-group') as HTMLElement;
    expect(group.querySelector('.dispatch-assignment-cell__plate')?.textContent).toBe('15H-052.82');
    expect(group.querySelector('.dispatch-assignment-cell__driver')?.textContent).toBe('Đinh Thanh Thịnh');
    expect(phone.getAttribute('title')).toBe('SĐT lái xe: 0901234567');
  });

  it('omits the SĐT token cleanly when the row carries no phone (FB-036)', () => {
    mockFleetResources();
    const noPhone = row();
    noPhone.dispatch = { ...noPhone.dispatch, assignedDriverName: PAIRED_TRUCK.assignedDriverName };
    const { container } = renderCell(noPhone);
    expect(container.querySelector('.dispatch-assignment-cell__driver-phone')).toBeNull();
    expect(screen.getByText(PAIRED_TRUCK.assignedDriverName as string)).toBeTruthy();
  });
});

describe('SIL-500 — carrier click-to-edit (KHĐ 26/10)', () => {
  it('clicking the unassigned carrier "Chưa phân xe" opens the assign dialog (SIL-753 label)', async () => {
    mockFleetResources();
    const unassigned = row();
    unassigned.dispatch = { ...unassigned.dispatch, carrierName: null, assignedPlate: null };
    renderCell(unassigned, {}, { open: false });
    // SIL-753: the unassigned OWN row reads 'Chưa phân xe' — the backend no
    // longer labels it with the internal fleet's name, and the cell carries
    // the state once (no duplicated plate-line filler, no 'Chưa phân nhà xe').
    const carrierButton = screen.getByRole('button', { name: 'Sửa điều phối · Chưa phân xe · MSCU1234567' });
    expect(carrierButton).toHaveTextContent('Chưa phân xe');
    expect(carrierButton.className).toContain('is-placeholder');
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
    expect(screen.queryByText('SilverSea')).toBeNull();
    const cell = carrierButton.closest('.dispatch-assignment-cell') as HTMLElement;
    expect(within(cell).getAllByText('Chưa phân xe')).toHaveLength(1);
    fireEvent.click(carrierButton);
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' })).toBeInTheDocument();
  });

  it('a live issued trip routes the carrier click to cancel dispatch (SIL-708)', async () => {
    mockFleetResources();
    const onCancelDispatch = vi.fn();
    const issued = row({ taskStatus: 'DISPATCHED', dispatch: { ...row().dispatch, tripId: 77, tripStatus: 'CREATED' } });
    renderCell(issued, { onCancelDispatch }, { open: false });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy phân xe · SilverSea · MSCU1234567' }));
    await waitFor(() => expect(onCancelDispatch).toHaveBeenCalledWith(issued));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a COMPLETED row keeps the carrier as plain text — frozen history has no dead trigger', () => {
    mockFleetResources();
    const done = row({ taskStatus: 'COMPLETED' as DispatchDetailPlanRow['taskStatus'] });
    const { container } = renderCell(done, {}, { open: false });
    const cell = container.querySelector('.dispatch-assignment-cell') as HTMLElement;
    expect(cell.querySelectorAll('button')).toHaveLength(0);
    expect(within(cell).getByText('SilverSea').tagName).toBe('SPAN');
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

  it('SIL-647: money inputs render with compact height (ds-field--sm) and affix box', async () => {
    renderCell(row({ plannedEndAt: null }), {});
    await openDialog();
    const revenueInput = screen.getByLabelText('Cước thu dự kiến');
    const costInput = screen.getByLabelText('Cước trả dự kiến');
    expect(revenueInput.closest('.ds-field')).toHaveClass('ds-field--sm');
    expect(costInput.closest('.ds-field')).toHaveClass('ds-field--sm');
  });

  // SIL-796 r2 (owner law 04/11): the two fee fields read DIFFERENT signed
  // tables — cước thu seeds from the customer pricing engine, cước trả from
  // the nhà-xe board cascade. A stored 0 estimate is "chưa định giá"; the
  // dialog never presents a fabricated 0.
  it('seeds cước thu from the engine and cước trả from the nhà-xe board when the stored estimates are 0', async () => {
    freightPreviewMock.mockReturnValue({ data: { source: 'AUTO', total: 4_202_500, formula: 'I·H' } });
    carrierPriceMock.mockReturnValue({ data: { price: 3_937_500, matched: 'GENERIC' } });
    renderCell(row({
      plannedEndAt: null,
      estimates: { plannedRevenue: '0', plannedCarrierCost: '0' },
      pricing: { customerId: 5, routeId: 6, containerTypeCode: '20DC' },
      // 21.5t ≥ 20t → CONT20.HEAVY (id 2) is the board row the save freezes.
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00', cargoWeightKgRaw: '21500.00' },
    }), {});
    await openDialog();
    await waitFor(() => {
      expect((screen.getByLabelText('Cước thu dự kiến') as HTMLInputElement).value).toContain('4.202.500');
      expect((screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement).value).toContain('3.937.500');
    });
    // Each seed asked its own table with the row's signed-price key.
    expect(freightPreviewMock).toHaveBeenCalledWith(expect.objectContaining({ customerId: 5, routeId: 6, vehicleSizeClassCode: 'CONT20', transportDate: '2026-08-20' }));
    expect(carrierPriceMock).toHaveBeenCalledWith(expect.objectContaining({ routeId: 6, vehicleSizeClassId: 2, supplierId: null, transportDate: '2026-08-20' }));
  });

  it('asks the nhà-xe board with the external carrier supplier id when the row is dispatched to one', async () => {
    carrierPriceMock.mockReturnValue({ data: { price: 3_937_500, matched: 'SUPPLIER' } });
    renderCell(row({
      plannedEndAt: null,
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'ĐĂNG QUÂN', externalCarrierId: 11, externalCarrierVehicleId: null, assignedPlate: '15H-104.03' },
      estimates: { plannedRevenue: null, plannedCarrierCost: '0' },
      pricing: { customerId: 5, routeId: 6, containerTypeCode: '40DC' },
      container: { containerNumber: 'MSKU1234565', containerTypeLabel: "40'DC", cargoWeightKg: '15000.00', cargoWeightKgRaw: '15000.00' },
    }), {});
    await openDialog();
    await waitFor(() => expect((screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement).value).toContain('3.937.500'));
    // 15t < 20t → CONT40.LIGHT (id 3), supplier 11 rides the ask.
    expect(carrierPriceMock).toHaveBeenCalledWith(expect.objectContaining({ routeId: 6, vehicleSizeClassId: 3, supplierId: 11, transportDate: '2026-08-20' }));
  });

  it('re-asks the board and seeds cước trả when the carrier is picked AFTER the preview landed (QA r2: trả stayed 0)', async () => {
    freightPreviewMock.mockReturnValue({ data: { source: 'AUTO', total: 4_202_500, formula: 'I·H' } });
    // The board answers only once the ask carries the picked supplier.
    carrierPriceMock.mockImplementation((input: unknown) => {
      const supplierId = input != null && typeof input === 'object' && 'supplierId' in input
        ? input.supplierId
        : null;
      return supplierId === 9
        ? { data: { price: 3_937_500, matched: 'SUPPLIER' as const } }
        : { data: { price: 0, matched: null } };
    });
    const carrierLess = row({
      plannedEndAt: null,
      dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: '0' },
      pricing: { customerId: 5, routeId: 6, containerTypeCode: '40DC' },
      container: { containerNumber: 'MSKU1234565', containerTypeLabel: "40'DC", cargoWeightKg: '15000.00', cargoWeightKgRaw: '15000.00' },
    });
    renderCell(carrierLess, {});
    await openDialog();
    // Open the Nhà xe combobox and pick the mocked external carrier (EXT:9).
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn nhà xe'))!);
    const carrierOption = await screen.findAllByText('Carrier QA');
    fireEvent.click(carrierOption[carrierOption.length - 1]);
    // The carrier pick re-keyed the board ask → the real signed cost lands,
    // never the stored 0.
    await waitFor(() => expect((screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement).value).toContain('3.937.500'));
  });

  it('a nhà-xe board miss clears the stored fake 0 and names the gap — never shows 0', async () => {
    freightPreviewMock.mockReturnValue({ data: { source: 'AUTO', total: 4_202_500, formula: 'I·H' } });
    carrierPriceMock.mockReturnValue({ data: { price: 0, matched: null } });
    renderCell(row({
      plannedEndAt: null,
      estimates: { plannedRevenue: null, plannedCarrierCost: '0' },
      pricing: { customerId: 5, routeId: 6, containerTypeCode: '40DC' },
      container: { containerNumber: 'MSKU1234565', containerTypeLabel: "40'DC", cargoWeightKg: '15000.00', cargoWeightKgRaw: '15000.00' },
    }), {});
    await openDialog();
    await waitFor(() => expect(screen.getByText(/Chưa có giá ký nhà xe — nhập tay hoặc để trống, không ghi 0\./)).toBeTruthy());
    const cost = screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement;
    expect(cost.value).toBe('');
  });

  // SIL-796 FAIL 5079 (r21) — the stored fake 0 never RENDERS either: when
  // the board ask cannot fire at all (no pricing wire / no weight class) the
  // seed law never runs, and the dialog used to sit on a bold stored 0 in
  // every state (QA lot 835: thu seeded, trả '0' across 3 states).
  it('renders the stored fake 0 as an empty Cước trả field even when the board ask cannot fire', async () => {
    freightPreviewMock.mockReturnValue({ data: undefined });
    carrierPriceMock.mockReturnValue({ data: undefined });
    const first = renderCell(row({
      plannedEndAt: null,
      dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: '0', plannedCarrierCost: '0' },
    }), {});
    await openDialog();
    const cost = screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement;
    expect(cost.value).toBe('');
    expect(screen.getByText('Chưa có giá ký nhà xe — nhập tay hoặc để trống, không ghi 0.')).toBeTruthy();
    first.unmount();
    // A REAL stored price still renders — only the fake 0 is suppressed.
    freightPreviewMock.mockReturnValue({ data: undefined });
    carrierPriceMock.mockReturnValue({ data: undefined });
    renderCell(row({
      plannedEndAt: null,
      estimates: { plannedRevenue: null, plannedCarrierCost: '1800000' },
    }), {});
    await openDialog();
    expect((screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement).value).toContain('1.800.000');
  });

  it('names the missing signed price instead of showing 0 when the engine answers MANUAL', async () => {
    freightPreviewMock.mockReturnValue({ data: { source: 'MANUAL', total: 0, formula: 'Chưa có bảng giá tuyến này' } });
    renderCell(row({
      plannedEndAt: null,
      estimates: { plannedRevenue: '0', plannedCarrierCost: '0' },
      pricing: { customerId: 5, routeId: 6, containerTypeCode: '40DC' },
    }), {});
    await openDialog();
    await waitFor(() => expect(screen.getByText(/Chưa có bảng giá tuyến này/)).toBeTruthy());
    expect((screen.getByLabelText('Cước thu dự kiến') as HTMLInputElement).value).not.toContain('0');
  });
});

describe('DispatchPlanEditorCell — single datetime field (id 712, owner 30/10)', () => {
  // id 712 removed the Giờ trả hàng field from this dialog — the laws that
  // lived on it (FB-002 Enter, QA-2026-09-26-23 incomplete-block, omit =
  // untouched) now pin the surviving Giờ điều vận field and the structural
  // never-write-plannedEndAt guarantee.
  const runDaySeg = () => screen.getByLabelText('Ngày — Giờ điều vận') as HTMLInputElement;
  const runHourSeg = () => screen.getByLabelText('Giờ — Giờ điều vận') as HTMLInputElement;
  const runMinuteSeg = () => screen.getByLabelText('Phút — Giờ điều vận') as HTMLInputElement;
  const runAtNoon = { deliveryDate: '2026-10-26', runAt: '2026-10-26T06:00:00.000Z', runHour: 13 };
  // A container line is what gives the row per-container appointment
  // authority: without it the field renders disabled and the save body
  // never carries the appointment (the LCL lot law).
  const fclRow = (overrides: Partial<DispatchDetailPlanRow> = {}) =>
    row({ shipmentContainerId: 777, time: runAtNoon, ...overrides });

  const saveResult = () => ({
    fulfillmentVersion: 4, shipmentVersion: 6, classification: 'SINGLE', isCombined: false,
    operationalNotes: null,
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
    estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
  });

  it('renders Giờ điều vận and NOT the removed Giờ trả hàng field — even when an override is stored', async () => {
    mockFleetResources();
    renderCell(fclRow({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), {});
    await openDialog();
    expect(screen.getByLabelText('Giờ điều vận')).toBeTruthy();
    expect(screen.queryByLabelText('Giờ trả hàng')).toBeNull();
    expect(screen.queryByLabelText('Ngày — Giờ trả hàng')).toBeNull();
  });

  it('FB-002 (181026000027): Enter in a hand-typed Giờ điều vận segment saves the dialog', async () => {
    // The footer "Lưu thay đổi" button sits OUTSIDE the form and every
    // in-form button is type="button" — implicit submission can never fire.
    // The form must answer Enter itself (requestSubmit), and the segmented
    // field must let a complete draft's Enter bubble instead of swallowing it.
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    mockFleetResources();
    renderCell(fclRow(), { onAtomicSave });
    await openDialog();
    expect(runHourSeg().value).toBe('13'); // 06:00Z appointment prefilled in +07 wall-clock
    fireEvent.change(runMinuteSeg(), { target: { value: '45' } }); // hand-typed edit → 13:45
    fireEvent.keyDown(runMinuteSeg(), { key: 'Enter' });
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave.mock.calls[0]![1]).toMatchObject({ customerAppointmentAt: '2026-10-26T06:45:00.000Z' });
  });

  it('FB-002: an incomplete Giờ điều vận draft still swallows Enter — no save', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    mockFleetResources();
    renderCell(fclRow(), { onAtomicSave });
    await openDialog();
    fireEvent.change(runDaySeg(), { target: { value: '0' } }); // incomplete date draft
    fireEvent.keyDown(runDaySeg(), { key: 'Enter' });
    expect(onAtomicSave).not.toHaveBeenCalled();
  });

  it('a stored Giờ trả hàng override survives the save — plannedEndAt never rides the body (id 712)', async () => {
    // The dialog no longer edits the return time: no field, no draft, no
    // wire write — the stored override (and the schedule display that reads
    // it) stays exactly as saved before.
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    mockFleetResources();
    renderCell(fclRow({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect('plannedEndAt' in onAtomicSave.mock.calls[0]![1]).toBe(false);
  });

  it('sends the zone-aware appointment ISO on save (13:30 +07:00 → 06:30Z)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    mockFleetResources();
    renderCell(fclRow(), { onAtomicSave });
    await openDialog();
    fireEvent.change(runDaySeg(), { target: { value: '27/10/2026' } });
    fireEvent.change(runHourSeg(), { target: { value: '13' } });
    fireEvent.change(runMinuteSeg(), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave.mock.calls[0]![1]).toMatchObject({ customerAppointmentAt: '2026-10-27T06:30:00.000Z' });
    expect('plannedEndAt' in onAtomicSave.mock.calls[0]![1]).toBe(false);
  });

  it('QA-2026-09-26-23 blocks the save while the Giờ điều vận edit is incomplete — no silent clear', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    mockFleetResources();
    renderCell(fclRow(), { onAtomicSave });
    await openDialog();
    // Partial edit: EMPTY the day segment — the field reports incomplete, so
    // Lưu must be BLOCKED, never write a silent clear of the stored instant.
    fireEvent.change(runDaySeg(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(screen.getByText('Giờ điều vận chưa hoàn chỉnh — chọn đủ ngày và giờ.')).toBeTruthy());
    expect(onAtomicSave).not.toHaveBeenCalled();
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

  it('routes ISSUED rows to the Hủy phân xe flow instead of the editor (SIL-708)', async () => {
    const onCancelDispatch = vi.fn();
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', tripId: 55, tripStatus: 'CREATED' },
    }), { onCancelDispatch });
    // Owner redesign 23/10 + SIL-708: the row menu's open signal drives the
    // same reroute the old inline trigger owned — a live trip never opens the
    // plan editor, it goes straight to the cancel-dispatch confirm.
    await waitFor(() => expect(onCancelDispatch).toHaveBeenCalled());
    expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull();
  });

  it('routes in-flight (IN_TRANSIT) trips to the cancel flow too — the plan is no longer editable', async () => {
    const onCancelDispatch = vi.fn();
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', tripId: 55, tripStatus: 'IN_TRANSIT' },
    }), { onCancelDispatch });
    await waitFor(() => expect(onCancelDispatch).toHaveBeenCalled());
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
    await waitFor(() => expect(issueButton()).not.toHaveAttribute('aria-disabled'));
  });

  // Card 091026164540 — the vehicle picker still listed tractors whose
  // status is not ACTIVE (reported: 60C-56789 could be picked and only the
  // save surfaced "Xe đầu kéo không còn hiệu lực"). The save-time guard in
  // dispatch-planning-detail-plan.service.ts is correct and stays as the
  // backstop; the picker just must not OFFER a dead truck. This pins the
  // list side: an inactive tractor never becomes a selectable option.
  it('omits tractors that are not ACTIVE from the vehicle picker', async () => {
    const deadTruck = { ...OTHER_TRUCK, id: 199, licensePlate: '60C-567.89', status: 'INACTIVE' };
    listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
      if (resource === 'EXTERNAL_CARRIER') {
        return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
      }
      if (resource === 'EXTERNAL_VEHICLE') {
        return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
      }
      return { items: [PAIRED_TRUCK, OTHER_TRUCK, deadTruck], nextCursor: null, total: 3, limit: filters.limit ?? 50, suggestedItems: [] };
    }) as never);

    renderCell(row({
      taskStatus: 'READY',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }));
    await openDialog();
    // Open the own-fleet vehicle picker (carrier-less own row → 'Chọn biển số xe').
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Chọn biển số xe'))!);
    await screen.findAllByRole('listbox');
    // Read the rendered dropdown options the same way the sibling
    // "leads the EXTERNAL vehicle list" test does.
    const dropdownOptions = [...document.querySelectorAll('[role=option], .searchable-select__option')]
      .map((el) => el.textContent?.trim() ?? '');
    // The dead tractor is never offered as a selectable option...
    expect(dropdownOptions.some((t) => t.includes('60C-567.89'))).toBe(false);
    // ...while the live ones still are, so the picker is not simply emptied.
    expect(dropdownOptions.some((t) => t.includes('15H-052.82'))).toBe(true);
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
    renderCell(row({
      taskStatus: 'COMPLETED',
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: 'E2E-QA1', tripId: 77, tripStatus: 'COMPLETED' },
    }));
    expect(screen.getByText('Đã hoàn thành')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Phát lệnh nhanh/ })).toBeNull();
    // The plan is frozen history — the row menu does not render for
    // completed rows, and even a stray open signal never opens the editor
    // (its save would only 409 at the live-trip guard).
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

    // The open signal already fired at mount (renderCell default).
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

  it('offers the Lẻ + Lấy Lẻ pair on LCL rows and never the cont models (SIL-702)', async () => {
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

    const trigger = screen.getByRole('button', { name: 'Lẻ Phân loại' });
    expect(trigger).not.toHaveAttribute('aria-disabled');
    fireEvent.click(trigger);
    // SIL-702 (id 822): the LCL row's select is the cargo-mode-bound PAIR
    // Lẻ / Lấy Lẻ (testplan/flows/02-dieuvan-dispatch.md §2.13; TC-DV-
    // DISPATCH-053). 'Lấy Lẻ' is the empty-shell run and is storable again
    // since migration 20261107094500 widened the DB check that had pinned an
    // LCL_SHIPMENT row to 'LCL' (it predated the classification and turned a
    // legal save into a raw 23514 → HTTP 500).
    expect(screen.getByRole('option', { name: 'Lẻ' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Lấy Lẻ' })).toBeTruthy();
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

  it('saves Lấy Lẻ on an LCL row — the dispatcher moves between the pair (SIL-702)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'LCL_PICKUP',
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

    fireEvent.click(screen.getByRole('button', { name: 'Lẻ Phân loại' }));
    fireEvent.click(screen.getByRole('option', { name: 'Lấy Lẻ' }));
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ classification: 'LCL_PICKUP' }),
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
    const withSignal = (item: ReturnType<typeof row>) => ({ ...cellProps(item), openRequest: { key: detailRowKey(item), nonce: 1 }, onOpenRequestConsumed: vi.fn() });
    const view = render(<DispatchPlanEditorCell {...withSignal(row())} />);
    await openDialog();

    // Unsaved draft work the refresh must not discard.
    fireEvent.change(screen.getByLabelText('Ghi chú thêm'), { target: { value: 'bảo lãnh trước 30p' } });

    // Background refresh: same fulfillmentId, new object identity + version.
    view.rerender(<DispatchPlanEditorCell {...withSignal(row({ version: 4 }))} />);

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
    expect(screen.queryByText('Đã phát lệnh')).toBeNull();
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

  it('annotates and demotes a trailer-incompatible truck on a 40-foot container row', async () => {
    // Card 091026164810 — the trailer requirement is a LENGTH FLOOR, mirroring
    // TRAILER_LENGTH_RANK in the issue-time gate: a 20' load may ride a 40'
    // moóc, so on a 20-foot row nothing can mismatch any more. The provable
    // mismatch is the other direction — a 40' requirement on a 20' moóc — so
    // these cases run on a 40HC row.
    const fitTruck = { ...OTHER_TRUCK, id: 156, licensePlate: '60C-123.45', trailerType: '40FT' };
    const undersizedTruck = PAIRED_TRUCK; // 20FT moóc, plate 15H-052.82
    mockTruckPage([undersizedTruck, fitTruck]);
    // Point the row's current plate at the fitting truck so what is under test
    // is the ranking of the fetched options — the current-vehicle fold pins
    // its own entry to the top otherwise.
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

  // Card 091026164810 — the inverse pairing the old exact-match rule got
  // wrong: a 20' container on a 40' moóc is the Kẹp rig and is LEGAL, so the
  // picker must not warn about it. This is the regression the card reports.
  it('does not warn when a 40FT moóc carries a 20-foot container', async () => {
    mockTruckPage([{ ...OTHER_TRUCK, id: 156, licensePlate: '60C-123.45', trailerType: '40FT' }]);
    renderCell(row()); // 20DC → requires 20FT
    const options = await openVehicleDropdown();
    const label = options.find((l) => l.includes('60C-123.45'))!;
    expect(label).not.toContain('rơ-moóc');
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
    // Card 091026164810: mismatch is now the UNDERSIZED moóc, so this runs on
    // a 40HC row (a 40FT moóc on a 20' requirement is legal and must not warn).
    mockTruckPage(
      [{ ...OTHER_TRUCK, id: 156, licensePlate: '60C-123.45', trailerType: '40FT' }, PAIRED_TRUCK],
      [{ truckId: 156, plateNumber: '60C-123.45', reasons: ['D-1_DROP'] }],
    );
    renderCell(row({ container: { containerNumber: 'MSCU7654321', containerTypeLabel: '40HC', cargoWeightKg: '24000.00' } }));
    const options = await openVehicleDropdown();

    // The pinned 40FT moóc is a fit on a 40' requirement → no warning.
    expect(options.some((label) => label.includes('60C-123.45 — Hạ tại khu vực D-1'))).toBe(true);
    expect(options.some((label) => label.includes('60C-123.45 — Hạ tại khu vực D-1 — ⚠ rơ-moóc'))).toBe(false);
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

  // Card 101026043010 supersedes the title's old "absent for OWN" half — the
  // internal picker gained the same affordance (pinned in its own describe).
  it('offers "+ Thêm nhanh" for a selected external carrier and none while carrier-less', async () => {
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

describe('DispatchPlanEditorCell — quick-add plate in the internal fleet picker (card 101026043010)', () => {
  const createInternalMock = vi.mocked(createInternalTruck);
  const createExternalMock = vi.mocked(createCarrierFleetVehicle);

  beforeEach(() => {
    createInternalMock.mockReset();
    createExternalMock.mockReset();
  });

  // The default row is an OWN row ('SilverSea — xe nội bộ' preselected) —
  // exactly the internal fleet picker whose quick-add button the staging
  // report found missing (PARTIAL FIX of 20261005_357, external-only AC1).
  it('offers the "+ Thêm nhanh" affordance with the external path\'s accessible name', async () => {
    mockFleetResources();
    renderCell(row());
    await openDialog();

    expect(screen.getByRole('button', { name: 'Thêm nhanh' })).toBeTruthy();
  });

  it('creates the plate through the internal trucks API in the SAME dialog and preselects it', async () => {
    mockFleetResources();
    createInternalMock.mockResolvedValue({ id: 321, licensePlate: '29C-111.22' });
    renderCell(row());
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhanh' }));
    // Reused dialog — same title, field label, and confirm as the external path.
    expect(await screen.findByText('Thêm nhanh biển số xe')).toBeTruthy();
    expect(screen.getByLabelText('Biển số xe')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29c 111.22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createInternalMock).toHaveBeenCalledWith({ licensePlate: '29C 111.22' }));
    // An internal quick-add must never touch the Xe ngoài registration API.
    expect(createExternalMock).not.toHaveBeenCalled();
    // Dialog closes; the new plate preselects the combobox trigger.
    await waitFor(() => expect(screen.queryByText('Thêm nhanh biển số xe')).toBeNull());
    await waitFor(() => expect(screen.getAllByText('29C-111.22').length).toBeGreaterThan(0));
  });

  it('rides the internal option list immediately and is assignable to the row', async () => {
    mockFleetResources();
    createInternalMock.mockResolvedValue({ id: 321, licensePlate: '29C-111.22' });
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 6,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '29C-111.22' },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(row(), { onAtomicSave });
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhanh' }));
    fireEvent.change(await screen.findByLabelText('Biển số xe'), { target: { value: '29C-111.22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(screen.queryByText('Thêm nhanh biển số xe')).toBeNull());

    // Same interim-list contract as the external path: the created plate is
    // in the picker immediately (before the refetch lands it) and selectable.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    const optionNode = (await screen.findAllByText('29C-111.22')).find((node) => node.closest('[role="option"]'));
    expect(optionNode).toBeTruthy();
    fireEvent.click(optionNode!);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.carrierType).toBe('OWN');
    expect(body.truckId).toBe(321);
  });

  it('surfaces the internal create error inline instead of closing', async () => {
    mockFleetResources();
    createInternalMock.mockRejectedValue(new Error('Biển số xe đã tồn tại'));
    renderCell(row());
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhanh' }));
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29C-111.22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(await screen.findByText('Biển số xe đã tồn tại')).toBeTruthy();
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

  it('saves the deferred choice as an explicit plate clear (clearVehicle — SIL-494)', async () => {
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
    // SIL-494 — "Bổ sung sau" ships the explicit clear: an absent vehicle
    // block reads as "keep stored columns" on the backend, so the row's old
    // plate survived the save (the QA revert). clearVehicle keeps the carrier
    // and ships the plate empty.
    expect(body.clearVehicle).toBe(true);
    expect(body.externalCarrierVehicleId).toBeUndefined();
    expect(body.plateNumber).toBeUndefined();
    expect(body.truckId).toBeUndefined();
  });

  it('SIL-494 repro: a PLATED row switched to "Bổ sung sau" wires clearVehicle (plate ships empty, carrier stays)', async () => {
    mockFleetResources();
    // Post-split shape from the ticket: R42DIS-02 = THẾ LUÂN + 15C-99999,
    // carrier unchanged, plate picked back to "Bổ sung sau".
    const plated = row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: 77, assignedPlate: '15C-99999' },
    });
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 5,
      shipmentVersion: 7,
      classification: 'SINGLE',
      isCombined: false,
      operationalNotes: null,
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderCell(plated, { onAtomicSave });
    await openDialog();

    // The plated picker's trigger carries the current plate, not the
    // placeholder — click it by its field id.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.click((await screen.findAllByText('Bổ sung sau'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.clearVehicle).toBe(true);
    expect(body.carrierType).toBe('EXTERNAL');
    expect(body.externalCarrierId).toBe(9);
    expect(body.plateNumber).toBeUndefined();
    expect(body.externalCarrierVehicleId).toBeUndefined();
  });

  it('a GROUPED LCL lot still refuses the deferred pick at this editor (group plate is shared — Đổi BKS nhóm)', async () => {
    mockFleetResources();
    const grouped = row({
      cargoMode: 'LCL',
      fulfillmentType: 'LCL_SHIPMENT',
      container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '4000.00' },
      lcl: {
        packageCount: 10,
        packageType: 'Carton',
        cargoVolumeCbm: '4.00',
        group: { groupId: 'g-1', order: 1, memberCount: 2, actualTruckNo: '99H-004.59', billingTruckNo: null, vehicleClassCode: '5T', vehicleClassName: 'Xe tải 5 tấn' },
      },
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: 77, assignedPlate: '99H-004.59' },
    } as Partial<DispatchDetailPlanRow>);
    const onAtomicSave = vi.fn();
    renderCell(grouped, { onAtomicSave });
    await openDialog();

    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.click((await screen.findAllByText('Bổ sung sau'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Đổi BKS nhóm/);
    expect(onAtomicSave).not.toHaveBeenCalled();
    expect(updateLclTruckMock).not.toHaveBeenCalled();
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

// Card 091026164540: the fleet list returns non-ACTIVE tractors (deletedAt
// null), and the picker offered them all — a dispatcher could pick an expired
// tractor and only learn at save ("Xe đầu kéo không còn hiệu lực"). The option
// list must not offer a value the plan save rejects; the save-time 409 stays
// as the backstop.
describe('DispatchPlanEditorCell — expired tractor options (card 091026164540)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetResources({ pageTrucks: [PAIRED_TRUCK, EXPIRED_TRUCK, MAINTENANCE_TRUCK] });
  });

  it('offers only ACTIVE tractors — INACTIVE and MAINTENANCE stay unselectable in the picker', async () => {
    renderCell(row());
    await openDialog();
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    // The ACTIVE tractor is pickable…
    expect(await screen.findByRole('option', { name: /15H-052\.82/ })).toBeTruthy();
    // …while the non-ACTIVE ones the fleet list returned never become options.
    expect(screen.queryByRole('option', { name: /60C-567\.89/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /30C-111\.22/ })).toBeNull();
  });

  it('keeps the row’s current plate visible when its tractor is no longer ACTIVE — stored identity survives the filter', async () => {
    renderCell(row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '60C-567.89' },
    }));
    await openDialog();
    // The closed select still names the stored assignment; an untouched save
    // ships no vehicle block, so the expired backstop never fires on it.
    expect(document.getElementById('dispatch-vehicle-101')!.textContent).toContain('60C-567.89');
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    expect(await screen.findByRole('option', { name: /15H-052\.82/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /60C-567\.89 —/ })).toBeNull();
  });
});

// Card 191026100010 (DV-B1-04) — popup điều phối trên dòng LCL đã ghép nhóm:
// BKS là dữ liệu CHUNG của nhóm, nên (1) popup hiện dòng "BKS nhóm" + nút
// "Đổi BKS nhóm" (page-owned dialog) và (2) save với biển số MỚI gọi kèm
// updateLclTruck TRƯỚC plan save — lỗi updateLclTruck hủy luôn save; không
// đổi biển số thì zero cuộc gọi nhóm.
describe('DispatchPlanEditorCell — grouped LCL lot BKS law (card 191026100010)', () => {
  const groupedRow = (over: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => row({
    cargoMode: 'LCL',
    fulfillmentType: 'LCL_SHIPMENT',
    container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null } as never,
    classification: 'LCL' as never,
    lcl: {
      packageCount: 5,
      packageType: 'PALLET',
      cargoVolumeCbm: '4.000',
      group: {
        groupId: 'grp-9',
        order: 1,
        memberCount: 3,
        actualTruckNo: '15H-052.82',
        billingTruckNo: '29C-333.33',
        vehicleClassCode: '5T',
        vehicleClassName: 'Xe 5 tấn',
      },
    },
    ...over,
  });

  const saveResult = () => ({
    fulfillmentVersion: 4, shipmentVersion: 6, classification: 'LCL', isCombined: false,
    operationalNotes: null,
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '30C-999.99' },
    estimates: { plannedRevenue: null, plannedCarrierCost: null }, lotFullyPlated: false,
  });

  beforeEach(() => {
    updateLclTruckMock.mockReset();
    updateLclTruckMock.mockResolvedValue({ updatedShipmentIds: [11, 12, 13] });
    mockFleetResources();
  });

  it('shows the group line + Đổi BKS nhóm only on grouped LCL rows, raising the row (DV-B1-04)', async () => {
    const onChangeGroupTruck = vi.fn();
    renderCell(groupedRow(), { onChangeGroupTruck });
    await openDialog();
    expect(screen.getByText('BKS nhóm: 15H-052.82')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi BKS nhóm' }));
    expect(onChangeGroupTruck).toHaveBeenCalledTimes(1);
    expect(onChangeGroupTruck.mock.calls[0]![0]).toMatchObject({ shipmentId: 11 });
  });

  it('keeps the group line off FCL rows and off grouped rows when the page is unwired', async () => {
    const { rerender } = renderCell(row(), { onChangeGroupTruck: vi.fn() });
    await openDialog();
    expect(screen.queryByText(/BKS nhóm:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi BKS nhóm' })).toBeNull();
    rerender(<DispatchPlanEditorCell
      row={groupedRow()}
      onAtomicSave={vi.fn() as never}
      onCompleteExternalTrip={vi.fn() as never}
      onIssueOrder={vi.fn() as never}
    />);
    // Unwired grouped row: no line, no dead button.
    expect(screen.queryByText(/BKS nhóm:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi BKS nhóm' })).toBeNull();
  });

  it('a NEW plate on a grouped row calls updateLclTruck exactly once, BEFORE the plan save (DV-B1-04)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(groupedRow(), { onAtomicSave });
    await openDialog();
    // Pick OTHER_TRUCK (30C-999.99) — the draft now differs from the group BKS.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30C-999' } });
    fireEvent.click(await screen.findByRole('option', { name: /30C-999\.99/ }));

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).toHaveBeenCalledTimes(1);
    expect(updateLclTruckMock.mock.calls[0]![0]).toEqual({ shipmentId: 11, actualTruckNo: '30C-999.99' });
    // The group wire rides BEFORE the plan save — never the other way.
    expect(updateLclTruckMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(onAtomicSave.mock.invocationCallOrder[0]!);
  });

  it('an UNCHANGED plate touches group data zero times (DV-B1-04)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(groupedRow(), { onAtomicSave });
    await openDialog();
    // Save with the vehicle draft untouched (re-pick of the stored BKS /
    // no vehicle edit at all) — the group wire must stay silent.
    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).not.toHaveBeenCalled();
  });

  it('a failed updateLclTruck ABORTS the plan save and surfaces its message (DV-B1-04)', async () => {
    updateLclTruckMock.mockRejectedValue(new Error('Nhóm ghép đã chốt kế toán — không thể đổi BKS.'));
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(groupedRow(), { onAtomicSave });
    await openDialog();
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30C-999' } });
    fireEvent.click(await screen.findByRole('option', { name: /30C-999\.99/ }));

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nhóm ghép đã chốt kế toán'));
    // No partial desync: the plan save never ran.
    expect(onAtomicSave).not.toHaveBeenCalled();
  });

  it('clearing the plate on a grouped row is refused — the operator must use Đổi BKS nhóm', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(groupedRow(), { onAtomicSave });
    await openDialog();
    // "Bỏ gán biển số" (clearable select) → '' → clearVehicle on the wire.
    fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
    fireEvent.click(screen.getByTestId('dispatch-vehicle-101-clear'));

    fireEvent.click([...screen.getAllByRole('button')].find((b) => b.textContent?.includes('Lưu thay đổi'))!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Đổi BKS nhóm'));
    expect(updateLclTruckMock).not.toHaveBeenCalled();
    expect(onAtomicSave).not.toHaveBeenCalled();
  });
});

describe('DispatchPlanEditorCell — SIL-638 TC6.2 (id 742) soft weight warning confirm (KEP_WEIGHT_WARNING)', () => {
  it('a 409 KEP_WEIGHT_WARNING warns via confirm; confirming retries the save with kepWeightWarningConfirmed: true', async () => {
    const apiError = Object.assign(new Error('Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại'), {
      status: 409,
      raw: { code: 'KEP_WEIGHT_WARNING' },
    });
    const onAtomicSave = vi.fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValue({
        fulfillmentVersion: 5,
        shipmentVersion: 7,
        classification: 'DOUBLE',
        isCombined: false,
        operationalNotes: null,
        dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
        estimates: { plannedRevenue: null, plannedCarrierCost: null },
        lotFullyPlated: false,
      });
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    expect(await screen.findByText('Xác nhận')).toBeTruthy();
    expect(screen.getByText(/vượt tải trọng cho phép của phương tiện/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(2));
    const retryBody = onAtomicSave.mock.calls[1][1] as { kepWeightWarningConfirmed?: boolean };
    expect(retryBody.kepWeightWarningConfirmed).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });
});

describe('DispatchPlanEditorCell — SIL-718 Kẹp pair plate mismatch confirm (KEP_PAIR_SPLIT_WARNING)', () => {
  it('a 409 KEP_PAIR_SPLIT_WARNING prompts confirm; confirming retries with kepPairSplitConfirmed: true', async () => {
    const apiError = Object.assign(new Error('2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách.'), {
      status: 409,
      raw: { code: 'KEP_PAIR_SPLIT_WARNING' },
    });
    const onAtomicSave = vi.fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValue({
        fulfillmentVersion: 5,
        shipmentVersion: 7,
        classification: 'DOUBLE',
        isCombined: false,
        operationalNotes: null,
        dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
        estimates: { plannedRevenue: null, plannedCarrierCost: null },
        lotFullyPlated: false,
      });
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(within(confirmDialog).getByText(/2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách/)).toBeTruthy();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(2));
    const retryBody = onAtomicSave.mock.calls[1][1] as { kepPairSplitConfirmed?: boolean };
    expect(retryBody.kepPairSplitConfirmed).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Chỉnh sửa điều phối/)).toBeNull());
  });

  it('declining the confirm keeps dialog open and shows inline error', async () => {
    const apiError = Object.assign(new Error('2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách.'), {
      status: 409,
      raw: { code: 'KEP_PAIR_SPLIT_WARNING' },
    });
    const onAtomicSave = vi.fn().mockRejectedValueOnce(apiError);
    renderCell(row({ plannedEndAt: '2026-10-05T08:30:00.000Z' }), { onAtomicSave });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(within(confirmDialog).getByText(/2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách/)).toBeTruthy();
    // Decline confirm in confirm dialog
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    // Dialog stays open with error
    expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('2 chân Kẹp phải cùng xe — hủy ghép trước nếu muốn tách.');
  });
});
