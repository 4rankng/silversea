import { fireEvent, render, screen } from '@testing-library/react';
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

function makeLine(id: number, ordinal: number, appointmentAt: string | null) {
  return {
    id,
    ordinal,
    containerNumber: `MSKU000000${ordinal}`,
    dispatchStatus: 'PENDING',
    customerAppointmentAt: appointmentAt,
    containerTypeId: 5,
    routeId: 7,
    liftSiteId: 3,
    dropoffSiteId: 4,
    plateNumber: '',
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
  } as unknown as ShipmentCusWorkspaceDetail['containers'][number];
}

function renderLedger(lines: ShipmentCusWorkspaceDetail['containers']) {
  const detail = {
    summary: { id: 1, version: 4 },
    containers: lines,
    selectors: { externalCarriers: [], ports: [], containerTypes: [], routes: [], carrierVehicles: [] },
  } as unknown as ShipmentCusWorkspaceDetail;
  return render(
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={vi.fn()}
        getIdempotencyKey={() => 'test-key'}
        clearIdempotencyKey={() => {}}
        idPrefix='test'
      />
    </ToastProvider>,
  );
}

const copyButton = () => screen.queryByRole('button', { name: /Copy giờ hẹn/ });
const triggerText = (id: number) => document.getElementById(`test-customer-appointment-${id}`)?.textContent ?? '';

describe('bulk appointment copy', () => {
  beforeEach(() => {
    updateCusShipmentContainerLine.mockReset();
  });

  it('hides the copy affordance when fewer than two appointments are empty', () => {
    renderLedger([
      makeLine(10, 1, '2026-09-16T02:00:00.000Z'),
      makeLine(11, 2, '2026-09-16T03:00:00.000Z'),
    ]);
    expect(copyButton()).toBeNull();
  });

  it('copies the set datetime to empty rows only, marking them dirty for save', async () => {
    updateCusShipmentContainerLine.mockResolvedValue({ line: { shipmentVersion: 5 } });
    renderLedger([
      makeLine(10, 1, '2026-09-16T02:00:00.000Z'),
      makeLine(11, 2, null),
      makeLine(12, 3, null),
    ]);
    const sourceText = triggerText(10);
    expect(sourceText).not.toBe('');
    fireEvent.click(copyButton()!);
    expect(copyButton()).toBeNull();
    expect(triggerText(11)).toBe(sourceText);
    expect(triggerText(12)).toBe(sourceText);
    const save = screen.getByTitle('Lưu tất cả thay đổi (Enter)');
    fireEvent.click(save);
    await screen.findByText('Cập nhật dữ liệu container thành công!');
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(2);
    const payload = updateCusShipmentContainerLine.mock.calls[0][2];
    expect(typeof payload.customerAppointmentAt).toBe('string');
    expect(payload.customerAppointmentAt.length).toBeGreaterThan(0);
  });

  // User ruling 2026-09-18: the identity cell carries the icon affordance; the
  // appointment trigger cell must stay free of any overlay button.
  it('renders the copy affordance in the container identity cell, not over the appointment trigger', () => {
    renderLedger([
      makeLine(10, 1, '2026-09-16T02:00:00.000Z'),
      makeLine(11, 2, null),
      makeLine(12, 3, null),
    ]);
    const button = copyButton()!;
    expect(button.closest('th.cus-container-cell--identity')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
    expect(button.closest('td.cus-appointment-cell')).toBeNull();
  });
});
