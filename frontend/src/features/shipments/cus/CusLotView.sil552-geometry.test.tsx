// SIL-552 (owner 28/10): the Thông tin hàng sheet's SỐ CONTAINER cell.
//
// The owner report: the cell shredded — labels scattered, the weight
// placeholder broke into vertical characters ("Nh\nập\nkg"), and the block
// drifted off the SỐ TỜ KHAI baseline.
//
// The owner's two rulings:
//   1. (design lock) the cell keeps a fixed column geometry (table-fixed +
//      colgroup + 1456px floor + horizontal scroll inside the card) and every
//      group line is ONE 36px row whose label never wraps.
//   2. (second decision) the cell holds the LABEL + the VALUE only — the
//      editor FLOATS over the sheet, so the 240px column never squeezes it
//      (an inline editor is what shredded the placeholder).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

// The floating panel bails out until its anchor has been measured, and jsdom
// has no layout — pin the position (the house FactoryDetailPopover test does
// the same).
vi.mock('../../../hooks/usePopoverPosition', () => ({
  usePopoverPosition: () => ({ top: 10, left: 10, maxHeight: null }),
}));

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

describe('CusLotView — SIL-552 ô SỐ CONTAINER: nhãn + giá trị, editor nổi', () => {
  it('mỗi dòng của nhóm đặt NHÃN và GIÁ TRỊ cùng một dòng, không nhét chữ dọc', () => {
    const { container } = renderView([makeLine({ id: 41, ordinal: 1 })]);

    const group = container.querySelector('.cus-lot-contgroup') as HTMLElement;
    expect(group).toBeTruthy();

    const lines = [...group.querySelectorAll('.cus-lot-line')];
    expect(lines).toHaveLength(3);

    // Each line carries its micro-label AND its value as siblings — the label
    // never stands alone above the control (the label-over-field tower that
    // made the group drift off the SỐ TỜ KHAI baseline).
    for (const line of lines) {
      const label = line.querySelector('.cus-lot-line__label');
      const value = line.querySelector('.cus-lot-line__value');
      expect(label).toBeTruthy();
      expect(value).toBeTruthy();
      expect(label!.contains(value!)).toBe(false);
      expect(line.contains(value!)).toBe(true);
    }

    expect([...group.querySelectorAll('.cus-lot-line__label')].map((el) => el.textContent?.trim())).toEqual([
      'Số',
      'Loại',
      'Trọng lượng',
    ]);
  });

  it('ô SỐ CONTAINER KHÔNG chứa input nào — chỉ nhãn + giá trị (editor nổi)', () => {
    const { container } = renderView([makeLine({ id: 42, ordinal: 1 })]);

    const cell = container.querySelector('.cus-lot-cell--container') as HTMLElement;
    expect(cell).toBeTruthy();

    // No editable control lives inside the cell: the whole point of the
    // owner's second decision (the cell's width no longer constrains the
    // editor).
    expect(cell.querySelector('input')).toBeNull();
    expect(cell.querySelector('select')).toBeNull();
    expect(cell.querySelector('[role="combobox"]')).toBeNull();

    // The three lines still open their editor from a trigger, and each
    // trigger announces the panel it owns (aria-haspopup/expanded/controls) —
    // the house rule the drawer reads to know who owns Escape.
    for (const [name, field] of [
      ['Chỉnh sửa số container — dòng 1', 'containerNumber'],
      ['Chỉnh sửa loại container — dòng 1', 'containerTypeId'],
      ['Chỉnh sửa trọng lượng — dòng 1', 'cargoWeightKg'],
    ] as const) {
      const trigger = screen.getByRole('button', { name });
      expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-controls')).toContain(field);
    }
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

  it('click dòng TRỌNG LƯỢNG → panel NỔI (role=dialog, ngoài bảng) với ô số + kg', () => {
    renderView([makeLine({ id: 44, ordinal: 1 })]);

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa trọng lượng — dòng 1' }));

    const panel = screen.getByRole('dialog', { name: 'Chỉnh sửa thông tin container — dòng 1' });
    expect(panel).toBeTruthy();
    // The panel is portalled to the body — the table's scroll wrapper is a
    // scroll container, so an editor inside the table would be cut off.
    expect(panel.closest('.cus-lot-table')).toBeNull();
    expect(panel.parentElement).toBe(document.body);
    // The trigger points at the panel it opened.
    expect(screen.getByRole('button', { name: 'Chỉnh sửa trọng lượng — dòng 1' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Chỉnh sửa trọng lượng — dòng 1' }).getAttribute('aria-controls')).toBe(panel.id);

    const input = within(panel).getByLabelText('Trọng lượng — dòng 1') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.value).toBe('24000.00');

    // The unit rides BESIDE the number.
    const unit = panel.querySelector('.cus-lot-editor__unit') as HTMLElement;
    expect(unit).toBeTruthy();
    expect(unit.textContent).toBe('kg');

    // The panel points at the row it edits.
    expect(panel.querySelector('.cus-lot-editor__arrow')).toBeTruthy();
  });

  it('click dòng SỐ → panel nổi với ô text mono (không giới hạn bởi cột)', () => {
    renderView([makeLine({ id: 46, ordinal: 1 })]);

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa số container — dòng 1' }));
    const panel = screen.getByRole('dialog', { name: 'Chỉnh sửa thông tin container — dòng 1' });
    const input = within(panel).getByLabelText('Số container — dòng 1') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.value).toBe('TSTU3872772');
  });

  it('click dòng LOẠI → panel nổi chứa select danh mục loại', () => {
    renderView([makeLine({ id: 47, ordinal: 1 })]);

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa loại container — dòng 1' }));
    const panel = screen.getByRole('dialog', { name: 'Chỉnh sửa thông tin container — dòng 1' });
    expect(within(panel).getByDisplayValue('20DC')).toBeTruthy();
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
