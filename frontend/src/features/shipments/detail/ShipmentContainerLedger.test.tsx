import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import {
  ShipmentContainerLedger,
  type ShipmentDocumentsDraft,
  type ShipmentScheduleDraft,
} from './ShipmentContainerLedger';
import type { ShipmentDetailEditMode } from './edit-mode';

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
  carrierType: null,
  plateNumber: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
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
  const onSaveVehicle = vi.fn(async () => {});
  const onSaveDocuments = vi.fn(async (_row: ShipmentCusContainerFlatRow, _draft: ShipmentDocumentsDraft) => {});
  const onCopyDeclaration = vi.fn(async () => 0);
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
      onSaveVehicle={onSaveVehicle}
      onSaveSchedule={onSaveSchedule}
      onSaveNotes={onSaveNotes}
      onSaveIdentity={onSaveIdentity}
      onSaveDocuments={onSaveDocuments}
      onSaveContainer={vi.fn(async () => {})}
      onCopyDeclaration={onCopyDeclaration}
    />,
    { wrapper: MemoryRouter },
  );
  return { ...view, onCancelEdit, onSaveNotes, onSaveSchedule, onSaveIdentity, onSaveVehicle, onSaveDocuments, onCopyDeclaration };
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
  it('container editor shows the live ISO 6346 warning and the one-tap correction (card 261022095235b)', () => {
    // A mistyped "đổi số cont" (bad check digit) used to dead-end at the
    // server's 400 — the editor now pre-checks with the same shared helper
    // the drawer's add row uses and offers the closest valid number.
    renderLedger('container');
    const numberInput = screen.getByLabelText('Số container') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: 'MSKU1234560' } });
    expect(screen.getByText(/Sai chữ số kiểm tra/i)).toBeTruthy();
    const fix = screen.getByRole('button', { name: /^Đổi thành / }) as HTMLButtonElement;
    expect(fix.textContent ?? '').toMatch(/^Đổi thành MSKU/);
    fireEvent.click(fix);
    expect(numberInput.value).toMatch(/^MSKU\d{7}$/);
    // A valid number clears the hint entirely.
    fireEvent.change(numberInput, { target: { value: 'MSKU1234565' } });
    expect(screen.queryByText(/Sai chữ số kiểm tra/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Đổi thành / })).toBeNull();
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

  // EDIT-JUMP-01..03 (testplan/cycles/2026-09/2026-09-19-edit-cell-scroll-jump.md): a plain
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

describe('documents editor field order (FB-113, card 171026122140)', () => {
  it('FB-113 renders the documents editor fields in the card-mandated order', () => {
    // EXPORT row: the reference slot shows "Số Booking" (the card's wording);
    // IMPORT rows show "Số Bill" in the same slot — the order below is the
    // invariant either way.
    const base = baseDetail();
    const exportDetail = {
      ...base,
      summary: {
        ...base.summary,
        raw: { ...base.summary.raw, tradeDirection: 'EXPORT', blNumber: null, bookingRef: 'EGLV-BOOK-99' },
      },
    } as unknown as ShipmentCusWorkspaceDetail;
    const { container } = renderLedger('documents', baseRow({ direction: 'EXPORT' }), exportDetail);

    const grid = container.querySelector('.shipment-container-ledger__editor-grid');
    expect(grid).not.toBeNull();
    const labels = Array.from(grid!.querySelectorAll(':scope > label')).map(
      (el) => el.querySelector('span')?.textContent ?? '',
    );
    expect(labels).toEqual(['Số Booking', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu']);

    // Each field must PRECEDE the next in the DOM (the card's compare-
    // DocumentPosition step) — the chain, not just the text array.
    const chain = ['Số Booking', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu'].map((name) => {
      const matches = Array.from(grid!.querySelectorAll(':scope > label'))
        .filter((el) => el.querySelector('span')?.textContent === name);
      expect(matches).toHaveLength(1);
      return matches[0];
    });
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(
        chain[i].compareDocumentPosition(chain[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${chain[i].textContent} must precede ${chain[i + 1].textContent}`,
      ).toBeTruthy();
    }
  });
});

/* ─── FB-109/113 v2 (QA 18/10) ──────────────────────────────────────────────
 * The QA surface is the ledger TABLE, not the documents popup: "header thiếu
 * trường Số tờ khai, thứ tự không đúng" and "không có nút sửa inline". The
 * single Chứng từ & hãng tàu column becomes four headed columns in the QA
 * order (Số Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu), and every
 * editable container row carries an always-visible Sửa button in the Số tờ
 * khai column that opens the same documents editor the cell click opens. */
describe('documents column split + Sửa button (FB-109/113 v2)', () => {
  function renderIdleLedger(rows: ShipmentCusContainerFlatRow[]) {
    const onStartEdit = vi.fn();
    const view = render(
      <ShipmentContainerLedger
        rows={rows}
        totalContainers={rows.length}
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
      { wrapper: MemoryRouter },
    );
    return { view, onStartEdit };
  }

  it('FB-113 heads the table with the four document columns in the QA order', () => {
    renderIdleLedger([baseRow()]);
    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent);
    expect(headers).toEqual([
      'Khách hàng & lộ trình',
      'Bill/Booking',
      'Số tờ khai',
      'Nhập/Xuất',
      'Hãng tàu',
      'Thông số container',
      'Nâng / hạ',
      'Lịch trình',
      'Phân xe',
      'Ghi chú',
      'Trạng thái',
    ]);
  });

  it('FB-109 shows Sửa on a row WITH a tờ khai and opens the documents editor', () => {
    const row = baseRow({ declarationNumber: 'TK-2026-001' });
    const { onStartEdit } = renderIdleLedger([row]);
    const cell = screen.getByText('TK-2026-001').closest('td');
    expect(cell?.getAttribute('data-label')).toBe('Số tờ khai');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa tờ khai container MSKU1234567' }));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledWith(row, 'documents', `shipment-detail-edit-documents-${row.id}`);
  });

  it('keeps each document value in its own column, placeholders included', () => {
    renderIdleLedger([baseRow({ declarationNumber: null })]);
    const tr = screen.getByText('MSKU1234567').closest('tr')!;
    expect(tr.querySelector('td[data-label="Bill/Booking"]')?.textContent).toContain('EGLV149607019409');
    expect(tr.querySelector('td[data-label="Số tờ khai"]')?.textContent).toContain('Chưa có tờ khai');
    expect(tr.querySelector('td[data-label="Nhập/Xuất"]')?.textContent).toContain('Nhập');
    expect(tr.querySelector('td[data-label="Hãng tàu"]')?.textContent).toContain('Evergreen');
  });

  it('mounts exactly ONE documents editor — anchored on the Số tờ khai cell', () => {
    const { container } = renderLedger('documents', baseRow({ declarationNumber: 'TK-OWN-11' }));
    const editors = container.querySelectorAll('.shipment-container-ledger__inline-editor');
    expect(editors).toHaveLength(1);
    expect(container.querySelector('td[data-label="Số tờ khai"] .shipment-container-ledger__inline-editor')).not.toBeNull();
  });

  it('hides Sửa when documents are read-only and on lot-level rows', () => {
    const lockedRow = baseRow();
    const locked = { mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' };
    lockedRow.shipmentFieldAccess = {
      ...(lockedRow.shipmentFieldAccess as Record<string, typeof locked>),
      blNumber: locked,
      bookingRef: locked,
      tradeDirection: locked,
      shippingLineName: locked,
      declarationNumber: locked,
    } as typeof lockedRow.shipmentFieldAccess;
    const first = renderIdleLedger([lockedRow]);
    expect(screen.queryByRole('button', { name: /Sửa tờ khai/ })).toBeNull();
    first.view.unmount();

    const lotRow = baseRow({ id: -7, isLotLevel: true, containerNumber: null, classification: 'LCL' });
    renderIdleLedger([lotRow]);
    expect(screen.queryByRole('button', { name: /Sửa tờ khai/ })).toBeNull();
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
      { wrapper: MemoryRouter },
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

  // Card 191026181942 (TRUTH WINS): a lot-level LCL row carries its schedule
  // in transportDate — customerAppointmentAt is always null there — so the
  // lot's real ngày vận chuyển must render, never the "Chưa có lịch hẹn"
  // placeholder.
  it('SCHEDULE-LAYOUT-03 renders the lot schedule of a containerless LCL row (truth wins over the placeholder)', () => {
    const { view } = renderLedgerWithRow(baseRow({
      id: -7,
      isLotLevel: true,
      containerNumber: null,
      classification: 'LCL',
      customerAppointmentAt: null,
      transportDate: '2026-09-10',
    }));
    const schedule = view.container.querySelector('[data-label="Lịch trình"] .ops-schedule')!;
    expect(schedule).toHaveTextContent('10/09/2026');
    expect(schedule).toHaveTextContent('Ngày vận chuyển');
    expect(schedule).not.toHaveTextContent('Chưa có lịch hẹn');
    expect(schedule.querySelector('.ops-schedule__datetime')).toBeTruthy();
  });

  it('SCHEDULE-LAYOUT-04 keeps the placeholder for an LCL row with no schedule at all, naming the lot-level path', () => {
    const { view } = renderLedgerWithRow(baseRow({
      id: -7,
      isLotLevel: true,
      containerNumber: null,
      classification: 'LCL',
      customerAppointmentAt: null,
      transportDate: null,
    }));
    const schedule = view.container.querySelector('[data-label="Lịch trình"] .ops-schedule')!;
    expect(schedule).toHaveTextContent('Thiếu ngày vận chuyển');
    expect(schedule).toHaveTextContent('Chưa có lịch hẹn');
    expect(schedule).toHaveTextContent('Chốt trên Tổng quan lô hàng');
    expect(schedule).not.toHaveTextContent('Cập nhật theo từng container');
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
      { wrapper: MemoryRouter },
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

  it('a both-group edit lands in ONE Save — the editor hands the scheduler both fields', () => {
    const { view, onSaveSchedule } = renderScheduleEditor('LCL');

    // Both groups move at once: the container appointment (ngày + giờ) and the
    // lot-level Ngày vận chuyển. The screen offers a single Save, so the draft
    // must carry both and the editor must not dead-end on a red error.
    const dateInputs = document.querySelectorAll('input[placeholder="DD"]');
    fireEvent.change(screen.getByLabelText('Giờ trả hàng'), { target: { value: '16:17' } });
    fireEvent.change(dateInputs[0], { target: { value: '23/09/2026' } });
    fireEvent.change(dateInputs[1], { target: { value: '20/09/2026' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu lịch trình/ }));

    expect(onSaveSchedule).toHaveBeenCalledTimes(1);
    const [, , draft] = onSaveSchedule.mock.calls[0];
    expect(draft).toEqual({ transportDate: '2026-09-20', customerAppointmentAt: '2026-09-23T16:17' });
    expect(screen.queryByRole('alert')).toBeNull();
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
      { wrapper: MemoryRouter },
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

describe('deferred-plate copy on the ledger (card 071026141560)', () => {
  it('external carrier without plate reads CUS sẽ bổ sung, not the generic pending badge', () => {
    const row = baseRow({ carrierType: 'EXTERNAL', carrierName: 'SilverSea', plateNumber: null });
    renderLedger('notes', row);
    expect(screen.getByText('CUS sẽ bổ sung')).toBeTruthy();
    expect(screen.queryByText('Chưa gán biển số')).toBeNull();
  });

  it('OWN or unassigned rows keep the generic pending badge', () => {
    const { unmount } = renderLedger('notes', baseRow({ carrierType: 'OWN' }));
    expect(screen.getByText('Chưa gán biển số')).toBeTruthy();
    unmount();
    renderLedger('notes', baseRow({ carrierType: null }));
    expect(screen.getByText('Chưa gán biển số')).toBeTruthy();
  });
});

describe('external-vendor plate quick-select (card 20260925_6)', () => {
  const vendorDetail = () => {
    const detail = baseDetail();
    (detail.selectors as { externalCarriers: unknown[]; carrierVehicles: unknown[] }).externalCarriers = [
      { id: 91, label: 'Nhà xe Năm Troc', name: 'Nhà xe Năm Troc', shortName: null },
    ];
    (detail.selectors as { carrierVehicles: unknown[] }).carrierVehicles = [
      { id: 9001, carrierId: 91, licensePlate: '29H-123.45', label: '29H-123.45' },
    ];
    return detail;
  };

  it('NEW_EXTERNAL renders a plate field; free typing saves the new vendor with its plate', async () => {
    const { onSaveVehicle } = renderLedger('vehicle', baseRow(), vendorDetail());
    const carrierTrigger = screen.getAllByRole('button').find((b) => b.textContent === 'Đội xe SilverSea');
    expect(carrierTrigger).toBeTruthy();
    fireEvent.click(carrierTrigger!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập nhà xe mới' }));
    // THE REGRESSION: the plate entry vanished from the new-external flow
    // (16fc0d89 gated the combined field to non-NEW_EXTERNAL and deleted the
    // always-visible free input; the save guard still demands the plate).
    const plate = screen.getByLabelText('Biển số xe') as HTMLInputElement;
    fireEvent.change(plate, { target: { value: '29H-123.45' } });
    const name = screen.getByLabelText('Tên nhà xe mới');
    fireEvent.change(name, { target: { value: 'Nhà xe Năm Troc' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu/ }));
    await waitFor(() => expect(onSaveVehicle).toHaveBeenCalledTimes(1));
    expect(onSaveVehicle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      carrierType: 'EXTERNAL',
      newExternalCarrier: { name: 'Nhà xe Năm Troc', plateNumber: '29H-123.45' },
    }));
  });

  it('externalVendorPlateOptions matches the typed vendor by name or short name', async () => {
    const { externalVendorPlateOptions } = await import('../external-plate-options');
    const carriers = [
      { id: 91, label: 'Nhà xe Năm Troc', name: 'Nhà xe Năm Troc', shortName: null },
      { id: 92, label: 'Năm Troc', name: null, shortName: 'Năm Troc' },
    ];
    const vehicles = [
      { carrierId: 91, licensePlate: '29H-123.45', label: '29H-123.45' },
      { carrierId: 92, licensePlate: '29H-999.99', label: '29H-999.99' },
      { carrierId: 55, licensePlate: '30F-000.00', label: '30F-000.00' },
    ];
    const byName = externalVendorPlateOptions(carriers, vehicles, 'nhà xe năm troc');
    expect(byName.map((option) => option.value)).toEqual(['29H-123.45']);
    const byShort = externalVendorPlateOptions(carriers, vehicles, 'năm troc');
    expect(byShort.map((option) => option.value)).toEqual(['29H-999.99']);
    expect(externalVendorPlateOptions(carriers, vehicles, 'Nhà xe khác')).toEqual([]);
    expect(externalVendorPlateOptions(carriers, vehicles, '')).toEqual([]);
  });
});

describe('ShipmentContainerLedger lot-level rows (card 365)', () => {
  it('renders a container-less LCL lot read-only — no edit triggers, no add/remove actions', () => {
    const onStartEdit = vi.fn();
    // Even with DIRECT field authority everywhere, a lot-level row (the
    // single row a container-less LCL lot gets on the Chi Tiết workboard)
    // must stay display-only: there is no container line to edit.
    const lotRow = baseRow({
      id: -7,
      isLotLevel: true,
      containerNumber: null,
      containerTypeLabel: null,
      classification: 'LCL',
    });
    render(
      <ShipmentContainerLedger
        rows={[lotRow]}
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
      { wrapper: MemoryRouter },
    );
    // Card 161026232339 §II.3.1 supersedes the old hard-coded "Không có
    // container": a lot row now names the lot and says which cước class is
    // still missing instead of echoing a container-less string.
    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();
    expect(screen.getByText('Chưa chọn loại xe tính cước')).toBeTruthy();
    expect(screen.queryByText('Không có container')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chỉnh sửa/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thêm container cùng lô/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xóa container/ })).toBeNull();
  });

  // Card 171026182554 (supersedes FB-086's workboard row actions): container
  // add/remove lives ONLY in the Tổng quan drawer now — the workboard's rows
  // must not offer either button, on any row kind.
  it('a regular container row offers no add/remove container actions (card 171026182554)', () => {
    render(
      <ShipmentContainerLedger
        rows={[baseRow()]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={null}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />,
      { wrapper: MemoryRouter },
    );
    expect(screen.queryByRole('button', { name: /Thêm container cùng lô/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xóa container/ })).toBeNull();
    expect(screen.queryByTestId('add-container-form')).toBeNull();
  });
});
/* Card 20261009_3 — the "Chỉnh sửa khách hàng và lộ trình" editor docks as a
 * bottom sheet on phones (≤640px). The sheet MUST portal out of the ledger:
 * the page's `container-type: inline-size` makes `.shipments-detail-page` the
 * containing block for position:fixed descendants, so an in-tree sheet would
 * anchor to the scrolling page box instead of the viewport. */
describe('card 20261009_3 — phone bottom sheet', () => {
  const stubPhone = (phone: boolean) => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: phone && query === '(max-width: 640px)', media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })));
  };

  it('docks the identity editor as a portaled bottom sheet at ≤640px', () => {
    stubPhone(true);
    try {
      renderLedger('identity');
      const sheet = document.body.querySelector('.shipment-container-ledger__inline-editor--sheet');
      expect(sheet).not.toBeNull();
      expect(sheet!.closest('.shipment-container-ledger')).toBeNull();
      expect(document.querySelector('.shipment-container-ledger__sheet-backdrop')).not.toBeNull();
      expect(within(sheet as HTMLElement).getByText('Chỉnh sửa khách hàng và lộ trình')).toBeInTheDocument();
      expect(within(sheet as HTMLElement).getByRole('button', { name: /^Lưu khách hàng và lộ trình/ })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the editor anchored under its cell on desktop (>640px)', () => {
    stubPhone(false);
    try {
      const { container } = renderLedger('identity');
      expect(container.querySelector('.shipment-container-ledger__inline-editor--sheet')).toBeNull();
      expect(container.querySelector('.shipment-container-ledger__inline-editor')).not.toBeNull();
      expect(document.querySelector('.shipment-container-ledger__sheet-backdrop')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ─── Bulk appointment copy (card 111026111200) ───────────────────────────
 * The Chi Tiết ledger was the ONE place a user could not copy a giờ hẹn down
 * to the containers still without one. The affordance has to be picky: the
 * workboard is multi-lot AND paginated, so a row only offers a copy when its
 * OWN lot still has an empty line on this page. */
describe('bulk appointment copy affordance (card 111026111200)', () => {
  const renderCopyLedger = (rows: ShipmentCusContainerFlatRow[], onCopyAppointment = vi.fn(async () => 1)) => {
    render(
      <ShipmentContainerLedger
        rows={rows}
        totalContainers={rows.length}
        today="2026-10-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={null}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
        onCopyAppointment={onCopyAppointment}
      />,
      { wrapper: MemoryRouter },
    );
    return { onCopyAppointment };
  };

  it('offers the copy on a scheduled row only while its own lot still has an empty line', () => {
    const scheduled = baseRow({ id: 1, shipmentId: 10, customerAppointmentAt: '2026-10-15T09:30:00.000Z' });
    const empty = baseRow({ id: 2, shipmentId: 10, ordinal: 2, customerAppointmentAt: null });
    renderCopyLedger([scheduled, empty]);

    const buttons = screen.getAllByRole('button', { name: /Copy giờ hẹn/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('aria-label')).toContain('MSKU1234567');
  });

  it('offers nothing when every line of the lot is already scheduled', () => {
    renderCopyLedger([
      baseRow({ id: 1, shipmentId: 10, customerAppointmentAt: '2026-10-15T09:30:00.000Z' }),
      baseRow({ id: 2, shipmentId: 10, ordinal: 2, customerAppointmentAt: '2026-10-16T09:30:00.000Z' }),
    ]);
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn/ })).toBeNull();
  });

  it('never copies into a NEIGHBOURING lot that happens to share the page', () => {
    // Row 1 belongs to lot 10 and is scheduled; row 2 is empty but belongs to
    // lot 20. A copy from row 1 would cross lots, so no affordance appears.
    renderCopyLedger([
      baseRow({ id: 1, shipmentId: 10, customerAppointmentAt: '2026-10-15T09:30:00.000Z' }),
      baseRow({ id: 2, shipmentId: 20, ordinal: 2, customerAppointmentAt: null }),
    ]);
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn/ })).toBeNull();
  });

  it('one click is one call, carrying that row', async () => {
    const scheduled = baseRow({ id: 7, shipmentId: 10, containerNumber: 'TGBU3190086', customerAppointmentAt: '2026-10-15T09:30:00.000Z' });
    const empty = baseRow({ id: 8, shipmentId: 10, ordinal: 2, customerAppointmentAt: null });
    const { onCopyAppointment } = renderCopyLedger([scheduled, empty]);

    fireEvent.click(screen.getByRole('button', { name: /Copy giờ hẹn/ }));
    await waitFor(() => expect(onCopyAppointment).toHaveBeenCalledTimes(1));
    expect(onCopyAppointment).toHaveBeenCalledWith(scheduled);
  });

  it('disables every copy control while one is running, then re-enables', async () => {
    let release: (value: number) => void = () => {};
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const scheduled = baseRow({ id: 1, shipmentId: 10, customerAppointmentAt: '2026-10-15T09:30:00.000Z' });
    const other = baseRow({ id: 3, shipmentId: 10, customerAppointmentAt: '2026-10-16T09:30:00.000Z' });
    const empty = baseRow({ id: 2, shipmentId: 10, ordinal: 2, customerAppointmentAt: null });
    renderCopyLedger([scheduled, other, empty], vi.fn(() => pending));

    const first = screen.getAllByRole('button', { name: /Copy giờ hẹn/ })[0]!;
    fireEvent.click(first);
    await waitFor(() => expect((first as HTMLButtonElement).disabled).toBe(true));
    await act(async () => { release(1); });
    expect((first as HTMLButtonElement).disabled).toBe(false);
  });
});

// Card 261013200312 (dev-lead ruling): số tờ khai is PER-CONTAINER entry in
// the "Chi tiết lô hàng" documents editor — one number field per cont, an
// explicit copy affordance for the lot's still-empty containers (the ruling's
// "(hoặc nút copy)" option, mirroring the reviewed appointment-copy pattern),
// and free divergence afterwards. Pins: seed/edit/save draft, copy trigger
// visibility + call, single-container lot (no affordance), read-only gate,
// and the per-cont display of the propagated numbers.
describe('documents editor per-container tờ khai (card 261013200312)', () => {
  const declarationDetail = (overrides: {
    lines?: ShipmentCusWorkspaceContainerLine[];
    declarationAccess?: { mode: 'DIRECT' | 'READ_ONLY'; reason?: string };
  } = {}) => {
    const detail = baseDetail();
    (detail.summary.fieldAccess as Record<string, unknown>).declarationNumber = overrides.declarationAccess
      ? { mode: overrides.declarationAccess.mode, reason: overrides.declarationAccess.reason ?? 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' }
      : access();
    (detail as { containers: ShipmentCusWorkspaceContainerLine[] }).containers = overrides.lines ?? [
      baseLine(),
      { ...baseLine(), id: 12, ordinal: 2, containerNumber: 'MSKU7654321' },
      { ...baseLine(), id: 13, ordinal: 3, containerNumber: 'MSKU9999999' },
    ];
    return detail;
  };

  it('seeds the Số tờ khai field from the container row and hands Save the number', async () => {
    const { onSaveDocuments } = renderLedger('documents', baseRow({ declarationNumber: 'TK-OWN-11' }), declarationDetail({ lines: [baseLine()] }));
    const field = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(field.value).toBe('TK-OWN-11');
    fireEvent.change(field, { target: { value: 'TK-EDITED-11' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu/ }));
    await waitFor(() => expect(onSaveDocuments).toHaveBeenCalledTimes(1));
    expect(onSaveDocuments.mock.calls[0][1]).toMatchObject({ declarationNumber: 'TK-EDITED-11' });
  });

  it('clearing the field saves a null number', async () => {
    const { onSaveDocuments } = renderLedger('documents', baseRow({ declarationNumber: 'TK-OWN-11' }), declarationDetail({ lines: [baseLine()] }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu/ }));
    await waitFor(() => expect(onSaveDocuments).toHaveBeenCalledTimes(1));
    expect(onSaveDocuments.mock.calls[0][1]).toMatchObject({ declarationNumber: null });
  });

  it('offers the copy affordance only when a sibling still lacks a number', async () => {
    const withEmptySibling = declarationDetail({
      lines: [
        baseLine(),
        { ...baseLine(), id: 12, ordinal: 2, containerNumber: 'MSKU7654321' },
      ],
    });
    const first = renderLedger('documents', baseRow({ declarationNumber: 'TK-SRC' }), withEmptySibling);
    const copy = screen.getByRole('button', { name: /Copy số tờ khai sang 1 cont chưa có số/ });
    fireEvent.click(copy);
    await waitFor(() => expect(first.onCopyDeclaration).toHaveBeenCalledTimes(1));
    first.unmount();

    // Single-container lot: no sibling to fill — the affordance stays absent.
    const singleCont = declarationDetail({ lines: [baseLine()] });
    const { onCopyDeclaration: copySingle } = renderLedger('documents', baseRow({ declarationNumber: 'TK-SRC' }), singleCont);
    expect(screen.queryByRole('button', { name: /Copy số tờ khai/ })).toBeNull();
    expect(copySingle).not.toHaveBeenCalled();
  });

  it('hides the copy affordance when the source container has no number to copy', () => {
    renderLedger('documents', baseRow({ declarationNumber: null }), declarationDetail());
    expect(screen.queryByRole('button', { name: /Copy số tờ khai/ })).toBeNull();
  });

  it('locks the field with the reason when declaration access is READ_ONLY', () => {
    renderLedger('documents', baseRow({ declarationNumber: 'TK-OWN-11' }), declarationDetail({
      lines: [baseLine()],
      declarationAccess: { mode: 'READ_ONLY', reason: 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' },
    }));
    const field = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.title).toContain('khóa kế toán');
  });

  it('per-cont display: each sibling row shows its own number after the copy refetch', () => {
    const rows = [
      baseRow({ id: 1, declarationNumber: null }),
      baseRow({ id: 2, ordinal: 2, containerNumber: 'MSKU7654321', declarationNumber: null }),
      baseRow({ id: 3, ordinal: 3, containerNumber: 'MSKU9999999', declarationNumber: null }),
    ];
    const view = render(
      <MemoryRouter>
        <ShipmentContainerLedger
          rows={rows}
          totalContainers={3}
          today="2026-09-10"
          sort={null}
          onSortChange={vi.fn()}
          activeEdit={null}
          editLoadingRowId={null}
          editError={null}
          onStartEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveRoute={vi.fn(async () => {})}
          onSaveVehicle={vi.fn(async () => {})}
          onSaveSchedule={vi.fn(async () => {})}
          onSaveNotes={vi.fn(async () => {})}
          onSaveIdentity={vi.fn(async () => {})}
          onSaveDocuments={vi.fn(async () => {})}
          onSaveContainer={vi.fn(async () => {})}
          onCopyDeclaration={vi.fn(async () => 0)}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Chưa có tờ khai')).toHaveLength(3);
    // Post-copy refetch: every sibling carries the copied number; a later
    // per-cont divergence (cont 2) shows only on its own row.
    const refreshed = [
      { ...rows[0], declarationNumber: 'TK-COPIED' },
      { ...rows[1], declarationNumber: 'TK-DIVERGED-2' },
      { ...rows[2], declarationNumber: 'TK-COPIED' },
    ];
    view.rerender(
      <MemoryRouter>
        <ShipmentContainerLedger
          rows={refreshed}
          totalContainers={3}
          today="2026-09-10"
          sort={null}
          onSortChange={vi.fn()}
          activeEdit={null}
          editLoadingRowId={null}
          editError={null}
          onStartEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveRoute={vi.fn(async () => {})}
          onSaveVehicle={vi.fn(async () => {})}
          onSaveSchedule={vi.fn(async () => {})}
          onSaveNotes={vi.fn(async () => {})}
          onSaveIdentity={vi.fn(async () => {})}
          onSaveDocuments={vi.fn(async () => {})}
          onSaveContainer={vi.fn(async () => {})}
          onCopyDeclaration={vi.fn(async () => 0)}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('TK-COPIED')).toHaveLength(2);
    expect(screen.getAllByText('TK-DIVERGED-2')).toHaveLength(1);
    expect(screen.queryByText('Chưa có tờ khai')).toBeNull();
  });

  // Review M2 (card 261013200312): the server copies the PERSISTED number —
  // a retyped-but-unsaved value must never look copyable, or the copy would
  // silently fan out the OLD number with a success toast.
  it('hides the copy affordance while the input differs from the saved number', () => {
    const withEmptySibling = declarationDetail({
      lines: [baseLine(), { ...baseLine(), id: 12, ordinal: 2, containerNumber: 'MSKU7654321' }],
    });
    renderLedger('documents', baseRow({ declarationNumber: 'TK-SAVED' }), withEmptySibling);
    expect(screen.getByRole('button', { name: /Copy số tờ khai sang 1 cont chưa có số/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-RETYPED' } });
    expect(screen.queryByRole('button', { name: /Copy số tờ khai/ })).toBeNull();
    // Restore the saved value — the affordance comes back (still one save away
    // from being copyable truthfully).
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-SAVED' } });
    expect(screen.getByRole('button', { name: /Copy số tờ khai sang 1 cont chưa có số/ })).toBeTruthy();
  });
});

/* Card 161026232339 — CUS "Chi tiết lô hàng" (DEV SPEC Hàng lẻ §II.3.1):
 * the THÔNG SỐ CONTAINER cell prints the lot's chosen cước classes and the
 * PHÂN XE cell splits into BKS thực / BKS báo khách (Ảo), the second line
 * carrying the inline quick edit that writes through `updateLclTruck`. */
const { updateLclTruckMock } = vi.hoisted(() => ({ updateLclTruckMock: vi.fn(async () => ({ updatedShipmentIds: [] })) }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  updateLclTruck: updateLclTruckMock,
}));

describe('ShipmentContainerLedger lot billing facts (card 161026232339)', () => {
  const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => baseRow({
    id: -7,
    isLotLevel: true,
    containerNumber: null,
    containerTypeLabel: null,
    classification: 'LCL',
    ...overrides,
  });

  function lotLedger(rows: ShipmentCusContainerFlatRow[]) {
    return (
      <MemoryRouter>
        <ShipmentContainerLedger
          rows={rows}
          totalContainers={rows.length}
          today="2026-09-10"
          sort={null}
          onSortChange={vi.fn()}
          activeEdit={null}
          editLoadingRowId={null}
          editError={null}
          onStartEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveRoute={vi.fn(async () => {})}
          onSaveVehicle={vi.fn(async () => {})}
          onSaveSchedule={vi.fn(async () => {})}
          onSaveNotes={vi.fn(async () => {})}
          onSaveIdentity={vi.fn(async () => {})}
          onSaveDocuments={vi.fn(async () => {})}
          onSaveContainer={vi.fn(async () => {})}
        />
      </MemoryRouter>
    );
  }

  function renderLot(row: ShipmentCusContainerFlatRow) {
    const view = render(lotLedger([row]));
    // A lot row's quick edit lives in the same cell; the row object identity is
    // what the ledger's optimistic overlay keys off, so the refetch is modelled
    // by re-rendering the SAME component with the server's row.
    return {
      ...view,
      rerenderWith: (rows: ShipmentCusContainerFlatRow[]) => view.rerender(lotLedger(rows)),
    };
  }

  it('AC1 prints the chosen cước classes: "Lô hàng lẻ | Thu: Xe 3.5T | Trả: Xe 10T"', () => {
    renderLot(lotRow({ revVehicleClassCode: '3.5T', costVehicleClassCode: '10T' }));
    expect(screen.getByText('Lô hàng lẻ | Thu: Xe 3.5T | Trả: Xe 10T')).toBeTruthy();
    expect(screen.queryByText('Không có container')).toBeNull();
    expect(screen.queryByText('Chưa chọn loại xe tính cước')).toBeNull();
  });

  it('AC1 prints only the classes the lot bills into (Thu-only lot)', () => {
    renderLot(lotRow({ revVehicleClassCode: '5T' }));
    expect(screen.getByText('Lô hàng lẻ | Thu: Xe 5T')).toBeTruthy();
  });

  it('AC1/AC5 a lot with no chosen class keeps its own label, never "Không có container"', () => {
    renderLot(lotRow());
    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();
    expect(screen.getByText('Chưa chọn loại xe tính cước')).toBeTruthy();
    expect(screen.queryByText('Không có container')).toBeNull();
  });

  it('AC2 prints both phân xe lines when the billing plate differs from BKS thực', () => {
    renderLot(lotRow({ carrierName: 'Nhà xe Hùng', actualTruckNo: '15C-111.11', billingTruckNo: '15C-999.99' }));
    expect(screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11')).toBeTruthy();
    expect(screen.getByText('BKS Báo khách (Ảo): 15C-999.99')).toBeTruthy();
  });

  it('AC2 hides the Ảo line while the billing plate equals BKS thực, keeping the quick edit reachable', () => {
    renderLot(lotRow({ carrierName: 'Nhà xe Hùng', actualTruckNo: '15C-111.11', billingTruckNo: '15C-111.11' }));
    expect(screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11')).toBeTruthy();
    expect(screen.queryByText('BKS Báo khách (Ảo): 15C-111.11')).toBeNull();
    expect(screen.getByRole('button', { name: /Sửa BKS báo khách cho lô/ })).toBeTruthy();
  });

  it('AC5 renders one muted "Chưa phân xe" for an unallocated lot — no BKS composite (card 191026181942)', () => {
    renderLot(lotRow({ carrierName: null, plateNumber: null, actualTruckNo: null, billingTruckNo: null }));
    expect(screen.getByText('Chưa phân xe')).toBeTruthy();
    // The pending state is the muted missing-field label — one line in the
    // Phân xe cell, never the BKS skeleton or a badge.
    expect(document.querySelector('[data-label="Phân xe"] .shipment-container-ledger__missing')?.textContent).toBe('Chưa phân xe');
    expect(document.querySelector('[data-label="Phân xe"] strong')).toBeNull();
    expect(document.querySelector('[data-label="Phân xe"] .shipment-container-ledger__plate')).toBeNull();
    expect(screen.queryByText(/BKS Thực/)).toBeNull();
    expect(screen.queryByText(/BKS Báo khách/)).toBeNull();
    expect(document.body.textContent).not.toContain('undefined');
  });

  it('AC5 an allocated lot whose name slot is empty keeps the composite with "—" for the N/A name', () => {
    renderLot(lotRow({ carrierName: null, plateNumber: null, actualTruckNo: '15C-111.11', billingTruckNo: null }));
    expect(screen.getByText('— - BKS Thực: 15C-111.11')).toBeTruthy();
  });

  it('AC3 picks a suggested plate and saves through updateLclTruck, then survives the refetch', async () => {
    updateLclTruckMock.mockClear();
    const row = lotRow({ carrierName: 'Nhà xe Hùng', actualTruckNo: '15C-111.11', billingTruckNo: null });
    const view = renderLot(row);

    fireEvent.click(screen.getByRole('button', { name: /Sửa BKS báo khách cho lô/ }));
    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' });
    fireEvent.click(combo);
    fireEvent.click(await screen.findByRole('option', { name: '15C-111.11' }));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '15C-111.11' }));

    // The page refetches its rows; the persisted value is what the cell reads.
    view.rerenderWith([{ ...row, billingTruckNo: '15C-111.11' }]);
    expect(screen.getByText('Nhà xe Hùng - BKS Thực: 15C-111.11')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'BKS báo khách (Ảo)' })).toBeNull();
  });

  it('AC3 free-typed plate (not in the list) saves the same way', async () => {
    updateLclTruckMock.mockClear();
    renderLot(lotRow({ carrierName: 'Nhà xe Hùng', actualTruckNo: '15C-111.11', billingTruckNo: '15C-999.99' }));

    fireEvent.click(screen.getByText('BKS Báo khách (Ảo): 15C-999.99'));
    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '29H-777.77' } });
    // Closing the suggestion popover first: react-aria isolates the rest of the
    // page from the accessibility tree while a popover is open, so the footer's
    // actions are only reachable as buttons once it closes (a real click closes
    // it on the outside press).
    fireEvent.keyDown(combo, { key: 'Escape' });
    expect(screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' })).toHaveValue('29H-777.77');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));

    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '29H-777.77' }));
    // The optimistic overlay shows the saved plate before the page refetches.
    expect(screen.getByText('BKS Báo khách (Ảo): 29H-777.77')).toBeTruthy();
  });

  it('AC3 a rejected save keeps the editor open and reports the server message', async () => {
    updateLclTruckMock.mockClear();
    updateLclTruckMock.mockRejectedValueOnce(new Error('Lô đã khóa sổ'));
    renderLot(lotRow({ carrierName: 'Nhà xe Hùng', actualTruckNo: '15C-111.11', billingTruckNo: '15C-999.99' }));

    fireEvent.click(screen.getByText('BKS Báo khách (Ảo): 15C-999.99'));
    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' });
    fireEvent.change(combo, { target: { value: '29H-777.77' } });
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lô đã khóa sổ');
    expect(screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' })).toBeTruthy();
  });

  it('AC4 FCL rows keep their rendering: container cell and single-plate phân xe cell', () => {
    renderLot(baseRow({ plateNumber: '29H-123.45', carrierName: 'SilverSea' }));
    expect(screen.getByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByText("20'DC")).toBeTruthy();
    expect(screen.getByText('29H-123.45')).toBeTruthy();
    expect(screen.queryByText(/BKS Thực/)).toBeNull();
    expect(screen.queryByText(/BKS Báo khách/)).toBeNull();
  });

  // Card 171026000407 §II.3.1 — the container branch follows the same
  // "Xe ảo khác Xe thực tế" rule the spec gives for Hàng lẻ: only a differing
  // BKS báo khách earns the second line.
  it('AC1 FCL rows with a differing billing plate print both phân xe lines', () => {
    renderLot(baseRow({ plateNumber: '29H-123.45', carrierName: 'SilverSea', billingTruckNo: '29H-999.99' }));
    expect(screen.getByText('SilverSea - BKS Thực: 29H-123.45')).toBeTruthy();
    expect(screen.getByText('BKS Báo khách (Ảo): 29H-999.99')).toBeTruthy();
  });

  it('AC1/AC4 the FCL Ảo line quick-edits through the same updateLclTruck write', async () => {
    updateLclTruckMock.mockClear();
    renderLot(baseRow({ plateNumber: '29H-123.45', carrierName: 'SilverSea', billingTruckNo: '29H-999.99' }));

    fireEvent.click(screen.getByText('BKS Báo khách (Ảo): 29H-999.99'));
    const combo = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '29H-777.77' } });
    // The suggestion popover isolates the footer until it closes (same
    // pattern as the lot-level quick-edit tests above).
    fireEvent.keyDown(combo, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS báo khách' }));

    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 1, billingTruckNo: '29H-777.77' }));
    // One mutation, nothing else: the cell change never fetches per row.
    expect(updateLclTruckMock).toHaveBeenCalledTimes(1);
    // The optimistic overlay shows the saved plate before the page refetches.
    expect(screen.getByText('BKS Báo khách (Ảo): 29H-777.77')).toBeTruthy();
  });

  it('AC2 an equal billing plate (normalized) keeps the single-plate FCL cell', () => {
    renderLot(baseRow({ plateNumber: '29H-123.45', carrierName: 'SilverSea', billingTruckNo: '29h-123.45' }));
    expect(screen.getByText('29H-123.45')).toBeTruthy();
    expect(screen.queryByText(/BKS Thực/)).toBeNull();
    expect(screen.queryByText(/BKS Báo khách/)).toBeNull();
  });
});
