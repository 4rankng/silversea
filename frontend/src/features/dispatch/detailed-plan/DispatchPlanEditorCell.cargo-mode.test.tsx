// Operator report 191026 — "Lỗi tương tự tại cửa sổ điều phối tại màn hình
// Kế hoạch chi tiết": the dispatch window must follow the lot's cargoMode
// exactly like the master-plan "Phân bổ nhà xe" shell (card 191026181942).
// The cont contract there — per-carrier 20'/40' container counts split by
// đóng/trả day with demand validation — is nonsense on a hàng lẻ lot: it owns
// NO container, so those numbers can only read 0/0 and lie.
//
// Investigation verdict (this suite is the pin): the detailed-plan dispatch
// window ("Chỉnh sửa điều phối", DispatchPlanEditorCell) already serves the
// LCL lot-level truck contract — Nhà xe / Xe-biển số / Phân loại bound to
// 'Lẻ' (card 20261006_392) / Cước thu-trả / Giờ trả hàng, with grouped lots
// riding the BKS nhóm line + page-owned "Đổi BKS nhóm" (card 191026100010).
// The 20'/40' count inputs live ONLY in the master-plan cont body
// (DispatchAllocationDaySection). What was missing is the same regression pin
// the master-plan fix shipped: nothing failed if a future edit reintroduced
// container-demand UI (or reused the cont body) for an LCL lot here.
//
// The FCL leg mirrors the master-plan test's other half: the cont-side
// contract stays untouched — the container code still drives the window
// (identity, Phân loại cont models, moóc fit requirement), and no LCL-only
// furniture leaks onto a cont row.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listDispatchFleetResources: vi.fn(),
  createCarrierFleetVehicle: vi.fn(),
  createInternalTruck: vi.fn(),
  updateLclTruck: vi.fn(),
}));

const getTrailersMock = vi.fn();
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

import { listDispatchFleetResources, updateLclTruck } from '../../../api/dispatchPlanningClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';

// The note composer pulls the tag pool through react-query; pin it so the
// modal tests stay provider-free and deterministic (same idiom as
// DispatchPlanEditorCell.test.tsx).
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({
    tags: [
      { id: 1, label: 'Đặt đầu' },
      { id: 2, label: 'Đặt đuôi' },
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
const updateLclTruckMock = vi.mocked(updateLclTruck);
getTrailersMock.mockResolvedValue([]);

/** 20FT-moóc tractors: on a cont row demanding a 40' moóc these MUST carry the
 *  fit warning — on a hàng lẻ row the same fleet must render clean, because a
 *  lot that owns no container can never impose a container's moóc requirement. */
const TRUCKS_20FT = [
  { id: 154, licensePlate: '15H-052.82', status: 'ACTIVE', trailerType: '20FT', currentTrailerId: 2, currentTrailerPlate: '15R-182.06', capacityKg: '18000', assignedDriverId: 8, assignedDriverName: 'Phạm Văn Hùng' },
  { id: 155, licensePlate: '30C-999.99', status: 'ACTIVE', trailerType: '20FT', currentTrailerId: null, currentTrailerPlate: null, capacityKg: '18000', assignedDriverId: 9, assignedDriverName: 'Nguyễn Văn Khác' },
];

function mockFleetResources() {
  listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Nhà xe Hải Vân', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
    }
    if (filters.limit === 5 && filters.q) {
      return { items: TRUCKS_20FT, nextCursor: null, total: TRUCKS_20FT.length, limit: 5 };
    }
    return { items: TRUCKS_20FT, nextCursor: null, total: TRUCKS_20FT.length, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000300',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: null, deliveryPoint: 'Kho Q.7', routeName: null },
  docs: { billNumber: 'BL-LCL-191026', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '1922.00' },
  lcl: { packageCount: 5, packageType: 'PALLET', cargoVolumeCbm: '4.000', group: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'LCL' as DispatchDetailPlanRow['classification'],
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

/** An LCL lot inside a Ghép-trả-ĐV group whose loại xe is a CONTAINER class —
 *  the sharpest trap: "Container 20 feet" is a PRICING class, not a container
 *  the lot carries, so it must never become a 20'/40' demand in the window. */
const groupedLclRow = (): DispatchDetailPlanRow => row({
  lcl: {
    packageCount: 5,
    packageType: 'PALLET',
    cargoVolumeCbm: '4.000',
    group: {
      groupId: 'grp-19',
      order: 1,
      memberCount: 3,
      actualTruckNo: '15H-052.82',
      billingTruckNo: '29C-333.33',
      vehicleClassCode: 'CONT20',
      vehicleClassName: 'Container 20 feet',
    },
  },
});

const contRow = (): DispatchDetailPlanRow => row({
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  lcl: null,
  classification: 'SINGLE' as DispatchDetailPlanRow['classification'],
});

function renderCell(item: DispatchDetailPlanRow, handlers: { onChangeGroupTruck?: (row: DispatchDetailPlanRow) => void } = {}) {
  const onAtomicSave = vi.fn(async (): Promise<AtomicPlanSaveResult> => ({
    fulfillmentVersion: 4,
    shipmentVersion: 6,
    classification: item.classification,
    isCombined: false,
    operationalNotes: null,
    plannedEndAt: null,
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    lotFullyPlated: false,
  }));
  return render(
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={onAtomicSave}
      onOpenTripReassign={vi.fn()}
      onCompleteExternalTrip={vi.fn()}
      onIssueOrder={vi.fn()}
      onChangeGroupTruck={handlers.onChangeGroupTruck}
    />,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Sửa ô điều phối/ }));
  await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
}

/** The vehicle picker's rendered option labels (the dispatch window's one spot
 *  where a container's moóc requirement could resurface as advice). */
async function vehicleOptionLabels(): Promise<string[]> {
  fireEvent.click(document.getElementById('dispatch-vehicle-101')!);
  const options = await screen.findAllByRole('option');
  return options.map((option) => option.textContent ?? '');
}

/** The master-plan cont body's whole vocabulary — every string here is the
 *  20'/40' allocation contract an hàng lẻ lot must never see in this window. */
const CONT_CONTRACT_COPY = [
  /container 20'/i,
  /container 40'/i,
  'Phân bổ theo nhà xe theo ngày',
  /Thêm nhà xe/,
  /Lưu phân bổ/,
  /Đã phân bổ đủ/,
  'Kế hoạch tổng quát',
] as const;

beforeEach(() => {
  updateLclTruckMock.mockReset();
  updateLclTruckMock.mockResolvedValue({ updatedShipmentIds: [11, 12, 13] });
  mockFleetResources();
});

describe('DispatchPlanEditorCell — cửa sổ điều phối theo cargoMode (operator report 191026)', () => {
  it('LCL lot: the lclspec field-set and NO container 20\'/40\' demand UI', async () => {
    renderCell(row());
    await openDialog();

    // The lot-level truck contract is on screen: nhà xe, xe/biển số, Phân loại
    // bound to 'Lẻ', the two money fields and giờ trả hàng. Identity falls to
    // the Bill — a hàng lẻ has no container number to name.
    expect(screen.getByText(/Chỉnh sửa điều phối · BL-LCL-191026/)).toBeTruthy();
    expect(screen.getByText('Nhà xe')).toBeTruthy();
    expect(screen.getByText('Xe / biển số')).toBeTruthy();
    expect(screen.getByText('Cước thu dự kiến')).toBeTruthy();
    expect(screen.getByText('Cước trả dự kiến')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lẻ Phân loại' }));
    expect(screen.getByRole('option', { name: 'Lẻ' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Đơn' })).toBeNull();

    // The cont contract is gone — every string the master-plan cont body owns.
    for (const copy of CONT_CONTRACT_COPY) {
      expect(screen.queryByText(copy)).toBeNull();
    }
  });

  it('LCL lot in a CONTAINER-class group: the BKS nhóm line renders and the picker imposes no moóc requirement', async () => {
    const onChangeGroupTruck = vi.fn();
    renderCell(groupedLclRow(), { onChangeGroupTruck });
    await openDialog();

    // The group's truck facts — the lclspec channel this window owns.
    expect(screen.getByText('BKS nhóm: 15H-052.82 · Ảo: 29C-333.33')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi BKS nhóm' }));
    expect(onChangeGroupTruck).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 11 }));

    // The group's class says "Container 20 feet" — a pricing class. The lot
    // still owns no container, so the 20'/40' contract must not resurface:
    // neither as copy nor as a moóc-fit warning on any option.
    for (const copy of CONT_CONTRACT_COPY) {
      expect(screen.queryByText(copy)).toBeNull();
    }
    const labels = await vehicleOptionLabels();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/⚠ rơ-moóc/);
    }
  });

  it('FCL row: the cont contract stays exactly as before — no LCL furniture leaks in', async () => {
    renderCell(contRow());
    await openDialog();

    // The container still names the window and the picker still applies ITS
    // moóc requirement (same 20FT fleet now warns on the 40HC demand).
    expect(screen.getByText(/Chỉnh sửa điều phối · MSCU1234567/)).toBeTruthy();
    const labels = await vehicleOptionLabels();
    expect(labels.some((label) => label.includes('⚠ rơ-moóc 20FT, cần 40FT'))).toBe(true);

    // The Phân loại select still offers the cont models — the FCL contract.
    fireEvent.click(screen.getByRole('button', { name: 'Đơn Phân loại' }));
    expect(screen.getByRole('option', { name: 'Đơn' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kẹp' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kết hợp' })).toBeTruthy();

    // No grouped-LCL furniture on a cont row (same parity law as the badge).
    expect(screen.queryByText(/BKS nhóm:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi BKS nhóm' })).toBeNull();
  });
});
