import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';

// Sparse fixture on purpose: the ledger must tolerate lines whose selector
// arrays carry no options and whose optional line fields are unset. Only the
// customer appointment is editable here, so the dirty-state affordances are
// what the assertions target.
const detail = {
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    dispatchStatus: 'PLANNED',
    customerAppointmentAt: '2026-08-20T02:00:00.000Z',
    permissions: {
      carrierEditable: false,
      plateEditable: false,
      containerTypeEditable: false,
      routeEditable: false,
      liftSiteEditable: false,
      dropoffSiteEditable: false,
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
  // Counting by class, not accessible name: the removed Thao tác column used
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
});
