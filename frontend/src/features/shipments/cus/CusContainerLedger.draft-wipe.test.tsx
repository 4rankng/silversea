import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';

const { updateCusShipmentContainerLine } = vi.hoisted(() => ({
  updateCusShipmentContainerLine: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  updateCusShipmentContainerLine,
}));

const editablePermissions = {
  carrierEditable: true,
  plateEditable: true,
  containerTypeEditable: true,
  routeEditable: true,
  liftSiteEditable: true,
  dropoffSiteEditable: true,
  customerAppointmentEditable: true,
};

function containerLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine {
  return {
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
    permissions: editablePermissions,
    ...overrides,
  } as ShipmentCusWorkspaceContainerLine;
}

const twoLineDetail = {
  summary: { id: 1, version: 4 },
  containers: [
    containerLine(),
    containerLine({ id: 20, ordinal: 2, containerNumber: 'MSKU7654321', plateNumber: '24H-001.23' }),
  ],
  selectors: { externalCarriers: [], ports: [], containerTypes: [], routes: [], carrierVehicles: [] },
} as unknown as ShipmentCusWorkspaceDetail;

/** Mirrors the production drawer host: applySavedContainerLine merges the
 *  saved line into the detail state so the ledger's reset effect re-keying
 *  off the operational-signature join sees the refreshed rows. */
function DraftWipeHost() {
  const [detail, setDetail] = useState(twoLineDetail);
  return (
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={async (line) => setDetail((current) => ({
          ...current,
          summary: { ...current.summary, version: line.shipmentVersion },
          containers: current.containers.map((candidate) => (
            candidate.id === line.id ? line : { ...candidate, shipmentVersion: line.shipmentVersion }
          )),
        }))}
        getIdempotencyKey={() => 'draft-wipe-key'}
        clearIdempotencyKey={() => {}}
        idPrefix="wipe"
      />
    </ToastProvider>
  );
}

describe('ContainerLedger multi-row save draft preservation', () => {
  beforeEach(() => {
    updateCusShipmentContainerLine.mockReset();
  });

  it('keeps the unsaved draft on row 2 when row 1 saves first (mid-save reset must not wipe it)', async () => {
    render(<DraftWipeHost />);
    const plateA = screen.getByLabelText('Biển số xe của container MSKU1234567') as HTMLInputElement;
    const plateB = screen.getByLabelText('Biển số xe của container MSKU7654321') as HTMLInputElement;

    fireEvent.change(plateA, { target: { value: '15C-999.99' } });
    fireEvent.change(plateB, { target: { value: '24H-777.77' } });

    // Row 1 saves fine; row 2 fails so the wipe is observable as real loss.
    updateCusShipmentContainerLine
      .mockResolvedValueOnce({ line: { ...twoLineDetail.containers[0], shipmentVersion: 5, plateNumber: '15C-999.99' } })
      .mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(document.querySelector('.cus-container-confirm')!);

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1));
    const [, , firstPayload] = updateCusShipmentContainerLine.mock.calls[0];
    expect((firstPayload as { plateNumber?: string }).plateNumber).toBe('15C-999.99');

    // Let the whole loop settle: row 2's save fails, then the detail refresh
    // from row 1's success re-keys the draft-reset effect.
    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 120));

    // The failed row's unsaved draft must survive: the input keeps the typed
    // plate and the confirm bar stays so the user can retry.
    expect(document.querySelector<HTMLInputElement>('#wipe-plate-20')!.value).toBe('24H-777.77');
    expect(document.querySelector('.cus-container-confirm')).not.toBeNull();
  });

  it('save-all success keeps the post-save reset so rows render the saved values', async () => {
    render(<DraftWipeHost />);
    const plateA = screen.getByLabelText('Biển số xe của container MSKU1234567') as HTMLInputElement;
    const plateB = screen.getByLabelText('Biển số xe của container MSKU7654321') as HTMLInputElement;

    fireEvent.change(plateA, { target: { value: '15C-999.99' } });
    fireEvent.change(plateB, { target: { value: '24H-777.77' } });

    updateCusShipmentContainerLine
      .mockResolvedValueOnce({ line: { ...twoLineDetail.containers[0], shipmentVersion: 5, plateNumber: '15C-999.99' } })
      .mockResolvedValueOnce({ line: { ...twoLineDetail.containers[1], shipmentVersion: 5, plateNumber: '24H-777.77' } });

    fireEvent.click(document.querySelector('.cus-container-confirm')!);

    await waitFor(() => expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(2));
    const secondPayload = updateCusShipmentContainerLine.mock.calls[1][2] as { plateNumber?: string };
    // The save loop must still carry row 2's draft to the wire even though the
    // reset effect fires between iterations.
    expect(secondPayload.plateNumber).toBe('24H-777.77');

    await waitFor(() => {
      expect(document.querySelector<HTMLInputElement>('#wipe-plate-20')!.value).toBe('24H-777.77');
      expect(document.querySelector<HTMLInputElement>('#wipe-plate-10')!.value).toBe('15C-999.99');
    });
    // Both rows settled clean — the sticky confirm bar is gone.
    expect(document.querySelector('.cus-container-confirm')).toBeNull();
  });
});
