import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import {
  ShipmentContainerLedger,
  type ShipmentDetailEditMode,
  type ShipmentScheduleDraft,
} from './ShipmentContainerLedger';

// Minimal row/line/detail fixtures — the ledger only reads a per-mode subset,
// mirroring the thin-cast fixture precedent in ShipmentContainerScheduleEditor.test.tsx.
const access = (mode: 'DIRECT' | 'REQUEST' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const baseRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  customerName: 'Long Minh',
  factoryName: 'ASKEY-2',
  routeName: 'KCN Quế Võ',
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber: null,
  shippingLineName: 'Evergreen',
  isCombined: false,
  classification: 'DOUBLE',
  direction: 'IMPORT',
  containerNumber: 'MSKU1234567',
  containerTypeLabel: "20'DC",
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'SilverSea',
  plateNumber: null,
  liftSite: 'Cảng A',
  dropoffSite: 'KCN B',
  transportDate: '2026-09-10',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: '2026-09-10T08:00:00.000Z',
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: 'MSKU1234567', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null },
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
  shipmentScheduleEditable: true,
  shipmentNotesEditable: true,
  carrierEditable: true,
  plateEditable: true,
  liftSiteEditable: true,
  dropoffSiteEditable: true,
  routeEditable: true,
  customerAppointmentEditable: true,
  scheduleEditable: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const baseLine = () => ({
  id: 11,
  ordinal: 1,
  containerNumber: 'MSKU1234567',
  containerTypeId: 1,
  containerTypeLabel: "20'DC",
  routeId: 3,
  operationalSiteId: 17,
  routeName: 'KCN Quế Võ',
  dispatchStatus: 'AWAITING_VEHICLE',
  tripId: null,
  tripStatus: null,
  carrierType: 'OWN',
  externalCarrierId: null,
  externalCarrierVehicleId: null,
  carrierName: 'SilverSea',
  plateNumber: null,
  liftSiteId: 6,
  liftSite: 'Cảng A',
  dropoffSiteId: 46,
  dropoffSite: 'KCN B',
  customerAppointmentAt: '2026-09-10T08:00:00.000Z',
  raw: { containerNumber: 'MSKU1234567', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null, routeId: 3 },
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
    carrierEditable: true,
    plateEditable: true,
    containerTypeEditable: true,
    routeEditable: true,
    liftSiteEditable: true,
    dropoffSiteEditable: true,
    customerAppointmentEditable: true,
  },
  shipmentVersion: 1,
  relatedTripVersion: null,
}) as ShipmentCusWorkspaceContainerLine;

const baseDetail = () => ({
  summary: {
    id: 1,
    version: 5,
    cargoMode: 'FCL',
    raw: {
      factoryName: 'ASKEY-2',
      routeId: 3,
      deliveryLocation: 'KCN B',
      blNumber: 'EGLV149607019409',
      bookingRef: null,
      tradeDirection: 'IMPORT',
      shippingLineName: 'Evergreen',
    },
    fieldAccess: {
      customerId: access(),
      factoryName: access(),
      routeId: access(),
      deliveryLocation: access(),
      blNumber: access(),
      bookingRef: access(),
      declarationNumber: access(),
      tradeDirection: access(),
      shippingLineName: access(),
    },
  },
  selectors: {
    routes: [{ id: 3, name: 'KCN Quế Võ', label: 'KCN Quế Võ' }],
    containerTypes: [{ id: 1, code: '20DC', name: "20'DC", label: "20'DC" }],
    operationalSites: [{ id: 17, siteType: 'FACTORY', code: 'ASK-2', name: 'ASKEY-2', label: 'ASKEY-2' }, { id: 18, siteType: 'FACTORY', code: 'ASK-3', name: 'ASKEY-3', label: 'ASKEY-3' }],
    externalCarriers: [],
    carrierVehicles: [],
    ports: [],
  },
  containers: [],
}) as unknown as ShipmentCusWorkspaceDetail;

function renderLedger(mode: ShipmentDetailEditMode, row = baseRow(), detail = baseDetail(), line = baseLine()) {
  const onCancelEdit = vi.fn();
  const onSaveNotes = vi.fn(async () => {});
  const onSaveSchedule = vi.fn(async () => {});
  const onSaveIdentity = vi.fn(async () => {});
  const view = render(
    <ShipmentContainerLedger
      rows={[row]}
      totalContainers={1}
      today="2026-09-10"
      sort={null}
      onSortChange={vi.fn()}
      activeEdit={{ row, detail, line, mode }}
      editLoadingRowId={null}
      editError={null}
      onStartEdit={vi.fn()}
      onCancelEdit={onCancelEdit}
      onSaveRoute={vi.fn(async () => {})}
      onSaveVehicle={vi.fn(async () => {})}
      onSaveSchedule={onSaveSchedule}
      onSaveNotes={onSaveNotes}
      onSaveIdentity={onSaveIdentity}
      onSaveDocuments={vi.fn(async () => {})}
      onSaveContainer={vi.fn(async () => {})}
    />,
  );
  return { ...view, onCancelEdit, onSaveNotes, onSaveSchedule, onSaveIdentity };
}

describe('ShipmentContainerLedger inline editor dismissal', () => {
  it('UI-CD-12 selects the actual container factory and submits its site id', async () => {
    const { onSaveIdentity, onCancelEdit } = renderLedger('identity');
    const factory = screen.getByRole('combobox', { name: /^Nhà máy/ });
    expect(factory).toHaveValue('ASKEY-2');
    expect(screen.queryByLabelText('Điểm giao')).toBeNull();
    fireEvent.focus(factory);
    fireEvent.change(factory, { target: { value: 'ASK-3' } });
    fireEvent.keyDown(factory, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'ASKEY-3' }));
    expect(onCancelEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Lưu /  }));
    await waitFor(() => expect(onSaveIdentity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operationalSiteId: 18 })));
  });

  it('UI-CD-12 keeps LCL parent identity editing and respects a locked FCL factory', () => {
    const detail = baseDetail();
    detail.summary.cargoMode = 'LCL';
    const { unmount } = renderLedger('identity', baseRow(), detail);
    expect(screen.getByLabelText('Nhà máy')).toHaveValue('ASKEY-2');
    expect(screen.getByLabelText('Điểm giao')).toBeTruthy();
    unmount();
    const lockedLine = baseLine();
    lockedLine.fieldAccess.operationalSiteId = access('READ_ONLY');
    renderLedger('identity', baseRow(), baseDetail(), lockedLine);
    expect(screen.getByRole('combobox', { name: /^Nhà máy/ })).toBeDisabled();
  });
  it('keeps bare Enter as a newline in the notes editor; Ctrl+Enter saves', () => {
    const { onSaveNotes } = renderLedger('notes');
    const notesArea = screen.getByLabelText('Ghi chú cho khách hàng') as HTMLTextAreaElement;
    fireEvent.change(notesArea, { target: { value: 'Dòng một\nDòng hai' } });
    fireEvent.keyDown(notesArea, { key: 'Enter' });
    expect(onSaveNotes).not.toHaveBeenCalled();
    expect(notesArea.value).toBe('Dòng một\nDòng hai');
    fireEvent.keyDown(notesArea, { key: 'Enter', ctrlKey: true });
    expect(onSaveNotes).toHaveBeenCalledTimes(1);
  });
  it('documents editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('documents');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('documents editor stays open when the press lands inside it', () => {
    const { container, onCancelEdit } = renderLedger('documents');
    const editor = container.querySelector('.shipment-container-ledger__inline-editor')!;
    fireEvent.pointerDown(editor);
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it('documents editor closes on global Escape', () => {
    const { onCancelEdit } = renderLedger('documents');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('documents editor ignores presses inside the portaled react-aria popover', () => {
    const { onCancelEdit } = renderLedger('documents');
    // The UuiSelectField listbox portals to document.body — a press picking an
    // option must select, not cancel the whole editor.
    const portal = document.createElement('div');
    portal.className = 'react-aria-Popover';
    document.body.appendChild(portal);
    try {
      fireEvent.pointerDown(portal);
      expect(onCancelEdit).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }
  });

  it('vehicle editor closes on outside press and ignores the portaled searchable-select popover', () => {
    const { container, onCancelEdit } = renderLedger('vehicle');
    const editor = container.querySelector('.shipment-container-ledger__inline-editor')!;

    fireEvent.pointerDown(editor);
    expect(onCancelEdit).not.toHaveBeenCalled();

    const portal = document.createElement('div');
    portal.className = 'searchable-select__popover';
    document.body.appendChild(portal);
    try {
      fireEvent.pointerDown(portal);
      expect(onCancelEdit).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }

    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('schedule editor retains its draft while picking a portaled time (mobile=%s)', async (mobile) => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: mobile && query === '(max-width: 640px)', media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })));
    try {
      const { onCancelEdit } = renderLedger('schedule');
      const time = screen.getByLabelText('Giờ trả hàng');
      fireEvent.pointerDown(time); fireEvent.mouseDown(time); act(() => time.focus()); fireEvent.click(time);
      const dialog = await screen.findByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' });
      const exact = within(dialog).getByLabelText('Giờ chính xác (HH:mm)');
      fireEvent.pointerDown(exact); fireEvent.mouseDown(exact); act(() => exact.focus()); fireEvent.click(exact);
      fireEvent.change(exact, { target: { value: '1417' } });
      expect(onCancelEdit).not.toHaveBeenCalled();
      fireEvent.keyDown(exact, { key: 'Enter' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chọn giờ (24h) — Giờ trả hàng' })).not.toBeInTheDocument());
      expect(time).toHaveValue('14:17');
      expect(onCancelEdit).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^Lưu lịch trình/ })).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });

  it('schedule editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('schedule');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('VID-CUS-14: native date input commits before Enter when no change event arrives', async () => {
    const { onSaveSchedule } = renderLedger('schedule', baseRow({ customerAppointmentAt: null, transportDate: null }));
    fireEvent.change(screen.getByLabelText('Giờ trả hàng'), { target: { value: '16:17' } });
    const date = screen.getByLabelText('Ngày trả hàng') as HTMLInputElement;
    // The buffered date input emits the ISO contract as soon as the typed
    // DD/MM/YYYY text is complete.
    fireEvent.change(date, { target: { value: '23/09/2026' } });
    expect(screen.getByRole('button', { name: /^Lưu lịch trình/ })).toBeEnabled();
    fireEvent.keyDown(date, { key: 'Enter' });
    await waitFor(() => expect(onSaveSchedule).toHaveBeenCalledTimes(1));
    expect(onSaveSchedule).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      transportDate: null, customerAppointmentAt: '2026-09-23T16:17',
    });
  });

  it.each(['Enter', 'Save'])('VID-CUS-14: %s cannot reuse a previous date while native date segments are incomplete', async (action) => {
    const { onSaveSchedule } = renderLedger('schedule');
    fireEvent.change(screen.getByLabelText('Giờ trả hàng'), { target: { value: '16:17' } });
    const date = screen.getByLabelText('Ngày trả hàng') as HTMLInputElement;
    // Partial typed text never emits the ISO contract.
    fireEvent.change(date, { target: { value: '15/09/' } });
    if (action === 'Enter') fireEvent.keyDown(date, { key: 'Enter' });
    else fireEvent.click(screen.getByRole('button', { name: /^Lưu lịch trình/ }));
    expect(onSaveSchedule).not.toHaveBeenCalled();
    // The invalid field's validationMessage (or the editor fallback) surfaces
    // as the save error and the partial text stays in the open editor.
    expect(screen.getByRole('alert')).toHaveTextContent(/.+/);
    // Partial text stays visible in the segments of the open editor.
    expect((date as HTMLInputElement).value).toBe('15');
    expect(screen.getByLabelText('Tháng — Ngày trả hàng')).toHaveValue('09');
    expect(screen.getByLabelText('Năm — Ngày trả hàng')).toHaveValue('');
  });

  it('identity editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('identity');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  // EDIT-JUMP-01..03 (testplan/2026-09-19-edit-cell-scroll-jump.md): a plain
  // focus() on mount lets the browser's focusing steps scroll the expanded
  // editor into view, yanking the tapped cell away from the user's finger.
  it('focuses the editor container with preventScroll on mount', () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      renderLedger('container');
      const editor = document.querySelector('.shipment-container-ledger__inline-editor');
      expect(editor).not.toBeNull();
      const editorCallIndex = focusSpy.mock.contexts.findIndex((context) => context === editor);
      expect(editorCallIndex).toBeGreaterThanOrEqual(0);
      expect(focusSpy.mock.calls[editorCallIndex][0]).toEqual({ preventScroll: true });
    } finally {
      focusSpy.mockRestore();
    }
  });
});

describe('ShipmentContainerLedger missing-fields summary', () => {
  function renderLedgerWithRow(row: ShipmentCusContainerFlatRow) {
    const onStartEdit = vi.fn();
    const view = render(
      <ShipmentContainerLedger
        rows={[row]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={null}
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
      />,
    );
    return { view, onStartEdit };
  }

  it.each(['IMPORT', 'EXPORT'] as const)('SCHEDULE-LAYOUT-01 keeps time/date above the %s operation', (direction) => {
    const { view } = renderLedgerWithRow(baseRow({ direction, customerAppointmentAt: '2026-09-15T08:00:00.000Z' }));
    const schedule = view.container.querySelector('[data-label="Lịch trình"] .ops-schedule')!;
    expect(schedule.firstElementChild).toHaveTextContent('15:00 15/09/2026');
    expect(schedule.lastElementChild).toHaveTextContent(direction === 'IMPORT' ? /^trả hàng$/ : /^đóng hàng$/);
    expect(schedule.lastElementChild?.textContent).not.toContain('15/09');
  });

  it('SCHEDULE-LAYOUT-02 keeps an unknown appointment and missing-date warning explicit', () => {
    const { view } = renderLedgerWithRow(baseRow({ customerAppointmentAt: null, transportDate: null }));
    const schedule = view.container.querySelector('[data-label="Lịch trình"] .ops-schedule')!;
    expect(schedule).toHaveTextContent('Thiếu ngày vận chuyển');
    expect(schedule).toHaveTextContent('Chưa có lịch hẹn');
    expect(schedule).toHaveTextContent('Cập nhật theo từng container');
    expect(schedule.querySelector('.ops-schedule__datetime')).toBeNull();
  });

  it('collapses the missing list to a count control; key blockers stay visible outside it', () => {
    const row = baseRow({
      transportDate: null,
      customerAppointmentAt: null,
      informationStatus: 'MISSING',
      missingFields: [
        { code: 'TRANSPORT_DATE', label: 'Ngày vận chuyển' },
        { code: 'CONTAINER_NUMBER', label: 'Số container' },
        { code: 'BKS', label: 'Biển số xe' },
      ],
    });
    const { view } = renderLedgerWithRow(row);

    const toggle = screen.getByRole('button', { name: /^Thiếu / });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Số container')).toBeNull();
    // Key dispatch blockers render without expanding anything: the schedule
    // cell's badge plus the summary rail stat both carry the date gap.
    expect(screen.getAllByText('Thiếu ngày vận chuyển').length).toBeGreaterThanOrEqual(2);
    view.unmount();
  });

  it('expands to jump-to-editor buttons that open the owning cell editor', () => {
    const row = baseRow({
      informationStatus: 'MISSING',
      missingFields: [
        { code: 'CONTAINER_NUMBER', label: 'Số container' },
        { code: 'BKS', label: 'Biển số xe' },
      ],
    });
    const { view, onStartEdit } = renderLedgerWithRow(row);

    fireEvent.click(screen.getByRole('button', { name: /^Thiếu / }));
    fireEvent.click(screen.getByRole('button', { name: 'Số container' }));
    expect(onStartEdit).toHaveBeenCalledWith(row, 'container', expect.stringContaining('shipment-detail-missing-CONTAINER_NUMBER-'));
    fireEvent.click(screen.getByRole('button', { name: 'Biển số xe' }));
    expect(onStartEdit).toHaveBeenLastCalledWith(row, 'vehicle', expect.stringContaining('shipment-detail-missing-BKS-'));
    view.unmount();
  });
});

describe('schedule editor lot transport date (non-FCL affordance)', () => {
  function renderScheduleEditor(cargoMode: 'FCL' | 'LCL') {
    const row = baseRow({ shipmentScheduleEditable: true });
    const onSaveSchedule = vi.fn(async (
      _line: ShipmentCusWorkspaceContainerLine,
      _row: ShipmentCusContainerFlatRow,
      _draft: ShipmentScheduleDraft,
    ) => {});
    const detail = { ...baseDetail(), summary: { ...baseDetail().summary, cargoMode } };
    const view = render(
      <ShipmentContainerLedger
        rows={[row]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={{ row, detail, line: baseLine(), mode: 'schedule' }}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={onSaveSchedule}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />,
    );
    return { view, onSaveSchedule };
  }

  it('LCL rows expose the lot transport date and save it in the schedule draft', () => {
    const { view, onSaveSchedule } = renderScheduleEditor('LCL');

    expect(screen.getByText('Ngày vận chuyển')).toBeTruthy();
    // Segmented date fields: each renders DD/MM/YYYY digit slots; the DD slot
    // accepts the full pasted string and distributes it.
    const dateInputs = document.querySelectorAll('input[placeholder="DD"]');
    expect(dateInputs).toHaveLength(2);
    fireEvent.change(dateInputs[1], { target: { value: '20/09/2026' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu lịch trình/ }));
    expect(onSaveSchedule).toHaveBeenCalledTimes(1);
    const [, , draft] = onSaveSchedule.mock.calls[0];
    // Only the lot date moved — the appointment draft stays untouched (the
    // fixture's 08:00Z appointment reads 15:00 on the VN-pinned wall clock).
    expect(draft.transportDate).toBe('2026-09-20');
    expect(draft.customerAppointmentAt).toBe('2026-09-10T15:00');
    view.unmount();
  });

  it('invalid typed 24h time stays in the editor without saving', async () => {
    const { onSaveSchedule } = renderScheduleEditor('FCL');
    fireEvent.change(screen.getByLabelText('Giờ trả hàng'), { target: { value: '25:99' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu lịch trình/ }));
    expect(onSaveSchedule).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nhập giờ từ 00:00 đến 23:59');
    expect(screen.getByLabelText('Giờ trả hàng')).toHaveValue('25:99');
  });

  it('FCL rows keep the schedule editor appointment-only', () => {
    const { view } = renderScheduleEditor('FCL');

    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
    expect(document.querySelectorAll('input[placeholder="DD"]')).toHaveLength(1);
    view.unmount();
  });
});

describe('vehicle plate clear affordance (20260916_6)', () => {
  const lineWithPlate = () => ({
    ...baseLine(),
    carrierType: 'EXTERNAL',
    externalCarrierId: 7,
    externalCarrierVehicleId: 9,
    carrierName: 'Nhà xe A',
    plateNumber: '29C-123.45',
    permissions: { ...baseLine().permissions },
  });

  function renderVehicleEditor(overrides: Record<string, unknown> = {}) {
    const row = baseRow({ carrierName: 'Nhà xe A', plateNumber: '29C-123.45' });
    const onSaveVehicle = vi.fn(async () => {});
    render(
      <ShipmentContainerLedger
        rows={[row]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={{ row, detail: baseDetail(), line: { ...lineWithPlate(), ...overrides } as never, mode: 'vehicle' }}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={onSaveVehicle}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />,
    );
    return { onSaveVehicle };
  }

  it('offers a clear action for an assigned plate and sends clearVehicle on save', async () => {
    const { onSaveVehicle } = renderVehicleEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa biển số' }));
    const plate = screen.getByLabelText('Biển số xe') as HTMLInputElement;
    expect(plate.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /^Lưu/ }));
    await waitFor(() => expect(onSaveVehicle).toHaveBeenCalledTimes(1));
    expect(onSaveVehicle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      carrierType: 'EXTERNAL',
      clearVehicle: true,
      externalCarrierId: 7,
    }));
  });

  it('does not offer the clear action when no plate is assigned', () => {
    renderVehicleEditor({ plateNumber: null });
    expect(screen.queryByRole('button', { name: 'Xóa biển số' })).toBeNull();
  });
});
