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
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';

/** The post-create landing is the card's contract (FB-106 (a)), so the tests
 *  observe the REAL router location, not a mocked `useNavigate`. */
let currentPath = '';
function RecordLocation() {
  currentPath = useLocation().pathname;
  return null;
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={['/shipments/new']}>
    <RecordLocation />
    {children}
  </MemoryRouter>
);

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

function renderWorkflow(form: ShipmentCreateFormState, containers: ShipmentContainerDraft[] = []) {
  return renderHook(
    ({ current }: { current: ShipmentCreateFormState }) => useShipmentCreateWorkflow({
      form: current,
      containers,
      sites: [],
      readiness: getShipmentCreateReadiness(current, containers),
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

/** FB-106 (card 171026115810): after 'Tạo lô hàng' the operator must land on
 *  the Chi tiết lô hàng of the lot just created (so CUS can verify it) —
 *  never stay on the form or drop on the queue-ranked list. The navigation
 *  hook (`use-shipment-create-workflow`) is cargo-mode generic, so both FCL
 *  and LCL are pinned. FB-080 shipped the behavior; these cases close the
 *  untested gap. */
describe('post-create navigation (FB-106 card 171026115810)', () => {
  /** Catalog FCL intake: one fully-picked container row — the exact shape the
   *  create call persists together with the root (combined save). */
  const catalogFclForm: ShipmentCreateFormState = {
    ...EMPTY_SHIPMENT_CREATE_FORM,
    customerId: '7',
    cargoMode: 'FCL',
    blNumber: 'BL-FB106-1',
    tradeDirection: 'IMPORT',
  };
  const fclContainer: ShipmentContainerDraft = {
    key: 'row-1',
    containerNumber: 'TRHU4948488',
    containerTypeId: '3',
    routeId: '9',
    rawRouteName: '',
    pickupPortId: '4',
    dropoffPortId: '5',
    rawPickupPortName: '',
    rawDropoffPortName: '',
    cargoWeightKg: '24000',
    cargoVolumeCbm: '',
    customerAppointmentAt: '2026-08-03T09:00',
    operationalSiteId: '2',
    rawFactoryName: '',
  };
  const catalogLclForm: ShipmentCreateFormState = {
    ...EMPTY_SHIPMENT_CREATE_FORM,
    customerId: '7',
    cargoMode: 'LCL',
    blNumber: 'BL-FB106-2',
    tradeDirection: 'IMPORT',
    routeId: '9',
    operationalSiteId: '2',
    pickupWarehouseSiteId: '3',
    packageType: 'Pallet',
    packageCount: '5',
    cargoWeightKg: '300',
    expectedDeliveryDate: '2026-08-03',
  };

  beforeEach(() => {
    quickCreateShipment.mockReset();
    updateShipment.mockReset();
    getShipmentDetail.mockReset();
    saveShipmentContainers.mockReset();
    submitShipmentForDispatch.mockReset();
    quickCreateShipment.mockResolvedValue({ id: 501, version: 3, initialDeclarationId: null });
    updateShipment.mockResolvedValue({ version: 4 });
    saveShipmentContainers.mockResolvedValue({ shipmentVersion: 3 });
  });

  it('FCL: lands on the detail page of the lot just created', async () => {
    const { result } = renderWorkflow(catalogFclForm, [fclContainer]);

    await act(async () => { await result.current.save('CREATE'); });

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe('/shipments/501');
  });

  it('LCL: same landing — the navigation is cargo-mode generic', async () => {
    quickCreateShipment.mockResolvedValue({ id: 602, version: 1, initialDeclarationId: null });
    const { result } = renderWorkflow(catalogLclForm);

    await act(async () => { await result.current.save('CREATE'); });

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe('/shipments/602');
  });

  it('a failed create keeps the operator on the form', async () => {
    quickCreateShipment.mockRejectedValue(new Error('Không thể tạo lô hàng. Vui lòng thử lại.'));
    const { result } = renderWorkflow(catalogFclForm, [fclContainer]);

    await act(async () => { await result.current.save('CREATE'); });

    expect(currentPath).toBe('/shipments/new');
    expect(result.current.submitError).toMatch(/Không thể tạo lô hàng/);
  });
});
