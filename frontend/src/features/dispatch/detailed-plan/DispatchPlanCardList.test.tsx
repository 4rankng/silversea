import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DispatchPlanCardList, formatPhoneGroups } from './DispatchPlanCardList';

/** Issue #13 (card 3-dòng, owner screenshots + Gemini consult 23/10 tối) —
 *  the <640px phone card list: 3-dòng info hierarchy (BKS · Tên/SĐT không
 *  truncate · Loại lô/tuyến) + the dynamic action slot (≤1 visible button per
 *  state). The suite drives the list directly (jsdom has no ResizeObserver;
 *  the <640 switch itself is pinned in DetailedPlanGrid.test.tsx). */

const editorProps = {
  onAtomicSave: vi.fn(),
  onCompleteExternalTrip: vi.fn(),
  onIssueOrder: vi.fn(),
  editRequest: null,
  onOpenRequestConsumed: vi.fn(),
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
  time: { deliveryDate: '2026-10-24', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: 'Giao giờ hành chính', customerNote: 'Gặp anh Hùng' },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: '15E-012.34',
    assignedDriverName: 'Nguyễn Văn Hải',
    assignedDriverPhone: '0984912234',
  },
  ports: { pickupPortId: null, pickupPortName: 'Cảng Cát Lái', dropoffPortId: null, dropoffPortName: 'Kho Sóng Thần' },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE',
  lotFullyPlated: true,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

const renderCards = (items: DispatchDetailPlanRow[], overrides: Record<string, unknown> = {}) => render(
  <DispatchPlanCardList
    items={items}
    onEditPlan={vi.fn()}
    onChangeGroupTruckInline={vi.fn()}
    onOpenTripReassign={vi.fn()}
    onExpandNote={vi.fn()}
    onDeleteLot={vi.fn()}
    {...editorProps}
    {...overrides}
  />,
);

describe('formatPhoneGroups — SĐT nhóm 3-4 số (spec A dòng 2)', () => {
  it('groups VN mobile numbers 4-3-3 and leaves short runs as-is', () => {
    expect(formatPhoneGroups('0984912234')).toBe('0984 912 234');
    expect(formatPhoneGroups(' 0964496330 ')).toBe('0964 496 330');
    expect(formatPhoneGroups('0909123457')).toBe('0909 123 457');
    expect(formatPhoneGroups('123456')).toBe('123456');
  });
});

describe('DispatchPlanCardList — 3-dòng info (C3L-01)', () => {
  it('renders the info block as exactly 3 dòng: BKS(+Xe class) / Tên · SĐT / Loại lô · tuyến', () => {
    const lclRow = row({
      cargoMode: 'LCL',
      fulfillmentType: 'LCL_SHIPMENT',
      classification: 'LCL',
      container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '2300.00' },
      lcl: {
        packageCount: 12,
        packageType: 'Kiện',
        cargoVolumeCbm: '2.3',
        group: { groupId: 'g1', order: 1, memberCount: 3, vehicleClassCode: '3.5T', vehicleClassName: 'Xe 3.5 tấn', actualTruckNo: '15E-012.34', billingTruckNo: null },
      },
      liftDrop: { warehouseName: 'Kho Sóng Thần', liftFallback: null, dropFallback: null },
    });
    renderCards([lclRow]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const info = card.querySelector('.dpcard__info') as HTMLElement;
    expect(info).not.toBeNull();
    // Dòng 1: BKS semibold + inline vehicle class.
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('15E-012.34');
    expect(info.querySelector('.dpcard__plate-class')?.textContent).toBe('Xe 3.5T');
    // Dòng 2: Tên · SĐT — the phone renders FULL, grouped, its own node.
    expect(info.querySelector('.dpcard__driver-name')?.textContent).toContain('Nguyễn Văn Hải ·');
    expect(info.querySelector('.dpcard__driver-phone')?.textContent).toBe('0984 912 234');
    // Dòng 3: Loại lô · tuyến (LCL resolves the pair from liftDrop).
    expect(info.querySelector('.dpcard__info-meta')?.textContent).toContain('Lẻ · ');
    // Exactly 3 info dòng nodes (top/driver/meta).
    expect(info.children).toHaveLength(3);
  });

  it('FCL dòng 3 carries the classification + Nâng → Trả route; cargo identity stays its own body line', () => {
    renderCards([row({ classification: 'DOUBLE' })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    expect(card.querySelector('.dpcard__info-meta')?.textContent).toBe('Kẹp · Cảng Cát Lái → Kho Sóng Thần');
    expect(card.querySelector('.dpcard__line--strong')?.textContent).toContain('MSCU1234567');
    // The old joined plate·tên·SĐT one-line run is gone.
    expect(card.textContent).not.toContain('15E-012.34 · Nguyễn Văn Hải');
  });

  it('unassigned rows read the desktop-cell placeholders (Chưa phân xe / Chưa có tài xế)', () => {
    renderCards([row({ dispatch: { ...row().dispatch, assignedPlate: null, assignedDriverName: null, assignedDriverPhone: null } })]);
    const info = document.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('Chưa phân xe');
    expect(info.querySelector('.dpcard__driver-name')?.textContent).toBe('Chưa có tài xế');
    expect(info.querySelector('.dpcard__driver-phone')).toBeNull();
  });

  it('dòng 3 falls back to the schedule line when both route sides are missing (review follow-up)', () => {
    renderCards([row({
      ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
      customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: null },
    })]);
    const meta = document.querySelector('.dpcard__info-meta')?.textContent;
    // deliveryDate 2026-10-24 + runHour 8 → the schedule line stands in.
    expect(meta).toBe('Đơn · 8H 24/10/2026');
  });

  it('AWAITING_PLATE (external deferred): slot = paper-plane, KHÔNG ⋯ (issuable theo card 20261004_359)', () => {
    renderCards([row({
      dispatch: {
        carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 5, externalCarrierVehicleId: null,
        assignedPlate: null, assignedDriverName: null, assignedDriverPhone: null,
      },
    })]);
    const slot = document.querySelector('.dpcard__action') as HTMLElement;
    const slotButtons = [...slot.querySelectorAll('button')];
    expect(slotButtons).toHaveLength(1);
    expect(slotButtons[0].getAttribute('aria-label')).toContain('Phát lệnh');
    expect(document.querySelector('.dpcard .dispatch-row-menu__trigger')).toBeNull();
    // SIL-518 sweep: the card's BKS line drops the "CUS sẽ bổ sung" filler
    // too — no plate span renders for an external deferred row.
    expect(document.querySelector('.dpcard__plate')).toBeNull();
  });
});

describe('DispatchPlanCardList — dynamic action slot (C3L-02)', () => {
  it('CHƯA phát lệnh: đúng 1 nút paper-plane, KHÔNG ⋯; tap block info mở menu tác vụ phụ', () => {
    renderCards([row()]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const slot = card.querySelector('.dpcard__action') as HTMLElement;
    // The paper-plane is the slot's ONLY visible button…
    const slotButtons = [...slot.querySelectorAll('button')];
    expect(slotButtons).toHaveLength(1);
    expect(slotButtons[0].getAttribute('aria-label')).toContain('Phát lệnh');
    // …no ⋯ trigger anywhere on the card (the menu mounts triggerless)…
    expect(document.querySelector('.dpcard .dispatch-row-menu__trigger')).toBeNull();
    // …and the card-tap surface opens the ⋯ menu (tác vụ phụ qua tap card).
    fireEvent.click(card.querySelector('.dpcard__info') as HTMLElement);
    const menu = screen.getByRole('menu', { name: 'Thao tác dòng · MSCU1234567' });
    expect(menu.textContent).toContain('Sửa điều phối');
    expect(menu.textContent).toContain('Xóa lô');
  });

  it('ĐÃ phát lệnh: slot là nút ⋯ duy nhất (không paper-plane); menu theo trip sống', () => {
    const onOpenTripReassign = vi.fn();
    renderCards([row({ taskStatus: 'DISPATCHED', dispatch: { ...row().dispatch, tripId: 77, tripStatus: 'CREATED' } })], { onOpenTripReassign });
    const slot = document.querySelector('.dpcard__action') as HTMLElement;
    const slotButtons = [...slot.querySelectorAll('button')];
    expect(slotButtons).toHaveLength(1);
    expect(slotButtons[0].className).toContain('dispatch-row-menu__trigger');
    fireEvent.click(slotButtons[0]);
    const menu = screen.getByRole('menu', { name: 'Thao tác dòng · MSCU1234567' });
    expect(menu.textContent).toContain('Phân xe lại');
    fireEvent.click(menu.querySelector('[role="menuitem"]') as HTMLElement);
    expect(onOpenTripReassign).toHaveBeenCalledWith(77);
  });

  it('xe ngoài đang chạy: Hoàn thành sống trong menu ⋯ (foot button đã bỏ)', () => {
    const onCompleteExternalTrip = vi.fn();
    renderCards([row({
      taskStatus: 'DISPATCHED',
      dispatch: {
        carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 5, externalCarrierVehicleId: null,
        assignedPlate: '29C-111.22', tripId: 88, tripStatus: 'IN_TRANSIT',
        assignedDriverName: 'Trần B', assignedDriverPhone: '0909123456',
      },
    })], { onCompleteExternalTrip });
    expect(document.querySelector('.dpcard__foot')).toBeNull();
    fireEvent.click(document.querySelector('.dpcard .dispatch-row-menu__trigger') as HTMLElement);
    const menu = screen.getByRole('menu', { name: 'Thao tác dòng · MSCU1234567' });
    const completeItem = [...menu.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Hoàn thành');
    expect(completeItem).toBeDefined();
    fireEvent.click(completeItem as HTMLElement);
    expect(onCompleteExternalTrip).toHaveBeenCalledTimes(1);
  });

  it('HOÀN THÀNH: không nút action nào, info là text tĩnh (history đóng băng) + modifier dim', () => {
    renderCards([row({ taskStatus: 'COMPLETED' })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    expect(card.classList.contains('dpcard--completed')).toBe(true);
    expect(card.querySelector('.dpcard__action')).toBeNull();
    expect(card.querySelector('.dpcard__info')?.tagName).toBe('DIV');
    expect(card.querySelector('.dpcard__info--static')).not.toBeNull();
    // No ⋯ trigger and no portalled menu anywhere for a completed card.
    expect(document.querySelector('.dpcard .dispatch-row-menu__trigger')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('controls trong card giữ behavior riêng: note mở dialog, không dính menu', () => {
    const onExpandNote = vi.fn();
    renderCards([row()], { onExpandNote });
    fireEvent.click(document.querySelector('.dpcard__note') as HTMLElement);
    expect(onExpandNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ghi chú xe' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('menu đóng băng với completed rows kể cả khi signal tap đến (không trigger chết)', () => {
    renderCards([row({ taskStatus: 'COMPLETED' })]);
    // The completed card's info block is not a button — no tap surface to open.
    expect(document.querySelector('.dpcard__info')?.tagName).toBe('DIV');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
