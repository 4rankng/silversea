// SIL-1103 (K2.128) — QA repro: the "Sửa lô hàng" edit save on lot 1314 never
// sent the request once the row's NGÀY GIỜ ĐÓNG/TRẢ was cleared ("Bắt buộc:
// 8/9"). The exemption lives in the readiness rule; this pin proves the END
// of the flow: an edit save with a cleared appointment on a persisted row
// REACHES the container reconcile wire with customerAppointmentAt null (the
// BE 409 law for trip-free lots then clears it server-side).
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
} = vi.hoisted(() => ({
  quickCreateShipment: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
  saveShipmentContainers: vi.fn(),
  submitShipmentForDispatch: vi.fn(),
  createShipmentDeclaration: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', () => ({
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  getShipmentCreateReadiness,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import type { ShipmentEditSeed } from './shipment-edit-prefill';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';

let currentPath = '';
function RecordLocation() {
  currentPath = useLocation().pathname;
  return null;
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/shipments/new']}>
    <ToastProvider>
      <RecordLocation />
      {children}
    </ToastProvider>
  </MemoryRouter>
);

const fclForm: ShipmentCreateFormState = {
  ...EMPTY_SHIPMENT_CREATE_FORM,
  customerId: '7',
  tradeDirection: 'IMPORT',
  blNumber: 'BL-SIL1103',
  expectedDeliveryDate: '2026-11-28',
};

const clearedRow: ShipmentContainerDraft = {
  key: 'c-1314',
  id: 1314,
  containerNumber: 'F2K288TEST01',
  containerTypeId: '31',
  routeId: '11',
  rawRouteName: '',
  pickupPortId: '21',
  dropoffPortId: '22',
  rawPickupPortName: '',
  rawDropoffPortName: '',
  cargoWeightKg: '12000',
  cargoVolumeCbm: '',
  operationalSiteId: '41',
  rawFactoryName: '',
  customerAppointmentAt: '',
  declarationNumber: '',
};

const editSeed: ShipmentEditSeed = {
  shipmentId: 1314,
  version: 7,
  hasDispatchedLegs: false,
  fclContainers: true,
};

function renderWorkflow(form: ShipmentCreateFormState, containers: ShipmentContainerDraft[]) {
  return renderHook(
    ({ current }: { current: ShipmentCreateFormState }) => useShipmentCreateWorkflow({
      form: current,
      containers,
      sites: [],
      readiness: getShipmentCreateReadiness(current, containers),
      onValidationIssues: () => {},
      editSeed,
    }),
    { wrapper, initialProps: { current: form } },
  );
}

describe('SIL-1103 — the edit save sends the cleared schedule', () => {
  beforeEach(() => {
    quickCreateShipment.mockReset();
    updateShipment.mockReset();
    getShipmentDetail.mockReset();
    saveShipmentContainers.mockReset();
    submitShipmentForDispatch.mockReset();
    updateShipment.mockResolvedValue({ version: 8 });
    saveShipmentContainers.mockResolvedValue({ shipmentVersion: 9, items: [] });
  });

  it('a cleared appointment on a persisted row is not a validation block — the reconcile PUT rides customerAppointmentAt: null', async () => {
    const { result } = renderWorkflow(fclForm, [clearedRow]);

    let outcome: { issues: unknown[] } | undefined;
    await act(async () => { outcome = await result.current.save('DRAFT'); });

    expect(outcome?.issues ?? []).toEqual([]);
    expect(currentPath).toBe('/shipments/1314');
    expect(saveShipmentContainers).toHaveBeenCalledTimes(1);
    expect(saveShipmentContainers).toHaveBeenCalledWith(1314, expect.objectContaining({
      expectedVersion: 8,
      containers: [expect.objectContaining({ id: 1314, customerAppointmentAt: null })],
    }));
  });
});
