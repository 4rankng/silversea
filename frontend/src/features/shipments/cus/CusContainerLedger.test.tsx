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

// Sparse fixture on purpose: the ledger must tolerate lines whose selector
// arrays carry no options and whose optional line fields are unset. Only the
// customer appointment is edited here, so the assertions target the save
// payload and the dirty-state affordances.
const detail = {
  summary: { id: 1 },
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    dispatchStatus: 'PLANNED',
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
  // Counting by class, not accessible name: a removed Thao tác column used
  // aria-labels ("Lưu thay đổi cho container…") that exact-name role queries
  // would miss — the class covers both confirm groups in one sweep.
  return { ...utils, confirmButtons: () => utils.container.querySelectorAll('.cus-container-confirm, .cus-container-revert') };
}

describe('ContainerLedger confirm affordances', () => {
  it('renders exactly one Lưu/Hủy pair per dirty row (inline in the appointment cell)', () => {
    const view = renderLedger();
    fireEvent.change(screen.getByLabelText(/Giờ hẹn đóng hoặc trả/), { target: { value: '2026-09-11T09:00' } });

    expect(view.confirmButtons()).toHaveLength(2);
  });

  it('has no separate Thao tác column — the inline pair is the only confirm UI', () => {
    renderLedger();
    fireEvent.change(screen.getByLabelText(/Giờ hẹn đóng hoặc trả/), { target: { value: '2026-09-11T09:00' } });

    expect(screen.queryByRole('columnheader', { name: 'Thao tác dòng' })).toBeNull();
  });

  it('sends only the changed field on save — unchanged governed fields stay out of the payload', async () => {
    const view = renderLedger();
    updateCusShipmentContainerLine.mockResolvedValue({ line: { id: 10 } });
    fireEvent.change(screen.getByLabelText(/Giờ hẹn đóng hoặc trả/), { target: { value: '2026-09-11T09:00' } });
    fireEvent.click(view.container.querySelector('.cus-container-confirm')!);

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , payload] = updateCusShipmentContainerLine.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['customerAppointmentAt', 'expectedShipmentVersion']);
    expect(payload.customerAppointmentAt).toBe(new Date('2026-09-11T09:00').toISOString());
  });
});
