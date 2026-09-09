import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

function renderLedger() {
  const utils = render(
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={vi.fn()}
        getIdempotencyKey={() => 'test-key'}
        clearIdempotencyKey={() => {}}
        idPrefix="test"
      />
    </ToastProvider>,
  );
  return { ...utils, confirmButtons: () => utils.container.querySelectorAll('.cus-container-confirm, .cus-container-revert') };
}

describe('ContainerLedger confirm affordances', () => {
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

    // Open popover and change date
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-09-11' } });
    fireEvent.change(timeInput, { target: { value: '09:00' } });

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
