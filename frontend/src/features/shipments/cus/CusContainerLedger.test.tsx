import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';

const { updateCusShipmentContainerLine } = vi.hoisted(() => ({
  updateCusShipmentContainerLine: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  updateCusShipmentContainerLine,
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

function renderLedger(opts: { onAppointmentSavedAndExit?: () => void; onDirtyChange?: (dirty: boolean) => void } = {}) {
  const props = {
    detail,
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

    // Close via backdrop
    const backdrop = document.querySelector('.cus-appointment-backdrop')!;
    fireEvent.click(backdrop);
    expect(document.querySelector('.cus-appointment-popover')).toBeNull();
  });

  it('has no separate Thao tác column — in-table actions are self-contained', () => {
    renderLedger();
    expect(screen.queryByRole('columnheader', { name: 'Thao tác dòng' })).toBeNull();
  });

  it('saves appointment date and time and plate on save — sends modified fields', async () => {
    const view = renderLedger();
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10, shipmentVersion: 5 } });

    // Open popover and type the complete 24h entry into the single text input
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    setAppointment('09:00', '11/09/2026');

    // Close popover
    fireEvent.click(document.querySelector('.cus-appointment-backdrop')!);

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
        onLineSaved={async (line) => { setCurrent({ ...current, containers: [line] }); }}
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
