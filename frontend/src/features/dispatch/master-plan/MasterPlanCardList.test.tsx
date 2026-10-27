import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { MasterPlanCardList } from './MasterPlanCardList';
import type { ActiveNoteDetail } from './MasterPlanNoteModal';

/** Owner redesign 23/10 — the <640px phone card list for /dispatch, in the
 *  DispatchPlanCardList shape. The suite drives the list directly (jsdom has
 *  no ResizeObserver; the grid's table is the jsdom default and the switch
 *  itself is pinned in MasterPlanGrid.rowheights.styles.test.ts). */

const noteBundle = () => ({
  editingNotesId: null as number | null,
  editingNotesValue: '',
  setEditingNotesValue: vi.fn(),
  savingNotes: false,
  notesError: null,
  notesInputRef: { current: null } as React.RefObject<HTMLTextAreaElement | null>,
  startNotesEdit: vi.fn(),
  cancelNotesEdit: vi.fn(),
  saveNotesEdit: vi.fn(),
});

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  cargoMode: 'FCL',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-08-20',
  customsCutoffAt: '2026-08-01T05:00:00.000Z',
  operationalNotes: 'Giao giờ hành chính',
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [
    { pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '2 x 40HC + 1 x 20DC' },
  ],
  ...overrides,
} as ShipmentListItem);

const renderCards = (overrides: {
  items?: ShipmentListItem[];
  onOpenDispatchDetail?: (shipment: ShipmentListItem) => void;
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
  isAllocationLocked?: (shipment: ShipmentListItem) => boolean;
  isNotesLocked?: (shipment: ShipmentListItem) => boolean;
} = {}) => render(
  <MasterPlanCardList
    items={overrides.items ?? [item()]}
    onAllocate={vi.fn()}
    onOpenDispatchDetail={overrides.onOpenDispatchDetail}
    onOpenNoteModal={vi.fn() as unknown as (detail: ActiveNoteDetail) => void}
    isAllocationLocked={overrides.isAllocationLocked ?? (() => false)}
    isNotesLocked={overrides.isNotesLocked ?? (() => false)}
    notes={noteBundle()}
    selectedLclShipmentIds={overrides.selectedLclShipmentIds}
    onToggleLclSelection={overrides.onToggleLclSelection}
  />,
);

describe('MasterPlanCardList — phone card list (owner redesign 23/10)', () => {
  it('renders one card per lot with the identity head and the SIL-507 3-dòng facts', () => {
    renderCards({ items: [item(), item({ id: 2, blNumber: 'BL-2026-002' })] });

    const cards = document.querySelectorAll('li.mpcard');
    expect(cards).toHaveLength(2);
    expect(screen.getAllByText('Công ty ABC')).toHaveLength(2);
    expect(screen.getAllByText('BL-2026-001')).toHaveLength(1);
    // Loại = plain text (Nhập/Xuất · Cont/Lẻ).
    expect(screen.getAllByText('Nhập · Cont')).toHaveLength(2);
    // Dòng 1 head: KH · mã · loại badge + giờ (the schedule head run).
    expect(screen.getAllByText('Công ty ABC')).toHaveLength(2);
    expect(screen.getAllByText('BL-2026-001')).toHaveLength(1);
    expect(screen.getAllByText('Nhập · Cont')).toHaveLength(2);
    expect(screen.getAllByText('20/08/2026')).toHaveLength(2);
    // Dòng 2 route: Nâng → Trả · tuyến · hãng tàu (wraps full, SIL-515).
    expect(screen.getAllByText('Nâng Cảng Cát Lái → Trả Kho Bình Dương · LH — Biên Hòa · Maersk')).toHaveLength(2);
    // Dòng 3 meta: joined container demand + the named missing allocation.
    expect(screen.getAllByText('2 x 40HC + 1 x 20DC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Chưa phân bổ')).toHaveLength(2);
  });

  it('SIL-507 retry: giờ leads Dòng 1 and the day\'s appointment factory rides the route line', () => {
    renderCards({
      items: [item({
        appointmentGroups: [
          { at: '2026-08-25T02:00:00.000Z', localDate: '2026-08-25', factoryName: 'NEWWEB-KHO 1', factoryShortName: 'NEWWEB-KHO 1', factoryFullName: null, containerSummary: '3 x 40DC' },
        ],
      })],
    });

    // The appointment instant (ICT 09:00) rides the identity line…
    expect(screen.getByText('09:00 25/08/2026')).toBeTruthy();
    // …and the appointment factory joins the route run (no fact lost to the
    // 3-dòng budget), between the Nâng/Trả pair and the tuyến.
    expect(screen.getByText('Nâng Cảng Cát Lái → Trả Kho Bình Dương · NEWWEB-KHO 1 · LH — Biên Hòa · Maersk')).toBeTruthy();
  });

  it('hides the allocate button once a carrier roster exists; the chips line reads instead (SIL-507 ẩn-khi-đã-phân)', () => {
    renderCards({
      items: [item({
        carrierAllocationSummary: [
          { carrierType: 'EXTERNAL', externalCarrierId: 7, carrierLabel: 'SilverSea', count20: 0, count40: 3 },
        ],
      })],
    });

    expect(screen.queryByRole('button', { name: 'Phân bổ nhà xe · BL-2026-001' })).toBeNull();
    expect(screen.getByText("Xe: SilverSea: 3x40'")).toBeTruthy();
  });

  it('keeps the roster line (no dead button) on an allocation-locked, unallocated lot', () => {
    renderCards({
      items: [item({ id: 2, blNumber: 'BL-LOCKED', status: ShipmentStatus.PENDING_DATE })],
      isAllocationLocked: (shipment) => shipment.id === 2,
    });

    expect(screen.queryByRole('button', { name: 'Phân bổ nhà xe · BL-LOCKED' })).toBeNull();
    expect(screen.getByText('Chưa phân bổ')).toBeTruthy();
  });

  it('FB-014: tapping the card opens dispatch detail; controls keep their own behavior', () => {
    const onOpenDispatchDetail = vi.fn();
    renderCards({ onOpenDispatchDetail });

    const card = document.querySelector('li.mpcard') as HTMLElement;
    // A control press (the foot button) must NOT navigate.
    fireEvent.click(screen.getByRole('button', { name: 'Phân bổ nhà xe · BL-2026-001' }));
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();
    // A card body tap navigates.
    fireEvent.click(card.querySelector('.mpcard__customer') as HTMLElement);
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDispatchDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    // Keyboard rides the card itself.
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpenDispatchDetail).toHaveBeenCalledTimes(2);
  });

  it('rides the ONE primary action (Phân bổ nhà xe) on the facts row; locked lots keep no dead button', () => {
    const onAllocate = vi.fn();
    const notes = noteBundle();
    render(
      <MasterPlanCardList
        items={[
          item(),
          item({ id: 2, blNumber: 'BL-LOCKED', status: ShipmentStatus.PENDING_DATE }),
        ]}
        onAllocate={onAllocate}
        onOpenNoteModal={vi.fn() as unknown as (detail: ActiveNoteDetail) => void}
        isAllocationLocked={(shipment) => shipment.id === 2}
        isNotesLocked={() => false}
        notes={notes}
      />,
    );

    const triggers = screen.getAllByRole('button', { name: /Phân bổ nhà xe · / });
    expect(triggers).toHaveLength(1);
    fireEvent.click(triggers[0]!);
    expect(onAllocate).toHaveBeenCalledTimes(1);
    expect(onAllocate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), triggers[0]);
    // The locked lot reads its roster line, not a dead trigger.
    expect(screen.queryByRole('button', { name: 'Phân bổ nhà xe · BL-LOCKED' })).toBeNull();
  });

  it('carries the secondary verbs in the single ⋯ menu', () => {
    const onViewContainers = vi.fn();
    const notes = noteBundle();
    render(
      <MasterPlanCardList
        items={[item()]}
        onAllocate={vi.fn()}
        onViewContainers={onViewContainers}
        onOpenNoteModal={vi.fn() as unknown as (detail: ActiveNoteDetail) => void}
        isAllocationLocked={() => false}
        isNotesLocked={() => false}
        notes={notes}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thao tác lô · BL-2026-001' }));
    const menu = screen.getByRole('menu', { name: 'Thao tác lô · BL-2026-001' });
    expect(within(menu).getByRole('menuitem', { name: /Chi tiết container/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Sửa ghi chú/ })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Sửa ghi chú/ }));
    expect(notes.startNotesEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Thao tác lô · BL-2026-001' }));
    const menu2 = screen.getByRole('menu', { name: 'Thao tác lô · BL-2026-001' });
    fireEvent.click(within(menu2).getByRole('menuitem', { name: /Chi tiết container/ }));
    expect(onViewContainers).toHaveBeenCalledTimes(1);
  });

  it('hides the ⋯ menu when the lot has no secondary verb', () => {
    renderCards({
      items: [item({ operationalNotes: null, containerCount20: 0, containerCount40: 0, containerTotal: 0, containerTypeSummary: null })],
      isNotesLocked: () => true,
    });
    expect(screen.queryByRole('button', { name: /Thao tác lô ·/ })).toBeNull();
  });

  it('opens the shared note modal from the one-line note preview', () => {
    const onOpenNoteModal = vi.fn() as unknown as (detail: ActiveNoteDetail) => void;
    render(
      <MasterPlanCardList
        items={[item({ operationalNotes: 'Giao giờ hành chính' })]}
        onAllocate={vi.fn()}
        onOpenNoteModal={onOpenNoteModal}
        isAllocationLocked={() => false}
        isNotesLocked={() => false}
        notes={noteBundle()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ghi chú: Giao giờ hành chính/ }));
    expect(onOpenNoteModal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ghi chú điều hành',
      note: 'Giao giờ hành chính',
      isOperational: true,
    }));
  });

  it('SIL-507 QA 27/10: NM/OPS note lines open the note modal, never the detail navigation', () => {
    const onOpenNoteModal = vi.fn();
    const onOpenDispatchDetail = vi.fn();
    render(
      <MasterPlanCardList
        items={[
          item({ operationalNotes: null, factoryNotes: 'Đóng ca chiều' }),
          item({ id: 2, operationalNotes: null, factoryNotes: null, opsRecoveryNotes: ['Giao theo chứng từ'] }),
        ]}
        onAllocate={vi.fn()}
        onOpenDispatchDetail={onOpenDispatchDetail}
        onOpenNoteModal={onOpenNoteModal as unknown as (detail: ActiveNoteDetail) => void}
        isAllocationLocked={() => false}
        isNotesLocked={() => false}
        notes={noteBundle()}
      />,
    );

    // The NM line is a real trigger: modal opens with the factory note…
    fireEvent.click(screen.getByRole('button', { name: /NM: Đóng ca chiều/ }));
    expect(onOpenNoteModal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ghi chú nhà máy',
      note: 'Đóng ca chiều',
      isOperational: false,
    }));
    // …and the card-level FB-014 navigation never fires from a note tap.
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();

    onOpenNoteModal.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /OPS: Giao theo chứng từ/ }));
    expect(onOpenNoteModal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ghi chú OPS',
      note: 'Giao theo chứng từ',
      isOperational: false,
    }));
    expect(onOpenDispatchDetail).not.toHaveBeenCalled();
  });

  it('serves the LCL merge mode exactly like the table: LCL tickable, FCL dimmed, grouped refused (spec 23/10 §2)', () => {
    const onToggleLclSelection = vi.fn();
    renderCards({
      items: [
        item({ id: 11, cargoMode: 'LCL', blNumber: 'BL-LCL-1' }),
        item({ id: 12, cargoMode: 'LCL', blNumber: 'BL-LCL-2', costGroupId: 'G-1' }),
        item({ id: 13, cargoMode: 'FCL', blNumber: 'BL-FCL-9' }),
      ],
      selectedLclShipmentIds: new Set([11]),
      onToggleLclSelection,
    });

    const free = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' });
    expect(free.getAttribute('aria-checked')).toBe('true');
    expect(free).toBeEnabled();

    const grouped = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-2' });
    expect(grouped).toBeDisabled();

    const fcl = screen.getByRole('checkbox', { name: 'Lô BL-FCL-9 không tham gia gộp hàng' });
    expect(fcl).toBeDisabled();
    expect(fcl.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(free);
    expect(onToggleLclSelection).toHaveBeenCalledWith(11, false);
  });

  it('renders no tick at all outside the merge mode', () => {
    renderCards({ items: [item({ cargoMode: 'LCL' })] });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('prints the LCL lot on its own cargo vocabulary (FB-091), never a container placeholder', () => {
    renderCards({
      items: [item({
        cargoMode: 'LCL',
        packageCount: 5,
        packageType: 'PALLET',
        cargoWeightKg: '1922',
        cargoVolumeCbm: '4',
        pickupWarehouseSiteName: 'Kho Lấy Hàng Đồng Nai',
        factoryName: 'Nhà máy Long Minh',
        containerPortGroups: undefined,
        containerTypeSummary: null,
      })],
    });

    expect(screen.getByText('5 PALLET')).toBeTruthy();
    expect(screen.getByText(/1,922 tấn · 4 CBM/)).toBeTruthy();
    // FB-105 §3 — Nhập: kho under Nâng, nhà máy under Trả (the meta run).
    expect(screen.getByText(/Nâng Kho Lấy Hàng Đồng Nai → Trả Nhà máy Long Minh/)).toBeTruthy();
    expect(screen.queryByText('Chưa có cont')).toBeNull();
  });

  it('merges the warning and customs cutoff into ONE severity-voiced status line (SIL-507)', () => {
    renderCards({
      items: [item({
        containersMissingAppointment: 1,
        containerTotal: 3,
      })],
    });
    // The cutoff (overdue) wins the line's voice; both facts ride the run.
    const status = screen.getByText(/Còn 1\/3 cont chưa chốt ngày đóng trả · Hải quan: /);
    expect(status).toHaveClass('mpcard__status');
    expect(status).toHaveClass('mpcard__status--urgent');
  });

  it('voices the warning severity when only the cont-booking warning is present', () => {
    renderCards({
      items: [item({
        containersMissingAppointment: 2,
        containerTotal: 3,
        customsCutoffAt: null,
      })],
    });
    const status = screen.getByText('Còn 2/3 cont chưa chốt ngày đóng trả');
    expect(status).toHaveClass('mpcard__status--warning');
  });

  it('edits notes inline through the grid-owned editor bundle', () => {
    const notes = {
      ...noteBundle(),
      editingNotesId: 1,
      editingNotesValue: 'Bản nháp',
    };
    render(
      <MasterPlanCardList
        items={[item()]}
        onAllocate={vi.fn()}
        onOpenNoteModal={vi.fn() as unknown as (detail: ActiveNoteDetail) => void}
        isAllocationLocked={() => false}
        isNotesLocked={() => false}
        notes={notes}
      />,
    );

    const editor = screen.getByLabelText('Ghi chú điều phối') as HTMLTextAreaElement;
    expect(editor.value).toBe('Bản nháp');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(notes.saveNotesEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(notes.cancelNotesEdit).toHaveBeenCalledTimes(1);
  });
});
