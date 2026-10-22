import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ApiError } from '../../../lib/api';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';
import { getOffsetDateString } from './cusAppointmentUtils';

const { updateCusShipmentContainerLine, removeCusShipmentContainerRow, addCusShipmentContainerRow } = vi.hoisted(() => ({
  updateCusShipmentContainerLine: vi.fn(),
  removeCusShipmentContainerRow: vi.fn(),
  addCusShipmentContainerRow: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  updateCusShipmentContainerLine,
  removeCusShipmentContainerRow,
  addCusShipmentContainerRow,
}));
const { completeDispatchExternalTrip } = vi.hoisted(() => ({
  completeDispatchExternalTrip: vi.fn(),
}));
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dispatchPlanningClient')>()),
  completeDispatchExternalTrip,
}));

const detail = {
  summary: { id: 1, version: 4 },
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    dispatchStatus: 'AWAITING_VEHICLE',
    customerAppointmentAt: '2026-08-20T02:00:00.000Z',
    containerTypeId: 5,
    routeId: 7,
    liftSiteId: 3,
    dropoffSiteId: 4,
    plateNumber: '15C-184.62',
    carrierType: 'EXTERNAL',
    externalCarrierId: 9,
    shipmentVersion: 4,
    // Card 20260923_9: the ledger renders the line's own cargo weight.
    raw: {
      containerNumber: 'MSKU1234567',
      containerTypeId: 5,
      cargoWeightKg: '12500',
      cargoVolumeCbm: '26.25',
      routeId: 7,
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
  }],
  selectors: { externalCarriers: [], ports: [], containerTypes: [], routes: [], carrierVehicles: [] },
} as unknown as ShipmentCusWorkspaceDetail;

function renderLedger(opts: { onAppointmentSavedAndExit?: () => void; onDirtyChange?: (dirty: boolean) => void; detail?: ShipmentCusWorkspaceDetail } = {}) {
  const props = {
    detail: opts.detail ?? detail,
    onLineSaved: vi.fn(),
    getIdempotencyKey: () => 'test-key',
    clearIdempotencyKey: () => {},
    idPrefix: 'test',
    onAppointmentSavedAndExit: opts.onAppointmentSavedAndExit,
    onDirtyChange: opts.onDirtyChange,
  };
  const utils = render(
    <ToastProvider>
      <ContainerLedger {...props} />
    </ToastProvider>,
  );
  const rerenderWithSavedLine = () => utils.rerender(
    <ToastProvider>
      <ContainerLedger {...props} detail={{ ...detail, containers: [{ ...detail.containers[0], customerAppointmentAt: '2026-09-16T02:00:00.000Z' }] }} />
    </ToastProvider>,
  );
  return { ...utils, rerenderWithSavedLine, confirmButtons: () => utils.container.querySelectorAll('.cus-container-confirm, .cus-container-revert') };
}

// The segmented datetime rework split each part into per-digit inputs
// ([data-seg]); the first segment of each part still accepts full strings
// (paste distribution fills the following segments).
function appointmentInputs(): { time: HTMLInputElement; date: HTMLInputElement } {
  const root = document.querySelector('[data-split-datetime]');
  expect(root).toBeTruthy();
  const time = root!.querySelector<HTMLInputElement>('input[data-seg="hh"]');
  const date = root!.querySelector<HTMLInputElement>('input[data-seg="dd"]');
  expect(time).toBeTruthy();
  expect(date).toBeTruthy();
  return { time: time!, date: date! };
}
function setAppointment(time: string, date: string) {
  const { time: timeInput, date: dateInput } = appointmentInputs();
  if (time) fireEvent.change(timeInput, { target: { value: time } });
  if (date) fireEvent.change(dateInput, { target: { value: date } });
}

describe('ContainerLedger confirm affordances', () => {
  // The save mock is module-level: without a clear, call counts accumulate
  // across tests and every assertion would have to track the whole file's
  // history.
  beforeEach(() => {
    updateCusShipmentContainerLine.mockClear();
  });

  it('renders Lưu/Hủy actions when row inputs change, and discards on Hủy', () => {
    const view = renderLedger();
    const plateInput = screen.getByLabelText(/Biển số xe/) as HTMLInputElement;
    fireEvent.change(plateInput, { target: { value: '15C-999.99' } });

    expect(view.confirmButtons()).toHaveLength(2);
    const saveBtn = view.container.querySelector('.cus-container-confirm')!;
    const cancelBtn = view.container.querySelector('.cus-container-revert')!;
    expect(saveBtn).toBeTruthy();
    expect(cancelBtn).toBeTruthy();

    // Click Hủy resets
    fireEvent.click(cancelBtn);
    expect(view.confirmButtons()).toHaveLength(0);
    expect(plateInput.value).toBe('15C-184.62');
  });

  it('FB-009: copies the row giờ hẹn to the clipboard and toasts Đã copy, independent of copy-down destinations', async () => {
    renderLedger();
    // The scheduled line exposes the copy-time affordance beside its value.
    const copyTime = screen.getByRole('button', { name: 'Copy Giờ hẹn đóng trả' });
    expect(copyTime.closest('td')?.dataset.label).toBe('Giờ hẹn đóng/trả');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(copyTime);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('09:00 20/08/2026'));
    expect(await screen.findByText('Đã copy giờ hẹn 09:00 20/08/2026')).toBeTruthy();
  });

  it('opens appointment popover when clicking trigger, updates value without inline buttons, and closes on backdrop click', () => {
    renderLedger();
    const trigger = screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ });

    // Initially popover is not in document
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();

    // Open popover by clicking trigger
    fireEvent.click(trigger);
    expect(document.querySelector('.cus-appointment-popover')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ })).toBeDefined();

    // No inline Save/Cancel inside the popover itself
    expect(document.querySelector('.cus-appointment-popover .cus-container-confirm')).toBeNull();

    // Close via the house outside-press layer (no private backdrop — card 20261001_251)
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();
  });

  // Card 20260923_9 (Chief 23/09): the add-container row must ride the SAME
  // column grid as the container rows — each control inside the cell of the
  // column it belongs to, every input-less column keeping an empty cell, and
  // the action column holding the row actions and the add row's Thêm/Hủy.
  //
  // jsdom has no layout engine (offsetLeft/getBoundingClientRect are 0 for
  // everything), so the ≤2px edge measurement the Chief asked for is a rung-3
  // browser check (testplan case QA-2026-09-23-09). What jsdom CAN prove — and
  // what the browser measurement depends on — is that every control sits in
  // the same table, in the cell whose column index matches its column, with a
  // cell for every track. RED before this card: the form was a flex row
  // OUTSIDE the table (no tfoot, no cellIndex), so every index assertion below
  // failed.
  it('rides the ledger column grid: one cell per column, every control in its own column', () => {
    renderLedger();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));

    const table = screen.getByRole('table');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Container', 'Số tờ khai', 'Loại cont', 'Tuyến', 'Điều vận', 'Nhà xe', 'Biển số',
      'Nâng', 'Hạ', 'Trọng lượng', 'Giờ hẹn đóng/trả', 'Thao tác',
    ]);

    const addRow = table.querySelector<HTMLTableRowElement>('tfoot tr');
    expect(addRow).toBeTruthy();
    const cellOf = (selector: string) => {
      const node = selector.startsWith('#')
        ? document.querySelector(selector)
        : addRow!.querySelector(selector);
      expect(node, selector).toBeTruthy();
      return (node as HTMLElement).closest('th, td') as HTMLTableCellElement;
    };

    // The add row covers every track, so no column upstream can shift.
    expect(addRow!.children).toHaveLength(headers.length);
    expect(cellOf('input[aria-label="Số container"]').cellIndex).toBe(0);
    expect(cellOf('.cus-container-ledger__add-select').cellIndex).toBe(2);
    expect(cellOf('input[aria-label="Trọng lượng (kg)"]').cellIndex).toBe(9);
    expect(cellOf('input[aria-label="Giờ hẹn đóng/trả"]').cellIndex).toBe(10);
    expect(cellOf('.cus-container-ledger__add-actions').cellIndex).toBe(11);

    // Card 201026124500 (A.1): the copy-down columns (Tuyến/Nhà xe/Nâng/Hạ)
    // now carry their seeded cell; the tờ khai track (1 — inherited from the
    // lot server-side, never typed here), Điều vận (computed) and Biển số
    // (per-truck entry, ngoài danh sách A.1) keep an EMPTY cell — every track
    // stays its own cell, never merged away. This fixture's rows carry no
    // display names and an empty ports catalog, so the seeded cells read '—'
    // here; the seeding suite pins the copied values themselves.
    for (const index of [3, 5, 7, 8]) {
      const cell = addRow!.children[index] as HTMLElement;
      expect(cell.className).toContain('cus-container-cell');
      expect(cell.textContent).toBe('—');
    }
    for (const index of [1, 4, 6]) {
      const cell = addRow!.children[index] as HTMLElement;
      expect(cell.className).toContain('cus-container-ledger__add-blank');
      expect(cell.textContent).toBe('');
    }

    // The data row rides the same tracks, and its action lives in the same
    // column as the add row's buttons.
    const dataRow = table.querySelector<HTMLTableRowElement>('tbody tr')!;
    expect(dataRow.children).toHaveLength(headers.length);
    const cellByLabel = (label: string) => dataRow.querySelector(`[data-label="${label}"]`) as HTMLTableCellElement;
    expect(cellByLabel('Số tờ khai').cellIndex).toBe(1);
    expect(cellByLabel('Trọng lượng').cellIndex).toBe(9);
    expect(cellByLabel('Giờ hẹn đóng/trả').cellIndex).toBe(10);
    expect(cellByLabel('Thao tác').cellIndex).toBe(11);
    expect(cellByLabel('Thao tác').querySelector('.cus-container-row__remove')).toBeTruthy();
  });

  it('renders the line weight in the Trọng lượng column, em dash when missing', () => {
    const { unmount } = render(
      <ToastProvider>
        <ContainerLedger detail={detail} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="weight" />
      </ToastProvider>,
    );
    const weightCell = document.querySelector('tbody [data-label="Trọng lượng"]') as HTMLElement;
    expect(weightCell.textContent).toBe('12,5 tấn');
    unmount();

    const lineWithoutWeight = {
      ...detail,
      containers: [{ ...detail.containers[0], raw: { ...detail.containers[0].raw, cargoWeightKg: null } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    render(
      <ToastProvider>
        <ContainerLedger detail={lineWithoutWeight} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="weight-empty" />
      </ToastProvider>,
    );
    expect((document.querySelector('tbody [data-label="Trọng lượng"]') as HTMLElement).textContent).toBe('—');
  });

  it('saves appointment date and time and plate on save — sends modified fields', async () => {
    const view = renderLedger();
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    // Open popover and type the complete 24h entry into the single text input
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');

    // Close popover via the house outside-press layer
    fireEvent.pointerDown(document.body);

    // Also change plate
    fireEvent.change(screen.getByLabelText(/Biển số xe/), { target: { value: '15C-999.99' } });

    // Save all changes via consolidated Save button
    const saveButton = view.container.querySelector('.cus-container-confirm')!;
    fireEvent.click(saveButton);

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , payload] = updateCusShipmentContainerLine.mock.calls[0];
    // Naive popover drafts persist as Vietnam wall-clock (+07:00), not the
    // browser zone — a +08 host used to shift the stored instant by an hour.
    expect(payload.customerAppointmentAt).toBe('2026-09-11T09:00:00+07:00');
    expect(payload.plateNumber).toBe('15C-999.99');
  });

  it('Enter inside the popover saves the ledger and returns the row to display', async () => {
    renderLedger();
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');

    // Enter commits straight from the portaled popover — no backdrop click,
    // no footer button, no table-level key handler.
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , payload] = updateCusShipmentContainerLine.mock.calls[0];
    expect(payload.customerAppointmentAt).toBe('2026-09-11T09:00:00+07:00');

    // Back to display: popover closed, the trigger shows the saved value.
    await waitFor(() => expect(document.querySelector('.cus-appointment-popover')).toBeNull());
    const trigger = screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ });
    expect(trigger.getAttribute('aria-label')).toContain('09:00 11/09/2026');
  });

  it('card 071026205310: committing the appointment sweeps the row\'s other dirty fields into the same save', async () => {
    const detailWithPorts = {
      ...detail,
      selectors: { ...detail.selectors, ports: [{ id: 3, label: 'Cảng Hải Phòng' }, { id: 8, label: 'Bãi Chân Thật - THT' }] },
    } as unknown as ShipmentCusWorkspaceDetail;
    renderLedger({ detail: detailWithPorts });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    // Dirty the lift port first, through the row's own select (base: Cảng Hải Phòng).
    fireEvent.click(screen.getByLabelText(/Cảng nâng của container/));
    const portFilter = document.querySelector<HTMLInputElement>('.searchable-select__popover input[role="combobox"]');
    expect(portFilter).toBeTruthy();
    fireEvent.change(portFilter!, { target: { value: 'Chan That' } });
    fireEvent.click(screen.getByRole('option', { name: /Bãi Chân Thật - THT/ }));

    // Then commit the appointment from the popover's Enter path — the same
    // partial save that used to post ONLY the appointment.
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , payload] = updateCusShipmentContainerLine.mock.calls[0];
    expect(payload.customerAppointmentAt).toBe('2026-09-11T09:00:00+07:00');
    // The dirty port rides the same POST — a ports-only payload let the row
    // read clean and the save-exit hook close the drawer over the draft.
    expect(payload.liftSiteId).toBe(8);
  });

  it('card 071026205310 r2: the preset-pill path sweeps the dirty port like every other commit path', async () => {
    const detailWithPorts = {
      ...detail,
      selectors: { ...detail.selectors, ports: [{ id: 3, label: 'Cảng Hải Phòng' }, { id: 8, label: 'Bãi Chân Thật - THT' }] },
    } as unknown as ShipmentCusWorkspaceDetail;
    renderLedger({ detail: detailWithPorts });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    // Dirty the lift port first (base: Cảng Hải Phòng).
    fireEvent.click(screen.getByLabelText(/Cảng nâng của container/));
    const portFilter = document.querySelector<HTMLInputElement>('.searchable-select__popover input[role="combobox"]');
    expect(portFilter).toBeTruthy();
    fireEvent.change(portFilter!, { target: { value: 'Chan That' } });
    fireEvent.click(screen.getByRole('option', { name: /Bãi Chân Thật - THT/ }));

    // Lead's failing sequence: tap Hôm nay, tap 08:00, Enter — no typing.
    // Enter lands on the FOCUSED pill, so the popover re-clicks it and
    // commits inside the SAME event — the exact cascade that must not read
    // a stale drafts closure.
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    const pill = screen.getByRole('button', { name: '08:00' });
    fireEvent.click(pill);
    fireEvent.keyDown(pill, { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , payload] = updateCusShipmentContainerLine.mock.calls[0];
    // The pill-composed appointment (today + 08:00) reached the wire…
    expect(String(payload.customerAppointmentAt)).toContain('T08:00');
    // …and the dirty port rode the same POST.
    expect(payload.liftSiteId).toBe(8);
  });

  it('Escape in the popover closes without saving', async () => {
    renderLedger();
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');

    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Escape' });

    // Popover closes, but the draft stays — nothing is sent.
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('_34: Escape reverts the appointment draft part and never exits the drawer', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    const onDirtyChange = vi.fn();
    renderLedger({ onAppointmentSavedAndExit, onDirtyChange });
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    // Typing in the popover dirties the ledger draft (onChange → onDraftChange).
    setAppointment('11:00', '19/09/2026');
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Escape' });
    // Dismiss-without-commit: popover closes, the abandoned value is reverted.
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));
    expect(onAppointmentSavedAndExit).not.toHaveBeenCalled();
    // Reopen shows the base value, not the abandoned draft.
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    const reopened = appointmentInputs();
    expect(reopened.time.value).not.toBe('11');
    expect(reopened.date.value).not.toBe('19');
  });

  it('_34 invalid-entry: out-of-range typing blocks commit with a visible error', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    renderLedger({ onAppointmentSavedAndExit });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 9 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    // 24h out-of-range hour: unparseable — must never fall through to
    // committing the silently-reverted default.
    setAppointment('24:45', '20/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });

    await new Promise((r) => setTimeout(r, 200));
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(onAppointmentSavedAndExit).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"], .cus-inline-edit-error');
    expect(alert?.textContent).toBeTruthy();
  });

  it('_34 clobber pin: Enter in the appointment field commits the TYPED value, never the stale buffer', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    renderLedger({ onAppointmentSavedAndExit });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 9 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('12:00', '19/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const payload = updateCusShipmentContainerLine.mock.calls[0][2] as { customerAppointmentAt: string };
    // _34 clobber pin: the TYPED value persists — never the stale base buffer.
    expect(payload.customerAppointmentAt).toContain('12:00');
    expect(payload.customerAppointmentAt).toContain('2026-09-19');
    // Exit coverage lives in the Enter-commit-success test; here the settle
    // poll correctly waits (no saved-line rerender was performed).
  });

  it('Enter-commit success exits the detail surface to the list (fires onAppointmentSavedAndExit once)', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    const view = renderLedger({ onAppointmentSavedAndExit });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    // Production: the refetched line lands, drafts reset, the saved line stops
    // being dirty, and only then does the exit fire. Mirror that by rerendering
    // with the saved line; the exit must NOT fire while the line is still dirty.
    await waitFor(() => expect(onAppointmentSavedAndExit).not.toHaveBeenCalled());
    view.rerenderWithSavedLine();
    await waitFor(() => expect(onAppointmentSavedAndExit).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();
  });

  it('typed Enter exits using the current clean host state, not its previous dirty closure', async () => {
    const discarded = vi.fn();
    const exited = vi.fn();
    function Host() {
      const [current, setCurrent] = useState(detail);
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      return <ToastProvider><ContainerLedger
        detail={current}
        onLineSaved={async (line) => { if (line) setCurrent({ ...current, containers: [line] }); }}
        getIdempotencyKey={() => 'typed-enter-current-state'}
        clearIdempotencyKey={() => {}}
        idPrefix="real-host"
        onDirtyChange={setDirty}
        onSavingChange={setSaving}
        onAppointmentSavedAndExit={() => { if (dirty || saving) discarded(); else exited(); }}
      /></ToastProvider>;
    }
    updateCusShipmentContainerLine.mockResolvedValueOnce({ line: {
      ...detail.containers[0], shipmentVersion: 5, customerAppointmentAt: '2026-09-19T07:45:00.000Z',
    } });
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('14:45', '19/09/2026');
    fireEvent.keyDown(appointmentInputs().time, { key: 'Enter' });
    await waitFor(() => expect(exited).toHaveBeenCalledTimes(1));
    expect(discarded).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /Chọn giờ hẹn đóng/ })).not.toBeInTheDocument();
  });

  it('failed commit does not exit the detail surface', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    renderLedger({ onAppointmentSavedAndExit });
    updateCusShipmentContainerLine.mockRejectedValue(new Error('boom'));

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(onAppointmentSavedAndExit).not.toHaveBeenCalled();
    expect(document.querySelector('.cus-appointment-popover')).not.toBeNull();
  });

  it('Escape never fires the exit callback', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    renderLedger({ onAppointmentSavedAndExit });
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 50));
    expect(onAppointmentSavedAndExit).not.toHaveBeenCalled();
  });

  it('_42: settle-poll exit holds while a save is in flight, then fires once it clears', async () => {
    const onAppointmentSavedAndExit = vi.fn();
    const view = renderLedger({ onAppointmentSavedAndExit });
    let resolveSave: (value: { line: { id: number; shipmentVersion: number } }) => void;
    updateCusShipmentContainerLine.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Chọn giờ hẹn đóng\/trả/ }), { key: 'Enter' });
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));

    // Drafts go clean while the save is STILL in flight (the refetch race).
    view.rerenderWithSavedLine();
    await new Promise((r) => setTimeout(r, 250));
    // Holding: saving has not cleared, so the exit must not fire mid-teardown.
    expect(onAppointmentSavedAndExit).not.toHaveBeenCalled();

    resolveSave!({ line: { id: 10, shipmentVersion: 5 } });
    await waitFor(() => expect(onAppointmentSavedAndExit).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  // 20261004_325: preset picks + Enter converge on the SAME commit path as
  // typed entry (commitAppointment → POST → close), and the dirty banner
  // stays truthful: the pick is a real unsaved draft until the saved line
  // lands — never papered over, never stuck after the save. The fix landed
  // in 4bfba1c6 (popover unit test covers the Enter routing); this pins the
  // ledger-level convergence and dirty semantics.
  it('_325: preset picks + Enter from the focused pill commit and clear dirtiness only once the saved line lands', async () => {
    const onDirtyChange = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T09:00:00+07:00'));
    const expectedDay = getOffsetDateString(2, new Date()); // Ngày kia
    const view = renderLedger({ onDirtyChange });
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ngày kia' }));
    fireEvent.click(screen.getByRole('button', { name: '13:30' }));
    // The pick marks a genuinely unsaved container draft (banner truthfully on).
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    // Enter with the browser's post-click focus: the target is the pill button.
    fireEvent.keyDown(screen.getByRole('button', { name: '13:30' }), { key: 'Enter' });

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const payload = updateCusShipmentContainerLine.mock.calls[0][2] as { customerAppointmentAt: string };
    expect(payload.customerAppointmentAt).toBe(`${expectedDay}T13:30:00+07:00`);
    // Popover closes after the save — same close path as typed entry.
    await waitFor(() => expect(document.querySelector('.cus-appointment-popover')).toBeNull());
    // Dirtiness clears only when the saved line actually lands (host refetch).
    view.rerenderWithSavedLine();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    vi.useRealTimers();
  });
});

describe('ContainerLedger external-trip staff close', () => {
  const trippedExternalDetail = {
    ...detail,
    containers: [{
      ...detail.containers[0],
      tripId: 77,
      tripStatus: 'CREATED',
    }],
  } as unknown as ShipmentCusWorkspaceDetail;

  function renderWith(detailFixture: ShipmentCusWorkspaceDetail, props: Record<string, unknown> = {}) {
    return render(
      <ToastProvider>
        <ContainerLedger
          detail={detailFixture}
          onLineSaved={vi.fn()}
          getIdempotencyKey={() => 'test-key'}
          clearIdempotencyKey={() => {}}
          idPrefix="test"
          {...props}
        />
      </ToastProvider>,
    );
  }

  it('offers Hoàn thành on external lines with a live trip and closes through the confirm dialog', async () => {
    completeDispatchExternalTrip.mockResolvedValue({ tripId: 77, status: 'COMPLETED' });
    const onExternalTripCompleted = vi.fn();
    renderWith(trippedExternalDetail, { onExternalTripCompleted });

    fireEvent.click(screen.getByRole('button', { name: /Hoàn thành chuyến xe ngoài của container/ }));
    fireEvent.click(await screen.findByText('Hoàn thành chuyến'));

    await waitFor(() => expect(completeDispatchExternalTrip).toHaveBeenCalledWith(77));
    await waitFor(() => expect(onExternalTripCompleted).toHaveBeenCalledTimes(1));
    // The confirm dialog closes; the parent refetch flips the line to COMPLETED.
    await waitFor(() => expect(screen.queryByText('Hoàn thành chuyến')).toBeNull());
  });

  it('hides the action on lines without a live external trip', () => {
    renderWith(detail);
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
  });
});

describe('drawer plate clear affordance (20260916_6 addendum)', () => {
  it('shows Xóa biển số for an assigned plate and empties the draft on click', () => {
    render(
      <ToastProvider>
        <ContainerLedger detail={detail} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="drawer-clear" />
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Xóa biển số' });
    fireEvent.click(button);
    const plate = document.querySelector('#drawer-clear-plate-10') as HTMLInputElement;
    expect(plate.value).toBe('');
  });
});

describe('silent-409 surfacing on last-container delete (20260923_5)', () => {
  it('surfaces the 409 business message as a visible error toast when the lot keeps zero containers', async () => {
    removeCusShipmentContainerRow.mockRejectedValueOnce(
      new ApiError(409, { error: 'Lô hàng phải có ít nhất một container.' }, 'Lô hàng phải có ít nhất một container.'),
    );
    render(
      <ToastProvider>
        <ContainerLedger detail={detail} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="silent-409" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    // CUS-10: the row button only opens the danger confirm — the API fires
    // after the dialog's own Xóa container.
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await screen.findByText('Lô hàng phải có ít nhất một container.');
  });

  it('stays silent when the row delete succeeds — no error toast', async () => {
    removeCusShipmentContainerRow.mockResolvedValueOnce({ removed: true } as never);
    render(
      <ToastProvider>
        <ContainerLedger detail={detail} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="silent-409-success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await screen.findByText(/Đã xóa container/);
    expect(screen.queryByText('Lô hàng phải có ít nhất một container.')).toBeNull();
  });
});

describe('vendor-scoped plate datalist (card 20260925_6 sweep)', () => {
  const vendorDetail = {
    ...detail,
    selectors: {
      externalCarriers: [{ id: 9, label: 'Nhà xe Năm Troc', name: 'Nhà xe Năm Troc', shortName: null }],
      ports: [], containerTypes: [], routes: [],
      carrierVehicles: [
        { id: 1, carrierId: 9, licensePlate: '15C-184.62', label: '15C-184.62' },
        { id: 2, carrierId: 77, licensePlate: '30F-999.99', label: '30F-999.99' },
      ],
    },
    containers: [{ ...detail.containers[0] }],
  } as unknown as ShipmentCusWorkspaceDetail;

  function renderVendors() {
    return render(
      <ToastProvider>
        <ContainerLedger
          detail={vendorDetail}
          onLineSaved={vi.fn()}
          getIdempotencyKey={() => 'test-key'}
          clearIdempotencyKey={() => {}}
          idPrefix="test"
        />
      </ToastProvider>,
    );
  }

  it('an existing external carrier offers only that vendor\'s plates', () => {
    const { container } = renderVendors();
    const datalist = container.querySelector('datalist[id$="-plates-10"]');
    expect(datalist).toBeTruthy();
    expect(Array.from(datalist!.querySelectorAll('option')).map((option) => option.value))
      .toEqual(['15C-184.62']);
  });

  it('NEW_EXTERNAL: typing the vendor name scopes the datalist to that vendor', () => {
    const { container } = renderVendors();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhà xe' }));
    const name = screen.getByLabelText('Tên nhà xe mới');
    fireEvent.change(name, { target: { value: 'Nhà xe Năm Troc' } });
    const datalist = container.querySelector('datalist[id$="-plates-10"]');
    expect(Array.from(datalist!.querySelectorAll('option')).map((option) => option.value))
      .toEqual(['15C-184.62']);
  });
});

// Card 071026100800 — after a container is removed from a lot, the OVERVIEW
// row (containerSummary "2x40DC", container count) must refresh immediately:
// the remove path refreshes the drawer (onExternalTripCompleted → force detail
// reload) AND the list row (onLineSaved(null) → applySavedContainerLine's
// no-line branch → loadList). Missing the list refresh kept the deleted row's
// numbers on screen until a manual reload — the reported bug.
describe('071026100800 — xóa container làm tươi hàng tổng quan', () => {
  it('remove success refreshes the overview row AND the drawer detail', async () => {
    const onLineSaved = vi.fn();
    const onExternalTripCompleted = vi.fn();
    removeCusShipmentContainerRow.mockClear();
    removeCusShipmentContainerRow.mockResolvedValueOnce({});
    render(
      <ToastProvider>
        <ContainerLedger
          detail={detail}
          onLineSaved={onLineSaved}
          onExternalTripCompleted={onExternalTripCompleted}
          getIdempotencyKey={() => 'test-key'}
          clearIdempotencyKey={() => {}}
          idPrefix="remove-refresh"
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(removeCusShipmentContainerRow).toHaveBeenCalledTimes(1));
    // null = structural change (no line payload) → applySavedContainerLine
    // refreshes the list, exactly like the add path does with a line.
    await waitFor(() => expect(onLineSaved).toHaveBeenCalledWith(null));
    expect(onExternalTripCompleted).toHaveBeenCalledTimes(1);
  });

  it('a failed remove refreshes nothing — the data did not change', async () => {
    const onLineSaved = vi.fn();
    const onExternalTripCompleted = vi.fn();
    removeCusShipmentContainerRow.mockClear();
    removeCusShipmentContainerRow.mockRejectedValueOnce(new ApiError(409, { error: 'Không xóa được container.' }, 'Không xóa được container.'));
    render(
      <ToastProvider>
        <ContainerLedger
          detail={detail}
          onLineSaved={onLineSaved}
          onExternalTripCompleted={onExternalTripCompleted}
          getIdempotencyKey={() => 'test-key'}
          clearIdempotencyKey={() => {}}
          idPrefix="remove-fail"
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(removeCusShipmentContainerRow).toHaveBeenCalledTimes(1));
    expect(onLineSaved).not.toHaveBeenCalled();
    expect(onExternalTripCompleted).not.toHaveBeenCalled();
  });
  // Card 20261007_395 — an LCL lot is ONE containerless LCL_SHIPMENT by
  // design; the server refuses a container add with 409 "Chỉ lô hàng FCL mới
  // thêm được dòng container." The ledger used to offer "Thêm container" on
  // LCL anyway (its own comment claimed LCL manages containers here), so staff
  // could only ever walk into a dead end. FCL must still get the affordance.
  it('offers the add-container action on FCL and withholds it on LCL', () => {
    const onLineSaved = vi.fn();
    const { unmount } = render(
      <ToastProvider>
        <ContainerLedger
          detail={{ ...detail, summary: { ...detail.summary, cargoMode: 'FCL' } }}
          onLineSaved={onLineSaved}
          onExternalTripCompleted={vi.fn()}
          getIdempotencyKey={() => 'k'}
          clearIdempotencyKey={() => {}}
          idPrefix="fcl-add"
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Thêm container' })).toBeTruthy();
    unmount();

    render(
      <ToastProvider>
        <ContainerLedger
          detail={{ ...detail, summary: { ...detail.summary, cargoMode: 'LCL' } }}
          onLineSaved={onLineSaved}
          onExternalTripCompleted={vi.fn()}
          getIdempotencyKey={() => 'k'}
          clearIdempotencyKey={() => {}}
          idPrefix="lcl-add"
        />
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Thêm container' })).toBeNull();
  });
});

// CUS-10 (ruling Frank 21/10): the drawer "Chi tiết container" owns the
// Xóa container action behind a danger confirm naming the number. TICKET-09
// stays intact: the Chi tiết-lô table keeps its own absence pins
// (ShipmentContainerLedger.test.tsx / ShipmentContainersPage.test.tsx).
describe('CUS-10 — drawer Xóa container confirm flow', () => {
  const renderCus10 = (props: Record<string, unknown> = {}) => render(
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={vi.fn()}
        getIdempotencyKey={() => 'k'}
        clearIdempotencyKey={() => {}}
        idPrefix="cus10"
        {...props}
      />
    </ToastProvider>,
  );

  beforeEach(() => {
    removeCusShipmentContainerRow.mockClear();
  });

  it('renders the labeled danger button by default and hides it without the remove permission', () => {
    const { unmount } = renderCus10();
    expect(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }).className)
      .toContain('btn--danger-outline');
    unmount();

    renderCus10({ canRemoveContainer: false });
    expect(screen.queryByRole('button', { name: /Xóa container/ })).toBeNull();
  });

  it('deletes only through the confirm dialog — Hủy never calls the API', async () => {
    removeCusShipmentContainerRow.mockResolvedValueOnce({ removedId: 10, shipmentVersion: 5 });
    const onLineSaved = vi.fn();
    const onContainerRemoved = vi.fn();
    renderCus10({ onLineSaved, onContainerRemoved });

    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    // The dialog names the number and the API has NOT fired yet.
    expect(await screen.findByText('Xóa container MSKU1234567?')).toBeTruthy();
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByText('Xóa container MSKU1234567?')).toBeNull());
    expect(removeCusShipmentContainerRow).not.toHaveBeenCalled();

    // Reopen and confirm — the existing remove API runs once and the host
    // gets the structural-change null line plus the close-the-drawer signal.
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(removeCusShipmentContainerRow).toHaveBeenCalledTimes(1));
    expect(removeCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      10,
      { expectedShipmentVersion: 4 },
      'k',
    );
    await waitFor(() => expect(onLineSaved).toHaveBeenCalledWith(null));
    expect(onContainerRemoved).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open on a guard 409 and surfaces the API reason — no refresh, no close signal', async () => {
    removeCusShipmentContainerRow.mockRejectedValueOnce(
      new ApiError(409, { error: 'Container đã gắn chuyến xe (TRIP-9). Hủy hoặc thay thế lệnh điều xe trước khi xóa dòng.' }, 'Container đã gắn chuyến xe (TRIP-9). Hủy hoặc thay thế lệnh điều xe trước khi xóa dòng.'),
    );
    const onLineSaved = vi.fn();
    const onContainerRemoved = vi.fn();
    renderCus10({ onLineSaved, onContainerRemoved });

    fireEvent.click(screen.getByRole('button', { name: 'Xóa container MSKU1234567' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa container' }));

    // The API's guard reason is the visible error — never a silent failure.
    expect(await screen.findByText(/Container đã gắn chuyến xe \(TRIP-9\)/)).toBeTruthy();
    expect(onLineSaved).not.toHaveBeenCalled();
    expect(onContainerRemoved).not.toHaveBeenCalled();
    // The dialog stays open so the operator can retry or walk away with Hủy.
    expect(screen.getByText('Xóa container MSKU1234567?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa container' })).toBeTruthy();
  });
});

// Card 201026124500 (181026185900 A.1), amended by card 211026112600 (FB-086
// regression, 21/10 — newest customer ruling wins): opening the add form
// copies EVERY field of the lot's existing rows down — Loại cont, Tuyến,
// Nhà xe, Nâng, Hạ, Trọng lượng, Giờ hẹn — per-column FIRST non-null,
// mirroring the add API's lot-default inherit. Số container stays the
// operator's own entry. The loại-cont copy is CLIENT-side only: the seed
// pre-fills the pick (catalog-guarded like the ports pair) and the submit
// sends it explicitly — a deliberately cleared type still rides explicit
// null, so A.1's wire contract and the server inherit are untouched.
describe('add-row seed copies the lot row values (A.1, card 201026124500 + 211026112600)', () => {
  const ports = [
    { id: 3, code: 'CDV', name: 'Cảng Đình Vũ', label: 'CDV — Cảng Đình Vũ' },
    { id: 4, code: 'HICT', name: 'TC - HICT', label: 'HICT — TC - HICT' },
    { id: 8, code: 'THT', name: 'Bãi Chân Thật - THT', label: 'THT — Bãi Chân Thật - THT' },
  ];
  const a1Row = (over: Record<string, unknown> = {}) => ({
    ...detail.containers[0],
    routeId: 7,
    routeName: 'ASKEY',
    carrierType: 'OWN',
    externalCarrierId: null,
    carrierName: 'SilverSea',
    liftSiteId: 3,
    liftSite: 'Cảng Đình Vũ',
    dropoffSiteId: 4,
    dropoffSite: 'TC - HICT',
    customerAppointmentAt: '2026-09-01T03:00:00.000Z', // 10:00 VN, 01/09
    raw: { ...detail.containers[0].raw, routeId: 7, cargoWeightKg: '12500' },
    ...over,
  });
  const a1Detail = (containers: unknown[]) => ({
    ...detail,
    summary: { ...detail.summary, cargoMode: 'FCL' },
    selectors: {
      ...detail.selectors,
      ports,
      containerTypes: [{ id: 5, code: '40HC', name: "40'HC", label: "40HC - 40'HC" }],
    },
    containers,
  }) as unknown as ShipmentCusWorkspaceDetail;
  const addRowEl = () => document.querySelector('.cus-container-ledger__add-row') as HTMLElement;

  it('seeds the A.1 copy set TRỪ Loại cont (REQ-22 REVERSED 22/10); Số container stays entry', () => {
    renderLedger({ detail: a1Detail([a1Row()]) });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    // The one entry field: the number is blank. Loại cont stays EMPTY per
    // card 221026173728 (owner ruling 22/10 hủy 21/10): copy TẤT CẢ trừ
    // Số cont + Loại cont — operator picks the type themselves.
    expect((screen.getByLabelText('Số container') as HTMLInputElement).value).toBe('');
    expect(within(addRowEl()).getByRole('button', { name: /Chưa chọn loại cont/ })).toBeTruthy();
    // The A.1 copy set renders in the add row's own column cells.
    expect(within(addRowEl()).getByText('ASKEY')).toBeTruthy();
    expect(within(addRowEl()).getByText('SilverSea')).toBeTruthy();
    expect(within(addRowEl()).getByText('Cảng Đình Vũ')).toBeTruthy();
    expect(within(addRowEl()).getByText('TC - HICT')).toBeTruthy();
    expect((screen.getByLabelText('Trọng lượng (kg)') as HTMLInputElement).value).toBe('12500');
    const { time, date } = appointmentInputs();
    expect(time.value).toBe('10');
    expect(date.value).toBe('01');
  });

  it('carries the copy set on the submit payload; Loại cont rides null when left unpicked', async () => {
    addCusShipmentContainerRow.mockResolvedValue({ line: null });
    renderLedger({ detail: a1Detail([a1Row()]) });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /^Thêm$/ }));

    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      {
        expectedShipmentVersion: 4,
        containerNumber: 'CSQU3054383',
        // Card 221026173728 (22/10 REQ-22 REVERSED): Loại cont is NOT seeded;
        // an unpicked type rides EXPLICIT null so the server's lot-default
        // inherit can never re-copy it.
        containerTypeId: null,
        routeId: 7,
        liftSiteId: 3,
        dropoffSiteId: 4,
        carrierType: 'OWN',
        externalCarrierId: null,
        cargoWeightKg: '12500',
        customerAppointmentAt: expect.stringContaining('2026-09-01T10:00'),
      },
      'test-key',
    ));
  });

  it('sends EXPLICIT null when the operator picks then clears the type (A.1 wire contract intact)', async () => {
    // 22/10: the seed no longer pre-fills Loại cont, but a deliberately
    // cleared type must still ride explicit null (card 201026124500 wire
    // contract, unchanged).
    addCusShipmentContainerRow.mockResolvedValue({ line: null });
    renderLedger({ detail: a1Detail([a1Row()]) });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    // Trigger opens on the placeholder; pick 40HC then clear back.
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /Chưa chọn loại cont/ }));
    fireEvent.click(await screen.findByRole('option', { name: '40HC' }));
    expect(within(addRowEl()).getByRole('button', { name: /40HC/ })).toBeTruthy();
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /40HC/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Chưa chọn loại cont' }));
    expect(within(addRowEl()).getByRole('button', { name: /Chưa chọn loại cont/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /^Thêm$/ }));

    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ containerNumber: 'CSQU3054383', containerTypeId: null }),
      'test-key',
    ));
  });

  it('never seeds a lift/drop id outside the ports catalog (legacy snapshot id)', async () => {
    // Snapshot-fallback case: the projection's liftSiteId can be a snapshot
    // site from a DIFFERENT catalog while the container's pickupPortId column
    // is null — copying that id into pickupPortId would corrupt the
    // reference, so the seed leaves the whole cell uncopied (same as the add
    // API's column inherit, which also has nothing to inherit there).
    addCusShipmentContainerRow.mockResolvedValue({ line: null });
    renderLedger({
      detail: a1Detail([a1Row({ liftSiteId: 999, liftSite: 'Cảng Đình Vũ', dropoffSiteId: 4 })]),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(within(addRowEl()).queryByText('Cảng Đình Vũ')).toBeNull();
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /^Thêm$/ }));

    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalled());
    const payload = addCusShipmentContainerRow.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(payload.liftSiteId).toBeUndefined();
    expect(payload.dropoffSiteId).toBe(4);
  });

  it('takes each seeded field from the FIRST row that has it (per-column first non-null)', () => {
    // Row 2 disagrees on EVERY seeded field (type 5 inherited only via row 2,
    // route 8/OTHER ROUTE, EXTERNAL carrier 9, lift 8, drop 3, weight 500) so
    // a first→last pick regression fails here field by field. Row 1 carries
    // no type of its own, so Loại cont also comes from row 2. Only the
    // appointment comes from row 2 (row 1 is undated) — 10:00 on 01/09
    // Vietnam wall clock.
    renderLedger({
      detail: a1Detail([
        a1Row({ customerAppointmentAt: null, containerTypeId: null, containerTypeLabel: null }),
        a1Row({
          id: 11,
          ordinal: 2,
          containerNumber: 'MSKU7654321',
          routeId: 8,
          routeName: 'OTHER ROUTE',
          carrierType: 'EXTERNAL',
          externalCarrierId: 9,
          carrierName: 'Đức Anh',
          liftSiteId: 8,
          liftSite: 'Bãi Chân Thật - THT',
          dropoffSiteId: 3,
          dropoffSite: 'Cảng Đình Vũ',
          raw: { ...detail.containers[0].raw, routeId: 8, cargoWeightKg: '500.00' },
        }),
      ]),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const cellText = (label: string) => addRowEl().querySelector(`[data-label="${label}"]`)?.textContent;
    expect(cellText('Tuyến')).toBe('ASKEY');
    expect(cellText('Nhà xe')).toBe('SilverSea');
    expect(cellText('Nâng')).toBe('Cảng Đình Vũ');
    expect(cellText('Hạ')).toBe('TC - HICT');
    expect((screen.getByLabelText('Trọng lượng (kg)') as HTMLInputElement).value).toBe('12500');
    // Loại cont: NOT seeded anymore (REQ-22 REVERSED 22/10) — placeholder.
    expect(within(addRowEl()).getByRole('button', { name: /Chưa chọn loại cont/ })).toBeTruthy();
    const { time, date } = appointmentInputs();
    expect(time.value).toBe('10');
    expect(date.value).toBe('01');
  });

  it('strips the decimal tail from a seeded weight ("500.00" → "500")', () => {
    renderLedger({
      detail: a1Detail([
        a1Row({ raw: { ...detail.containers[0].raw, routeId: 7, cargoWeightKg: '500.00' } }),
      ]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect((screen.getByLabelText('Trọng lượng (kg)') as HTMLInputElement).value).toBe('500');
  });

  it('never seeds a loại-cont id outside the catalog (LONG MINH legacy id) — placeholder + explicit null', async () => {
    // Catalog-guard pin (211026112600): the ref row carries containerTypeId 1
    // but the workspace catalog only offers id 5 — an id with no dropdown
    // option must not ride the seed (the trigger would show a pick the
    // operator never saw), and the submit then sends explicit null, exactly
    // like the add API's column inherit with an uncatalogued cell.
    addCusShipmentContainerRow.mockResolvedValue({ line: null });
    renderLedger({
      detail: a1Detail([
        a1Row({
          containerNumber: 'MSCU7654329',
          containerTypeId: 1,
          containerTypeLabel: '20DC',
          routeId: 6,
          routeName: 'KCN QUẾ VÕ, BẮC NINH',
          carrierType: 'OWN',
          carrierName: 'SilverSea',
          liftSiteId: null,
          liftSite: null,
          dropoffSiteId: null,
          dropoffSite: null,
          customerAppointmentAt: null,
          raw: { ...detail.containers[0].raw, containerNumber: 'MSCU7654329', containerTypeId: 1, routeId: 6, cargoWeightKg: null },
        }),
      ]),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const cellText = (label: string) => addRowEl().querySelector(`[data-label="${label}"]`)?.textContent;
    expect(cellText('Tuyến')).toBe('KCN QUẾ VÕ, BẮC NINH');
    expect(cellText('Nhà xe')).toBe('SilverSea');
    expect(cellText('Nâng')).toBe('—');
    expect(cellText('Hạ')).toBe('—');
    expect(within(addRowEl()).getByRole('button', { name: /Chưa chọn loại cont/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /^Thêm$/ }));

    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        containerNumber: 'CSQU3054383',
        containerTypeId: null,
        routeId: 6,
        carrierType: 'OWN',
        externalCarrierId: null,
      }),
      'test-key',
    ));
  });

  it('copies Tuyến across data-dependent branches: selector lookup, ad-hoc routeName, and lot summary fallback', async () => {
    addCusShipmentContainerRow.mockResolvedValue({ line: null });
    const routes = [{ id: 6, code: 'QV', name: 'KCN QUẾ VÕ, BẮC NINH', label: 'KCN QUẾ VÕ, BẮC NINH' }];

    // Branch 1: container has routeId but routeName is null -> resolves from selectors.routes
    const { unmount: unmount1 } = renderLedger({
      detail: {
        ...a1Detail([
          a1Row({
            routeId: 6,
            routeName: null,
            raw: { ...detail.containers[0].raw, routeId: 6, cargoWeightKg: null },
          }),
        ]),
        selectors: { ...detail.selectors, ports, routes },
      } as unknown as ShipmentCusWorkspaceDetail,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(addRowEl().querySelector('[data-label="Tuyến"]')?.textContent).toBe('KCN QUẾ VÕ, BẮC NINH');
    unmount1();

    // Branch 2: ad-hoc container route (routeId is null, routeName is populated)
    const { unmount: unmount2 } = renderLedger({
      detail: a1Detail([
        a1Row({
          routeId: null,
          routeName: 'KCN QUẾ VÕ, BẮC NINH',
          raw: { ...detail.containers[0].raw, routeId: null, cargoWeightKg: null },
        }),
      ]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(addRowEl().querySelector('[data-label="Tuyến"]')?.textContent).toBe('KCN QUẾ VÕ, BẮC NINH');
    unmount2();

    // Branch 3: container rows have routeId=null & routeName=null, lot summary carries routeId=6
    renderLedger({
      detail: {
        ...a1Detail([
          a1Row({
            routeId: null,
            routeName: null,
            raw: { ...detail.containers[0].raw, routeId: null, cargoWeightKg: null },
          }),
        ]),
        summary: {
          ...detail.summary,
          cargoMode: 'FCL',
          routeName: 'KCN QUẾ VÕ, BẮC NINH',
          raw: { ...detail.summary.raw, routeId: 6 },
        },
        selectors: { ...detail.selectors, ports, routes },
      } as unknown as ShipmentCusWorkspaceDetail,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(addRowEl().querySelector('[data-label="Tuyến"]')?.textContent).toBe('KCN QUẾ VÕ, BẮC NINH');
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
    fireEvent.click(within(addRowEl()).getByRole('button', { name: /^Thêm$/ }));
    await waitFor(() => expect(addCusShipmentContainerRow).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        containerNumber: 'CSQU3054383',
        routeId: 6,
      }),
      'test-key',
    ));
  });
});

// Card 191026100000 (chungtu-dieuvan A.7): the customer contract for the
// Trọng lượng column — integer kilograms never carry a ",00" tail. Intl's
// maximumFractionDigits already behaves this way; pin the drawer cell on the
// customer's exact value so a minimumFractionDigits/toFixed regression fails
// here instead of in a Zalo screenshot.
describe('drawer weight column drops the decimal tail (A.7, card 191026100000)', () => {
  it('renders cargoWeightKg "500.00" as 500, keeping a real decimal digit', () => {
    const halfTonneLot = {
      ...detail,
      containers: [{ ...detail.containers[0], raw: { ...detail.containers[0].raw, cargoWeightKg: '500.00' } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    render(
      <ToastProvider>
        <ContainerLedger detail={halfTonneLot} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="a7-weight" />
      </ToastProvider>,
    );
    const weightCell = document.querySelector('tbody [data-label="Trọng lượng"]') as HTMLElement;
    // CUS-08: the read cell renders tấn through formatWeight — "500.00" kg
    // drops its dead tail; a real tấn digit (505 kg) survives the 3-fraction
    // cap (kg precision), so no honest digit is hidden.
    expect(weightCell.textContent).toBe('0,5 tấn');

    const realDecimal = {
      ...detail,
      containers: [{ ...detail.containers[0], raw: { ...detail.containers[0].raw, cargoWeightKg: '505.00' } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    render(
      <ToastProvider>
        <ContainerLedger detail={realDecimal} onLineSaved={async () => {}} getIdempotencyKey={() => 'k'} clearIdempotencyKey={() => {}} idPrefix="a7-weight-decimal" />
      </ToastProvider>,
    );
    expect((document.querySelectorAll('tbody [data-label="Trọng lượng"]')[1] as HTMLElement).textContent).toBe('0,505 tấn');
  });
});

// FB-086 (round 21, card 171026175000): the add-container type dropdown must
// load its options. The dialog QA drove starved to its "Chưa chọn loại cont"
// placeholder because it read the config-catalog endpoint CUS cannot access;
// this surface reads the workspace selectors instead — pin that every catalog
// entry reaches the open dropdown, so a rewiring to a role-starved source (or
// an empty selectors payload) fails here instead of at QA.
describe('add-row loại-cont dropdown loads its options (FB-086, round 21)', () => {
  it('fills the add-row loại-cont dropdown from the workspace selectors', async () => {
    renderLedger({
      detail: {
        ...detail,
        summary: { ...detail.summary, cargoMode: 'FCL' },
        selectors: {
          ...detail.selectors,
          containerTypes: [
            { id: 1, code: '20DC', name: "20'DC", label: "20DC - 20'DC" },
            { id: 4, code: '40DC', name: "40'DC", label: "40DC - 40'DC" },
            { id: 5, code: '40HC', name: "40'HC", label: "40HC - 40'HC" },
          ],
        },
      } as unknown as ShipmentCusWorkspaceDetail,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    // Card 221026173728 (22/10): no seed — the trigger opens on the
    // placeholder. The options assertion below is the point of this test.
    const addRow = document.querySelector('.cus-container-ledger__add-row') as HTMLElement;
    fireEvent.click(within(addRow).getByRole('button', { name: /Chưa chọn loại cont/ }));
    const listbox = await screen.findByRole('listbox');
    const optionTexts = within(listbox).getAllByRole('option').map((option) => option.textContent);
    expect(optionTexts.length).toBeGreaterThanOrEqual(1);
    expect(optionTexts).toEqual(expect.arrayContaining(['20DC', '40DC', '40HC']));
  });
});

// FB-086 (round 19): the drawer's Thêm container must recover from the
// optimistic-version 409 instead of dead-ending — the stale detail is
// force-reloaded by the host (onDetailStale) so an immediate retry carries
// the fresh expectedShipmentVersion.
describe('add-container version-409 recovery (FB-086, round 19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onDetailStale and appends the retry hint when the add hits the version 409', async () => {
    addCusShipmentContainerRow.mockRejectedValueOnce(
      new ApiError(409, { error: 'Lô hàng vừa thay đổi. Vui lòng tải lại và thử lại.' }, 'Lô hàng vừa thay đổi. Vui lòng tải lại và thử lại.'),
    );
    const onDetailStale = vi.fn();
    render(
      <ToastProvider>
        <ContainerLedger
          detail={{ ...detail, summary: { ...detail.summary, cargoMode: 'FCL' } }}
          onLineSaved={async () => {}}
          onDetailStale={onDetailStale}
          getIdempotencyKey={() => 'k'}
          clearIdempotencyKey={() => {}}
          idPrefix="add-409"
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const numberInput = await screen.findByLabelText('Số container');
    fireEvent.change(numberInput, { target: { value: 'MSKU9991234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    await screen.findByText(/Đã tải lại dữ liệu lô — bấm Thêm lần nữa/);
    expect(onDetailStale).toHaveBeenCalledTimes(1);
    // The add row stays open so the retry keeps the typed number.
    expect(screen.getByLabelText('Số container')).toBeTruthy();
  });

  it('keeps the plain error (no recovery hint, no reload) for a non-version failure', async () => {
    addCusShipmentContainerRow.mockRejectedValueOnce(
      new ApiError(400, { error: 'Số container "MSKU9991234" đã tồn tại trong lô hàng.' }, 'Số container "MSKU9991234" đã tồn tại trong lô hàng.'),
    );
    const onDetailStale = vi.fn();
    render(
      <ToastProvider>
        <ContainerLedger
          detail={{ ...detail, summary: { ...detail.summary, cargoMode: 'FCL' } }}
          onLineSaved={async () => {}}
          onDetailStale={onDetailStale}
          getIdempotencyKey={() => 'k'}
          clearIdempotencyKey={() => {}}
          idPrefix="add-400"
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const numberInput = await screen.findByLabelText('Số container');
    fireEvent.change(numberInput, { target: { value: 'MSKU9991234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    await screen.findByText(/đã tồn tại trong lô hàng/);
    expect(screen.queryByText(/Đã tải lại dữ liệu lô/)).toBeNull();
    expect(onDetailStale).not.toHaveBeenCalled();
  });
});
