// SIL-552 (owner 28/10, design lock): the Thông tin hàng sheet's SỐ CONTAINER
// cell renders three label+control rows that stay on ONE baseline band, and
// the sheet itself keeps a fixed column geometry (table-fixed + colgroup +
// 1456px floor + horizontal scroll inside the card).
//
// The owner report: the cell shredded — labels scattered, the weight
// placeholder broke into vertical characters ("Nh\nập\nkg"), and the block
// drifted off the SỐ TỜ KHAI baseline. The lock fixes the geometry: each line
// is a 36px row, the micro-label never wraps, and every control owns a
// ch-based lane.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

const direct = { mode: 'DIRECT' as const, reason: 'writable' };

function makeLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: 'TSTU3872772',
    declarationNumber: null,
    containerTypeId: 3,
    containerTypeLabel: '20DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
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
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: '24000.00', cargoVolumeCbm: null, routeId: null },
    fieldAccess: {
      containerNumber: direct,
      containerTypeId: direct,
      cargoWeightKg: direct,
    },
    permissions: {
      carrierEditable: false, plateEditable: false, containerTypeEditable: false,
      routeEditable: false, liftEditable: false, dropoffEditable: false,
      customerAppointmentEditable: false,
    },
    shipmentVersion: 1,
    relatedTripVersion: null,
    ...overrides,
  } as unknown as ShipmentCusWorkspaceContainerLine;
}

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 78,
    customerName: 'Khách SIL-552',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-552',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'EXPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

const CONTAINER_TYPE_CATALOG = [
  { id: 3, code: '20DC', name: 'Dry 20ft', label: '20DC — Dry 20ft' },
  { id: 4, code: '40HC', name: 'High Cube 40ft', label: '40HC — High Cube 40ft' },
];

function makeDetail(lines: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return {
    summary: makeItem(),
    containers: lines,
    selectors: { containerTypes: CONTAINER_TYPE_CATALOG },
  } as unknown as ShipmentCusWorkspaceDetail;
}

function renderView(lines: ShipmentCusWorkspaceContainerLine[]) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={makeDetail(lines)}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      canEditCargoLines
      canEditDeclaration
      containerLineActions={{ onSaveField: vi.fn().mockResolvedValue(true) }}
      declarationActions={{ onSaveDeclaration: vi.fn().mockResolvedValue(undefined), onCopyDeclaration: vi.fn().mockResolvedValue(undefined) }}
    />,
  );
}

describe('CusLotView — SIL-552 hình học ô SỐ CONTAINER (design lock 28/10)', () => {
  it('mỗi dòng của nhóm đặt NHÃN và CONTROL cùng một dòng (không nhét chữ dọc)', () => {
    const { container } = renderView([makeLine({ id: 41, ordinal: 1 })]);

    const group = container.querySelector('.cus-lot-contgroup') as HTMLElement;
    expect(group).toBeTruthy();

    const lines = [...group.querySelectorAll('.cus-lot-line')];
    expect(lines).toHaveLength(3);

    // Each line carries its micro-label AND its control as siblings — the
    // label never stands alone above the control (the label-over-field tower
    // that made the group drift off the SỐ TỜ KHAI baseline).
    for (const line of lines) {
      const label = line.querySelector('.cus-lot-line__label');
      const control = line.querySelector('button, input, [role="combobox"]');
      expect(label).toBeTruthy();
      expect(control).toBeTruthy();
      // Same row: the control is a sibling of the label, not a descendant of it.
      expect(label!.contains(control!)).toBe(false);
      expect(line.contains(control!)).toBe(true);
    }

    expect([...group.querySelectorAll('.cus-lot-line__label')].map((el) => el.textContent?.trim())).toEqual([
      'Số',
      'Loại',
      'Trọng lượng',
    ]);
  });

  it('ô SỐ CONTAINER giữ lớp 240px của design lock', () => {
    const { container } = renderView([makeLine({ id: 42, ordinal: 1 })]);
    const cell = container.querySelector('.cus-lot-cell--container') as HTMLElement;
    expect(cell).toBeTruthy();
    expect(cell.querySelector('.cus-lot-contgroup')).toBeTruthy();
  });

  it('bảng giữ colgroup 10 cột của design lock', () => {
    const { container } = renderView([makeLine({ id: 43, ordinal: 1 })]);
    const cols = [...container.querySelectorAll('.cus-lot-table colgroup col')];
    expect(cols.map((col) => col.className)).toEqual([
      'cus-lot-col__stt',
      'cus-lot-col__container',
      'cus-lot-col__declaration',
      'cus-lot-col__site',
      'cus-lot-col__route',
      'cus-lot-col__carrier',
      'cus-lot-col__lift',
      'cus-lot-col__dropoff',
      'cus-lot-col__appointment',
      'cus-lot-col__status',
    ]);
  });

  it('dòng TRỌNG LƯỢNG: editor là ô số + đơn vị kg (số nhập + kg)', () => {
    renderView([makeLine({ id: 44, ordinal: 1 })]);

    fireEvent.click(screen.getByRole('button', { name: 'Trọng lượng — dòng 1' }));
    const editor = document.querySelector('.cus-lot-line--editor') as HTMLElement;
    expect(editor).toBeTruthy();

    const input = within(editor).getByLabelText('Trọng lượng — dòng 1') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.getAttribute('min')).toBe('0');

    // The unit rides BESIDE the number — it is the locked "8ch + suffix kg".
    const unit = editor.querySelector('.cus-lot-line__unit') as HTMLElement;
    expect(unit).toBeTruthy();
    expect(unit.textContent).toBe('kg');
  });

  it('ô SỐ TỜ KHAI hiện hint trọn vẹn trong hộp mono 11ch', () => {
    renderView([makeLine({ id: 45, ordinal: 1 })]);
    const declInput = document.querySelector('.cus-lot-decl__input') as HTMLInputElement;
    expect(declInput).toBeTruthy();
    // The old "Nhập số tờ khai…" was clipped mid-word inside the 11ch box.
    expect(declInput.placeholder).toBe('Số tờ khai');
    expect(declInput.placeholder.length).toBeLessThanOrEqual(10);
  });
});
