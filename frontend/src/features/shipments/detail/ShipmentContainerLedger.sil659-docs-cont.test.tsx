/**
 * SIL-659 (id 766) — the «Chỉnh sửa chứng từ và hãng tàu» dialog gains the
 * SỐ CONT field. Pins the dialog contract on Chi tiết lô hàng:
 *   1. the field renders on REAL container rows, seeded from the line's
 *      persisted number, uppercasing as typed (same as the container cell);
 *   2. an ISO 6346 mistake shows the SAME live hint + one-tap correction the
 *      container cell shows — never a dead-end 400;
 *   3. a locked line keeps its READ_ONLY gate with the reason on the title;
 *   4. a container-less lot-level (LCL) row renders NO field — a lot owns no
 *      number, and its documents save can never carry one;
 *   5. a changed số cont arms Save and lands in the draft (the model routes
 *      it through the SAME container-line command as the container cell —
 *      see use-cus-detail.sil659-container-number.test.tsx).
 * Design provenance: DESIGN LOCK comment id 3517 on SIL-659 (webchat consult,
 * option C — field LAST, after Hãng tàu, FB-113 order untouched).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ShipmentContainerLedger, type ShipmentDocumentsDraft } from './ShipmentContainerLedger';

const { updateLclTruckMock } = vi.hoisted(() => ({ updateLclTruckMock: vi.fn(async () => ({ updatedShipmentIds: [] })) }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  updateLclTruck: updateLclTruckMock,
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
}));

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT', reason = 'trường kiểm thử') => ({ mode, reason } as { mode: 'DIRECT' | 'READ_ONLY'; reason: string });

const CONT_NUMBER = 'MSKU6590002';

const row = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 11,
  shipmentId: 5,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  customerName: 'LOG COM',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber: null,
  shippingLineName: 'Evergreen',
  isCombined: false,
  classification: 'SINGLE',
  direction: 'IMPORT',
  containerNumber: CONT_NUMBER,
  containerTypeLabel: '40HC',
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: null,
  carrierType: null,
  plateNumber: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: '2026-11-02',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: CONT_NUMBER, containerTypeId: 1, cargoWeightKg: '24000', cargoVolumeCbm: '33.0' },
  fieldAccess: {
    operationalSiteId: access(),
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
    liftSiteId: access(),
    dropoffSiteId: access(),
  },
  shipmentFieldAccess: {
    factoryName: access(),
    routeId: access(),
    deliveryLocation: access(),
    blNumber: access(),
    bookingRef: access(),
    tradeDirection: access(),
    shippingLineName: access(),
  },
  informationStatus: 'COMPLETE',
  missingFields: [],
  shipmentScheduleEditable: false,
  shipmentNotesEditable: false,
  carrierEditable: false,
  plateEditable: false,
  liftSiteEditable: false,
  dropoffSiteEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: undefined,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const line = (overrides: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine => ({
  id: 11,
  ordinal: 1,
  operationalSiteId: null,
  containerNumber: CONT_NUMBER,
  declarationNumber: null,
  containerTypeId: 1,
  containerTypeLabel: '40HC',
  routeId: null,
  routeName: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  tripId: null,
  tripStatus: null,
  tripDepartureDate: null,
  carrierType: null,
  externalCarrierId: null,
  externalCarrierVehicleId: null,
  carrierName: null,
  plateNumber: null,
  liftSiteId: null,
  liftSite: null,
  dropoffSiteId: null,
  dropoffSite: null,
  customerAppointmentAt: null,
  raw: { containerNumber: CONT_NUMBER, containerTypeId: 1, cargoWeightKg: '24000', cargoVolumeCbm: '33.0', routeId: null },
  fieldAccess: {
    operationalSiteId: access(),
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
    carrierType: access(),
    externalCarrierId: access(),
    externalCarrierVehicleId: access(),
    plateNumber: access(),
    liftSiteId: access(),
    dropoffSiteId: access(),
    customerAppointmentAt: access(),
  },
  permissions: {
    carrierEditable: false,
    plateEditable: false,
    containerTypeEditable: false,
    routeEditable: false,
    liftSiteEditable: false,
    dropoffSiteEditable: false,
    customerAppointmentEditable: false,
  },
  shipmentVersion: 3,
  relatedTripVersion: null,
  ...overrides,
});

const detail = (overrides: { summaryRaw?: Record<string, unknown>; summaryFieldAccess?: Record<string, unknown> } = {}): ShipmentCusWorkspaceDetail => ({
  summary: {
    id: 5,
    version: 3,
    cargoMode: 'FCL',
    operational: { transportDateEditable: false },
    raw: {
      factoryName: null, routeId: null, deliveryLocation: null,
      blNumber: 'EGLV149607019409', bookingRef: null, tradeDirection: 'IMPORT',
      shippingLineName: 'Evergreen', declarationNumber: null,
      ...(overrides.summaryRaw ?? {}),
    },
    fieldAccess: {
      customerId: access(), factoryName: access(), routeId: access(), deliveryLocation: access(),
      blNumber: access(), bookingRef: access(), declarationNumber: access(),
      tradeDirection: access(), shippingLineName: access(),
      ...(overrides.summaryFieldAccess ?? {}),
    },
  },
  containers: [line()],
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
} as unknown as ShipmentCusWorkspaceDetail);

function documentsSession({
  row: rowOverride,
  line: lineOverride,
  detail: detailOverride,
}: {
  row?: ShipmentCusContainerFlatRow;
  line?: ShipmentCusWorkspaceContainerLine;
  detail?: ShipmentCusWorkspaceDetail;
} = {}) {
  const activeRow = rowOverride ?? row();
  const activeLine = lineOverride ?? line();
  const activeDetail = detailOverride ?? detail();
  const onSaveDocuments = vi.fn(async (_row: ShipmentCusContainerFlatRow, _draft: ShipmentDocumentsDraft) => {});
  const view = render(
    <MemoryRouter>
      <ShipmentContainerLedger
        rows={[activeRow]}
        totalContainers={1}
        today="2026-11-02"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={{ row: activeRow, detail: activeDetail, line: activeLine, mode: 'documents' }}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={onSaveDocuments}
        onSaveContainer={vi.fn(async () => {})}
      />
    </MemoryRouter>,
  );
  return { ...view, onSaveDocuments };
}

const contInput = () => screen.getByLabelText('Số cont') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /^Lưu chứng từ và hãng tàu/ });

describe('SIL-659 — dialog «Chỉnh sửa chứng từ và hãng tàu» thêm trường Số cont', () => {
  it('renders the field LAST (after Hãng tàu), seeded from the line, uppercase-as-typed (DESIGN LOCK C)', () => {
    documentsSession();
    const grid = document.querySelector('.shipment-container-ledger__editor-grid') as HTMLElement;
    const labels = Array.from(grid.querySelectorAll(':scope > label > span')).map((el) => el.textContent);
    expect(labels).toEqual(['Số Bill', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu', 'Số cont']);
    expect(contInput().value).toBe(CONT_NUMBER);
    fireEvent.change(contInput(), { target: { value: 'temu1234586' } });
    expect(contInput().value).toBe('TEMU1234586');
  });

  it('a changed số cont arms Save and rides the documents draft (same write path as the container cell)', async () => {
    const { onSaveDocuments } = documentsSession();
    expect(saveButton()).toBeDisabled();
    // Typing the SAME number in a sloppy case/space is NOT a change (echo law).
    fireEvent.change(contInput(), { target: { value: `${CONT_NUMBER.toLowerCase()} ` } });
    expect(saveButton()).toBeDisabled();
    // A real change arms Save; the draft carries the value trimmed + uppercased
    // — the exact normalization the container cell performs.
    fireEvent.change(contInput(), { target: { value: 'msku6590001 ' } });
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaveDocuments).toHaveBeenCalledTimes(1));
    const draft = onSaveDocuments.mock.calls[0]![1] as ShipmentDocumentsDraft;
    expect(draft.containerNumber).toBe('MSKU6590001');
    // Untouched document fields stay at their persisted baselines.
    expect(draft.blNumber).toBe('EGLV149607019409');
    expect(draft.declarationNumber).toBeNull();
  });

  it('ISO 6346 mistake shows the same live hint + one-tap correction as the container cell', () => {
    documentsSession();
    // 4 letters + 7 digits but a wrong check digit → warning with a fix.
    fireEvent.change(contInput(), { target: { value: 'MSKU6590001' } });
    expect(screen.getByText('Số cont sai chữ số kiểm tra — kiểm tra lại.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đổi thành MSKU6590002' }));
    expect(contInput().value).toBe('MSKU6590002');
    // Wrong SHAPE (letters+digits off) → warning without a suggestion.
    fireEvent.change(contInput(), { target: { value: 'MSKU65900' } });
    expect(screen.getByText('Số cont sai định dạng (4 chữ cái + 7 số).')).toBeTruthy();
    // Empty field → no hint noise.
    fireEvent.change(contInput(), { target: { value: '' } });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('lock law: a READ_ONLY containerNumber keeps the field disabled WITH the reason (same gate as the container cell)', () => {
    documentsSession({
      line: line({ fieldAccess: { ...line().fieldAccess, containerNumber: access('READ_ONLY', 'Lô hàng đã khóa kế toán; không thể thay đổi container.') } }),
    });
    const input = contInput();
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('title')).toBe('Lô hàng đã khóa kế toán; không thể thay đổi container.');
    // No draft divergence → Save stays disarmed.
    expect(saveButton()).toBeDisabled();
  });

  it('a container-less lot-level (LCL) row renders NO số cont field and its save carries none', async () => {
    const lotRow = row({ id: -71, isLotLevel: true, containerNumber: null, raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null } });
    const pseudoLine = line({ id: -71, containerNumber: null, raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null }, fieldAccess: { ...line().fieldAccess, containerNumber: access('READ_ONLY', 'Lô hàng lẻ không có dòng container.') } });
    const { onSaveDocuments } = documentsSession({ row: lotRow, line: pseudoLine });
    expect(screen.queryByLabelText('Số cont')).toBeNull();

    // The lot's documents save still works — and the draft carries no number.
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-LOT-659' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaveDocuments).toHaveBeenCalledTimes(1));
    const draft = onSaveDocuments.mock.calls[0]![1] as ShipmentDocumentsDraft;
    expect(draft.containerNumber).toBeUndefined();
    expect(draft.declarationNumber).toBe('TK-LOT-659');
  });
});
