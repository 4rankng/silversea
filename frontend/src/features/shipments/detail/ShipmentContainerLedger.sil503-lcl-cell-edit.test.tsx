/**
 * SIL-503 — hàng LẺ (lot-level LCL rows) trên /shipments-detail: FCL-cell
 * parity cho SỐ TỜ KHAI + PHÂN XE.
 *
 * Distinct from the card-365 display-only suite it amends: a lot row now
 * opens the SHARED documents editor (its save branches to the shipment-level
 * declaration API — see use-cus-detail) and gains the BKS THỰC quick edit
 * beside the FB-093a Ảo one (same `updateLclTruck` endpoint). This file pins
 * the new affordance surface AND the boundary: every other lot cell stays
 * read-only, FCL rows on the same board keep their existing contract
 * ("2 loại hàng cùng board" — mỗi loại giữ contract riêng).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const { updateLclTruckMock } = vi.hoisted(() => ({ updateLclTruckMock: vi.fn(async () => ({ updatedShipmentIds: [] })) }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  updateLclTruck: updateLclTruckMock,
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
}));

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const row = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: -71,
  shipmentId: 71,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  customerName: 'LOG COM',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV503LOT0001',
  declarationNumber: null,
  shippingLineName: null,
  isCombined: false,
  classification: 'LCL',
  direction: 'IMPORT',
  containerNumber: null,
  containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'Nhà xe Hùng',
  carrierType: null,
  plateNumber: null,
  actualTruckNo: '15C-111.11',
  billingTruckNo: '15C-999.99',
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: '2026-10-26',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
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
  dropoffEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

function ledgerView(rows: ShipmentCusContainerFlatRow[], activeEditOverride?: Parameters<typeof ShipmentContainerLedger>[0]['activeEdit']) {
  const onStartEdit = vi.fn();
  const view = render(
    <MemoryRouter>
      <ShipmentContainerLedger
        rows={rows}
        totalContainers={rows.length}
        today="2026-10-26"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={activeEditOverride ?? null}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={onStartEdit}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />
    </MemoryRouter>,
  );
  return { ...view, onStartEdit };
}

const lotDeclarationTrigger = (bill: string) => {
  // FB-113 v2: the four headed documents columns all open the ONE editor —
  // the SỐ TỜ KHAI column is the mounting trigger. Scoped to the row owning
  // the Bill/Booking so a co-rendered FCL row can never answer the query.
  const tr = screen.getByText(bill).closest('tr')!;
  return within(tr.querySelector('td[data-label="Số tờ khai"]') as HTMLElement).getByRole('button', { name: new RegExp(`^Chỉnh sửa ô chứng từ và hãng tàu lô ${bill}`) });
};

describe('SIL-503 — lot row SỐ TỜ KHAI cell click-to-edit (documents session)', () => {
  it('cell Số tờ khai là trigger chỉnh sửa; click mở đúng phiên documents của row lot', () => {
    const { onStartEdit } = ledgerView([row()]);
    const trigger = lotDeclarationTrigger('EGLV503LOT0001');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: -71, isLotLevel: true }),
      'documents',
      'shipment-detail-edit-documents--71',
    );
  });

  it('chuẩn bị phiên documents inline: heading gọi LÔ (không phải "Container số 1") + hint lưu theo lô', () => {
    const lot = row({ declarationNumber: 'TK-LOT-503' });
    const pseudoLine = {
      id: -71,
      ordinal: 1,
      operationalSiteId: null,
      containerNumber: null,
      declarationNumber: 'TK-LOT-503',
      containerTypeId: null,
      containerTypeLabel: null,
      routeId: null,
      routeName: null,
      dispatchStatus: 'AWAITING_VEHICLE',
      tripId: null,
      tripStatus: null,
      carrierType: null,
      externalCarrierId: null,
      externalCarrierVehicleId: null,
      carrierName: 'Nhà xe Hùng',
      plateNumber: null,
      liftSiteId: null,
      liftSite: null,
      dropoffSiteId: null,
      dropoffSite: null,
      customerAppointmentAt: null,
      raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
      fieldAccess: Object.fromEntries([
        'operationalSiteId', 'containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm',
        'routeId', 'carrierType', 'externalCarrierId', 'externalCarrierVehicleId', 'plateNumber',
        'liftSiteId', 'dropoffSiteId', 'customerAppointmentAt',
      ].map((key) => [key, access('READ_ONLY')])),
      permissions: {
        carrierEditable: false, plateEditable: false, containerTypeEditable: false,
        liftSiteEditable: false, dropoffSiteEditable: false, routeEditable: false,
        customerAppointmentEditable: false,
      },
      shipmentVersion: 3,
      relatedTripVersion: null,
    } as ShipmentCusWorkspaceContainerLine;
    const detail = {
      summary: {
        id: 71,
        version: 7,
        cargoMode: 'LCL',
        raw: {
          factoryName: null, routeId: null, deliveryLocation: null,
          blNumber: 'EGLV503LOT0001', bookingRef: null, tradeDirection: 'IMPORT',
          shippingLineName: null, declarationNumber: null,
        },
        fieldAccess: {
          customerId: access(), factoryName: access(), routeId: access(), deliveryLocation: access(),
          blNumber: access(), bookingRef: access(), declarationNumber: access(),
          tradeDirection: access(), shippingLineName: access(),
        },
      },
      selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
      containers: [],
    } as unknown as ShipmentCusWorkspaceDetail;
    ledgerView([lot], { row: lot, detail, line: pseudoLine, mode: 'documents' });

    expect(screen.getByText('Chỉnh sửa chứng từ và hãng tàu')).toBeTruthy();
    expect(screen.getByText('Lô EGLV503LOT0001')).toBeTruthy();
    const declarationInput = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(declarationInput.value).toBe('TK-LOT-503');
    expect(screen.getByText(/Số tờ khai lưu theo LÔ hàng lẻ/)).toBeTruthy();
    // The per-container auto-copy affordance never renders for a lot — there
    // are no container siblings to copy onto.
    expect(screen.queryByRole('button', { name: /Copy số tờ khai sang/ })).toBeNull();
  });

  it('các cell khác của lot row vẫn read-only: không trigger identity/schedule/notes/vehicle', () => {
    const lot = row({ shipmentNotesEditable: true, customerAppointmentEditable: true });
    ledgerView([lot]);
    expect(screen.queryByRole('button', { name: /Chỉnh sửa khách hàng và lộ trình/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chỉnh sửa lịch trình/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chỉnh sửa ghi chú/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chỉnh sửa phân xe/ })).toBeNull();
    // Exactly ONE edit trigger family exists on the row: the documents cells
    // (4 headed columns share the documents mode; only Số tờ khai mounts the
    // editor).
    const editTriggers = screen.getAllByRole('button', { name: /^Chỉnh sửa/ });
    expect(editTriggers.length).toBe(4);
  });
});

describe('SIL-503 — lot row PHÂN XE: BKS thực quick edit (parity FB-093a)', () => {
  it('dòng composite giữ static text; trigger "BKS thực" riêng mở combobox seed đúng giá trị', () => {
    ledgerView([row()]);
    // FB-093a's law survives: the composite Thực line is NOT a control.
    expect(screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11').closest('button')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'BKS thực cho lô EGLV503LOT0001' });
    fireEvent.click(trigger);
    const combo = screen.getByRole('combobox', { name: 'BKS thực' }) as HTMLInputElement;
    expect(combo.value).toBe('15C-111.11');
    expect(screen.getByRole('button', { name: 'Lưu BKS thực' })).toBeTruthy();
  });

  it('gõ BKS mới rồi Lưu → đúng một updateLclTruck({shipmentId, actualTruckNo})', async () => {
    updateLclTruckMock.mockClear();
    ledgerView([row()]);
    fireEvent.click(screen.getByRole('button', { name: 'BKS thực cho lô EGLV503LOT0001' }));
    const combo = screen.getByRole('combobox', { name: 'BKS thực' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '29H-503.03' } });
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS thực' }));
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 71, actualTruckNo: '29H-503.03' });
  });

  it('lô CHƯA phân xe: một nhãn "Chưa phân xe" + nút "Nhập BKS thực" mở cùng editor và lưu được', async () => {
    updateLclTruckMock.mockClear();
    ledgerView([row({ carrierName: null, plateNumber: null, actualTruckNo: null, billingTruckNo: null })]);
    expect(screen.getByText('Chưa phân xe')).toBeTruthy();
    // No composite skeleton in the pending state (card 191026181942).
    expect(document.querySelector('[data-label="Phân xe"] strong')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Nhập BKS thực cho lô EGLV503LOT0001' }));
    const combo = screen.getByRole('combobox', { name: 'BKS thực' });
    fireEvent.change(combo, { target: { value: '29H-777.77' } });
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS thực' }));
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 71, actualTruckNo: '29H-777.77' }));
  });
});

describe('SIL-503 — 2 loại hàng cùng board: FCL giữ nguyên contract, LCL nhận cell mới', () => {
  const fclRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => row({
    id: 901,
    shipmentId: 901,
    isLotLevel: false,
    classification: 'DOUBLE',
    containerNumber: 'MSKU9012345',
    containerTypeLabel: "20'DC",
    customerName: 'Long Minh',
    billOrBookNumber: 'EGLVFCL9010001',
    carrierName: 'SilverSea',
    carrierEditable: true,
    plateEditable: true,
    ...overrides,
  });

  it('FCL row: documents trigger bắn đúng row/id như trước; lot row không cướp trigger', () => {
    const { onStartEdit } = ledgerView([fclRow(), row()]);
    const fclCell = screen.getByText('MSKU9012345').closest('tr')!;
    const fclTrigger = within(fclCell.querySelector('td[data-label="Số tờ khai"]') as HTMLElement).getByRole('button', { name: /^Chỉnh sửa ô chứng từ và hãng tàu MSKU9012345/ });
    fireEvent.click(fclTrigger);
    expect(onStartEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 901, containerNumber: 'MSKU9012345' }),
      'documents',
      'shipment-detail-edit-documents-901',
    );

    const lotTrigger = lotDeclarationTrigger('EGLV503LOT0001');
    fireEvent.click(lotTrigger);
    expect(onStartEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: -71, isLotLevel: true }),
      'documents',
      'shipment-detail-edit-documents--71',
    );
  });

  it('FCL vehicle cell giữ quick edit Ảo (billing) và KHÔNG nhận trigger BKS thực của lot', () => {
    ledgerView([fclRow({ actualTruckNo: '15C-111.11', billingTruckNo: '15C-999.99' }), row()]);
    // The FCL row keeps the FB-093a billing flow via its plate trigger.
    const fclCell = screen.getByText('MSKU9012345').closest('tr')!;
    within(fclCell).getByRole('button', { name: 'BKS ảo: 15C-999.99' });
    // The Thực quick trigger is lot-only — a container row edits its plate
    // through the vehicle editor as before.
    expect(within(fclCell).queryByRole('button', { name: /BKS thực/ })).toBeNull();
    // The lot row (second tr) carries the Thực trigger plus its Ảo trigger
    // (differs-case renders the plate-text button per FB-093a).
    const lotCell = screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11').closest('tr')!;
    within(lotCell).getByRole('button', { name: 'BKS thực cho lô EGLV503LOT0001' });
    within(lotCell).getByRole('button', { name: 'BKS ảo: 15C-999.99' });
  });

  it('documents bị khóa (READ_ONLY toàn bộ): lot row vẫn KHÔNG có trigger — parity với FCL bị khóa', () => {
    const locked = access('READ_ONLY');
    const lot = row({
      shipmentFieldAccess: {
        factoryName: locked, routeId: locked, deliveryLocation: locked,
        blNumber: locked, bookingRef: locked, tradeDirection: locked,
        shippingLineName: locked, declarationNumber: locked,
      } as ShipmentCusContainerFlatRow['shipmentFieldAccess'],
    });
    const { onStartEdit } = ledgerView([lot]);
    expect(screen.queryByRole('button', { name: /^Chỉnh sửa/ })).toBeNull();
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});
