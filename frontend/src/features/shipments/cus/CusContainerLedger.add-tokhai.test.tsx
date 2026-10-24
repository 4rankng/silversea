// SIL-173 (FB-148): "Thêm container" trên lô có tờ khai CẤP LÔ — response có
// thể kèm declarationSync (fan-out điền mọi dòng trống, kể cả dòng cũ). FE
// phải (1) báo stale để refetch cả detail khi fan-out đụng dòng khác ngoài
// dòng mới, (2) toast nêu đúng số dòng được copy, (3) KHÔNG báo stale khi
// không có fan-out.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { ToastProvider } from '../../../components/shared/Toast';
import { ContainerLedger } from './CusContainerLedger';

const { addCusShipmentContainerRow } = vi.hoisted(() => ({
  addCusShipmentContainerRow: vi.fn(),
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  addCusShipmentContainerRow,
}));

const detail = {
  summary: { id: 1, version: 4, cargoMode: 'FCL' },
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU4120000',
    declarationNumber: 'R41B2TK01',
    dispatchStatus: 'AWAITING_VEHICLE',
    customerAppointmentAt: null,
    containerTypeId: 5,
    routeId: null,
    liftSiteId: null,
    dropoffSiteId: null,
    shipmentVersion: 4,
    raw: { containerNumber: 'MSKU4120000', containerTypeId: 5, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    permissions: {
      carrierEditable: true, plateEditable: true, containerTypeEditable: true,
      routeEditable: true, liftSiteEditable: true, dropoffSiteEditable: true,
      customerAppointmentEditable: true,
    },
  }],
  selectors: { externalCarriers: [], ports: [], containerTypes: [], routes: [], carrierVehicles: [] },
} as unknown as ShipmentCusWorkspaceDetail;

function setup() {
  const onLineSaved = vi.fn();
  const onDetailStale = vi.fn();
  render(
    <ToastProvider>
      <ContainerLedger
        detail={detail}
        onLineSaved={onLineSaved}
        onDetailStale={onDetailStale}
        getIdempotencyKey={() => 'test-key'}
        clearIdempotencyKey={() => {}}
        idPrefix="test"
      />
    </ToastProvider>,
  );
  return { onLineSaved, onDetailStale };
}

async function submitAdd() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
  fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'CSQU3054383' } });
  const addRow = document.querySelector('.cus-container-ledger__add-row') as HTMLElement;
  fireEvent.click(within(addRow).getByRole('button', { name: /^Thêm$/ }));
}

describe('SIL-173 — thêm container kéo tờ khai cấp lô (CUS-05 fan-out như SIL-166)', () => {
  it('fan-out đụng ≥1 dòng → onDetailStale + toast nêu số dòng được copy', async () => {
    const { onDetailStale } = setup();
    addCusShipmentContainerRow.mockResolvedValue({
      line: { ...detail.containers[0], id: 11, containerNumber: 'CSQU3054383' },
      declarationSync: { updatedContainerIds: [11, 250] },
    });

    await submitAdd();

    await waitFor(() => expect(onDetailStale).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(
      'Đã thêm container CSQU3054383. Tờ khai cấp lô copy sang 2 dòng còn trống.',
    )).toBeTruthy();
  });

  it('không có fan-out → KHÔNG onDetailStale, toast thường', async () => {
    const { onDetailStale } = setup();
    addCusShipmentContainerRow.mockResolvedValue({
      line: { ...detail.containers[0], id: 11, containerNumber: 'CSQU3054383' },
    });

    await submitAdd();

    await waitFor(() => expect(screen.getByText('Đã thêm container CSQU3054383.')).toBeTruthy());
    expect(onDetailStale).not.toHaveBeenCalled();
  });
});
