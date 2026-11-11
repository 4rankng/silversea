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
    createInternalTruck: vi.fn(),
    updateLclTruck: vi.fn(),
  };
});

const getTrailersMock = vi.fn();
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';
import { detailRowKey } from './DispatchPlanCellValues';

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

const listResourcesMock = vi.mocked(listDispatchFleetResources);
// SIL-796 added the signed-price preview query to the editor cell; this suite
// pins the weight field, not pricing — the neutral "chưa định giá" answer
// keeps the cell's behavior identical to pre-SIL-796.
vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: () => ({ data: undefined }),
  useCarrierPricePreview: () => ({ data: undefined }),
}));

// SIL-796 r2 — the dialog's cước-trả seed folds the container class onto the
// board's LIGHT/HEAVY ids; mocked (no QueryClientProvider here) with the
// seeded catalog ids.
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
getTrailersMock.mockResolvedValue([]);

/**
 * SIL-644 (id 749) wave 2 — the DISPATCHER-side weight path. The first fix
 * (76c4e77d) opened the CUS ledger; QA's re-open (comment 3436) names what is
 * still missing: "dialog điều xe vẫn KHÔNG có trường nhập trọng tải". This
 * file pins the weight field in the dispatch plan editor ("Sửa điều phối")
 * for rows the editor can actually open — READY rows (no live trip; the
 * C0 "Thiếu trọng tải" backstop lands the dispatcher here right after the
 * refused Phát lệnh). The live-trip assignment window belongs to the
 * TripReassignDialog surface (pinned in its own SIL-644 file).
 */

const TRUCK = {
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

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  // The dead-end container family: an FCL row wired to its container line —
  // the write path the weight field must ride.
  shipmentContainerId: 777,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho Bình Dương', routeName: null },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: null },
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
  listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
    }
    return { items: [TRUCK], nextCursor: null, total: 1, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

const saveResult = (): AtomicPlanSaveResult => ({
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

type SaveBody = Record<string, unknown>;

function renderCell(item: DispatchDetailPlanRow, onAtomicSave: (row: DispatchDetailPlanRow, body: SaveBody) => Promise<AtomicPlanSaveResult>) {
  const key = detailRowKey(item);
  return render(
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={onAtomicSave as never}
      onCompleteExternalTrip={vi.fn() as never}
      onIssueOrder={vi.fn().mockResolvedValue({} as DispatchShipmentResponse) as never}
      openRequest={{ key, nonce: 1 }}
      onOpenRequestConsumed={vi.fn()}
    />,
  );
}

async function openDialog() {
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

describe('SIL-644 — dispatch plan editor weight field (Sửa điều phối)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTrailersMock.mockResolvedValue([]);
    mockFleetResources();
  });

  it('renders the Trọng lượng field on an FCL row wired to a container line, seeded from the container weight', async () => {
    renderCell(row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00' } }), vi.fn().mockResolvedValue(saveResult()));
    await openDialog();
    const weight = screen.getByLabelText('Trọng lượng');
    expect(weight).toBeTruthy();
    expect((weight as HTMLInputElement).disabled).toBe(false);
    expect((weight as HTMLInputElement).value).toBe('21500');
  });

  it('renders no weight field on LCL rows (no container line to write)', async () => {
    renderCell(row({ shipmentContainerId: null, cargoMode: 'LCL', fulfillmentType: 'LCL_SHIPMENT' }), vi.fn().mockResolvedValue(saveResult()));
    await openDialog();
    expect(screen.queryByLabelText('Trọng lượng')).toBeNull();
  });

  it('seeds from the CONTAINER column, never the lot-level fallback — a weightless container must show empty even when the legacy lot weight decorates the cell', async () => {
    // The B-phase QA trap: the grid cell shows the merged value (lot-level
    // 6000), but the container's own column is NULL — the editor must show
    // the honest empty value (the price backstop reads the container column).
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '6000.00', cargoWeightKgRaw: null },
    }), onAtomicSave);
    await openDialog();
    const weight = screen.getByLabelText('Trọng lượng');
    expect((weight as HTMLInputElement).value).toBe('');
    // ...and typing over it is a REAL touch (saves the container column).
    fireEvent.change(weight, { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    expect((onAtomicSave.mock.calls[0]![1] as SaveBody).containerCargoWeightKg).toBe(6000);
  });

  it('rides the edited weight on the atomic save as containerCargoWeightKg and closes the dialog', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.change(screen.getByLabelText('Trọng lượng'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as SaveBody;
    expect(body.containerCargoWeightKg).toBe(20000);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clears the stored weight when the field is emptied (null = clear, not skip)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00' } }), onAtomicSave);
    await openDialog();
    fireEvent.change(screen.getByLabelText('Trọng lượng'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as SaveBody;
    expect(body.containerCargoWeightKg).toBeNull();
  });

  it('never puts an untouched weight on the wire (omit = untouched)', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(row(), onAtomicSave);
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));
    const body = onAtomicSave.mock.calls[0]![1] as SaveBody;
    expect('containerCargoWeightKg' in body).toBe(false);
  });

  it('a touched weight blocks Phát lệnh behind "Lưu thay đổi điều phối" — the issue must read the STORED weight', async () => {
    // The refused-first-issue state: plated but weightless, exactly the row
    // the "Thiếu trọng tải" 409 lands on. Typing the weight without saving
    // must keep the order blocked — the C0 backstop prices the STORED value.
    const onAtomicSave = vi.fn().mockResolvedValue(saveResult());
    renderCell(row(), onAtomicSave);
    await openDialog();
    const issue = await screen.findByRole('button', { name: 'Phát lệnh' });
    // jsdom: an absent attribute reads back null.
    expect(issue.getAttribute('aria-disabled')).toBeNull();
    fireEvent.change(screen.getByLabelText('Trọng lượng'), { target: { value: '20000' } });
    // The reason renders both as the button's aria-describedby sr-only text
    // and inside the DisabledActionTip bubble.
    expect(screen.getAllByText('Lưu thay đổi điều phối trước khi phát lệnh.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Phát lệnh' }).getAttribute('aria-disabled')).toBe('true');
  });
});
