import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
  deleteShipmentDeclaration,
} = vi.hoisted(() => ({
  quickCreateShipment: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
  saveShipmentContainers: vi.fn(),
  submitShipmentForDispatch: vi.fn(),
  createShipmentDeclaration: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
  deleteShipmentDeclaration: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', () => ({
  quickCreateShipment,
  updateShipment,
  getShipmentDetail,
  saveShipmentContainers,
  submitShipmentForDispatch,
  createShipmentDeclaration,
  updateShipmentDeclaration,
  deleteShipmentDeclaration,
}));

import {
  EMPTY_SHIPMENT_CREATE_FORM,
  getShipmentCreateReadiness,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

/** Lệnh chạy ngoài (ad-hoc) LCL draft: `customerId` is null by design, which
 *  is exactly the payload the UPDATE contract cannot accept. */
const adHocLclForm: ShipmentCreateFormState = {
  ...EMPTY_SHIPMENT_CREATE_FORM,
  isAdHoc: true,
  rawCustomerName: 'Khách chạy ngoài',
  rawRouteName: 'Tuyến riêng',
  cargoMode: 'LCL',
  blNumber: 'BL-WF-1',
  tradeDirection: 'IMPORT',
  packageType: 'Pallet',
  packageCount: '5',
  cargoWeightKg: '300',
  expectedDeliveryDate: '2026-08-03',
};

function renderWorkflow(form: ShipmentCreateFormState) {
  return renderHook(
    ({ current }: { current: ShipmentCreateFormState }) => useShipmentCreateWorkflow({
      form: current,
      containers: [],
      sites: [],
      readiness: getShipmentCreateReadiness(current, []),
      onValidationIssues: () => {},
    }),
    { wrapper, initialProps: { current: form } },
  );
}

describe('shipment create workflow — root reconcile', () => {
  beforeEach(() => {
    quickCreateShipment.mockReset();
    updateShipment.mockReset();
    getShipmentDetail.mockReset();
    saveShipmentContainers.mockReset();
    submitShipmentForDispatch.mockReset();
    quickCreateShipment.mockResolvedValue({ id: 501, version: 3, initialDeclarationId: null });
    updateShipment.mockResolvedValue({ version: 4 });
  });

  it('does not replay the root payload as an UPDATE after a successful create', async () => {
    const { result } = renderWorkflow(adHocLclForm);

    await act(async () => { await result.current.save('DRAFT'); });

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    // The create persisted every root field, so a follow-up PUT would resend
    // identical values — and for an ad-hoc lot it is rejected outright
    // (updateShipment requires a positive customerId, null is only valid on
    // create), which used to end every ad-hoc save in an error banner.
    expect(updateShipment).not.toHaveBeenCalled();
    expect(saveShipmentContainers).not.toHaveBeenCalled();
    expect(submitShipmentForDispatch).not.toHaveBeenCalled();
  });

  it('still updates the root on a retry whose payload changed', async () => {
    // A failed LATER step (submit) keeps the attempt alive, so the next save
    // reconciles the changed root with an UPDATE instead of creating again.
    submitShipmentForDispatch
      .mockRejectedValueOnce(new Error('Điều phối tạm lỗi'))
      .mockResolvedValue({ shipmentVersion: 5 });
    const { result, rerender } = renderWorkflow(adHocLclForm);

    await act(async () => { await result.current.save('SUBMIT'); });
    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    expect(updateShipment).not.toHaveBeenCalled();

    rerender({ current: { ...adHocLclForm, blNumber: 'BL-WF-2' } });
    await act(async () => { await result.current.save('SUBMIT'); });

    expect(updateShipment).toHaveBeenCalledTimes(1);
    expect(updateShipment.mock.calls[0][1]).toMatchObject({ blNumber: 'BL-WF-2' });
  });
});
