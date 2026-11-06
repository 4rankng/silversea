import { act, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import { ToastProvider } from '../../../components/shared/Toast';

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

import {
  EMPTY_SHIPMENT_CREATE_FORM,
  getShipmentCreateReadiness,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import type { ShipmentEditSeed } from './shipment-edit-prefill';
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
    <ToastProvider>
      <RecordLocation />
      {children}
    </ToastProvider>
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

function renderWorkflow(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[] = [],
  editSeed?: ShipmentEditSeed,
) {
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
    declarationNumber: '',
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

  // SIL-472 (QA fail 06/11, build dcaa8295, lô 847): the BE 409 on the
  // container reconcile must be LOUD — before this pin the message only
  // reached the top-of-worksheet banner, invisible from the fixed footer,
  // so the refused delete read as a successful save. Create mode carries
  // containers on the root POST; the reconcile PUT (and its 409) is the EDIT
  // path (SIL-171 seed) — the exact surface QA drove.
  it('a refused container reconcile surfaces the 409 reason as an error toast and keeps the form', async () => {
    saveShipmentContainers.mockRejectedValue(new ApiError(
      409,
      { error: 'Cont có tờ khai R4B-TK-FCL2 — gỡ tờ khai trước khi xóa dòng container.' },
      'Cont có tờ khai R4B-TK-FCL2 — gỡ tờ khai trước khi xóa dòng container.',
    ));
    const editSeed: ShipmentEditSeed = {
      shipmentId: 847,
      version: 3,
      hasDispatchedLegs: false,
      fclContainers: true,
    };
    const { result } = renderWorkflow(catalogFclForm, [fclContainer], editSeed);

    await act(async () => { await result.current.save('CREATE'); });

    expect(currentPath).toBe('/shipments/new');
    // The root PATCH bumped the version before the reconcile fired; the pin
    // is the refusal surfacing, not the optimistic-lock bookkeeping.
    expect(saveShipmentContainers).toHaveBeenCalledWith(847, expect.anything());
    expect(result.current.submitError).toBe('Cont có tờ khai R4B-TK-FCL2 — gỡ tờ khai trước khi xóa dòng container.');
    // The in-viewport voice: the toast carries the backend refusal verbatim.
    expect(await screen.findByText('Cont có tờ khai R4B-TK-FCL2 — gỡ tờ khai trước khi xóa dòng container.')).toBeTruthy();
  });
});

/** SIL-502 (spec comment 1886): "tạo lô có tờ khai → Tổng quan vẫn hiện
 *  'Chưa có tờ khai'". Trunk repro proved the BE create→documents wire
 *  intact, so these cases pin the FE half of that wire at the client
 *  boundary: the lot-level number rides the root quick-create payload, the
 *  server-created entity (initialDeclarationId) is trusted instead of
 *  duplicated, legacy snapshots without the id are healed with one POST,
 *  and extra per-cont slots ride separate entity POSTs. */
describe('declaration wire — per-cont only (SIL-521)', () => {
  beforeEach(() => {
    quickCreateShipment.mockReset();
    updateShipment.mockReset();
    getShipmentDetail.mockReset();
    saveShipmentContainers.mockReset();
    submitShipmentForDispatch.mockReset();
    quickCreateShipment.mockResolvedValue({ id: 501, version: 3 });
    updateShipment.mockResolvedValue({ version: 4 });
  });

  it('create payload không mang declarationNumber CẤP LÔ (per-cont rides containers[] — SIL-701)', async () => {
    const { result } = renderWorkflow({ ...adHocLclForm });

    await act(async () => { await result.current.save('DRAFT'); });

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    const body = quickCreateShipment.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('declarationNumber');
    expect(body).not.toHaveProperty('declarationNumbers');
  });
});

/** SIL-660 (owner ruling 02/11): máy declaration HẸP cho hàng lẻ — giá trị
 *  ô "Số tờ khai" cấp lô persist vào entity shipment_declarations qua
 *  POST/PUT /shipments/:id/declarations, tách khỏi root payload (SIL-521
 *  giữ nguyên). FCL không bao giờ đụng hai API này. */
describe('SIL-660 — LCL declaration entity reconcile', () => {
  const lclDeclarationForm: ShipmentCreateFormState = {
    ...adHocLclForm,
    declarationNumber: '  TK-660-01  ',
  };
  const declarationRow = (id: number, declarationNumber: string | null) => ({
    id,
    shipmentId: 501,
    declarationNumber,
    issuedAt: null,
    scope: 'SINGLE',
    note: null,
    createdBy: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  });

  beforeEach(() => {
    quickCreateShipment.mockReset();
    updateShipment.mockReset();
    getShipmentDetail.mockReset();
    saveShipmentContainers.mockReset();
    submitShipmentForDispatch.mockReset();
    createShipmentDeclaration.mockReset();
    updateShipmentDeclaration.mockReset();
    quickCreateShipment.mockResolvedValue({ id: 501, version: 3 });
    updateShipment.mockResolvedValue({ version: 4 });
    createShipmentDeclaration.mockResolvedValue(declarationRow(900, 'TK-660-01'));
    updateShipmentDeclaration.mockResolvedValue(declarationRow(900, null));
  });

  it('LCL create: số tờ khai lên POST /declarations (trim), root payload không mang key cấp lô', async () => {
    const { result } = renderWorkflow(lclDeclarationForm);

    await act(async () => { await result.current.save('DRAFT'); });

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    expect(createShipmentDeclaration).toHaveBeenCalledTimes(1);
    expect(createShipmentDeclaration.mock.calls[0][0]).toBe(501);
    expect(createShipmentDeclaration.mock.calls[0][1]).toEqual({ declarationNumber: 'TK-660-01' });
    const body = quickCreateShipment.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('declarationNumber');
    expect(body).not.toHaveProperty('declarationNumbers');
  });

  it('LCL create để trống tờ khai: không gọi API declarations', async () => {
    const { result } = renderWorkflow({ ...adHocLclForm, declarationNumber: '' });

    await act(async () => { await result.current.save('DRAFT'); });

    expect(createShipmentDeclaration).not.toHaveBeenCalled();
    expect(updateShipmentDeclaration).not.toHaveBeenCalled();
  });

  it('lưu lại không đổi số → không phát hành thêm write declarations', async () => {
    const { result } = renderWorkflow(lclDeclarationForm);

    await act(async () => { await result.current.save('DRAFT'); });
    await act(async () => { await result.current.save('DRAFT'); });

    expect(createShipmentDeclaration).toHaveBeenCalledTimes(1);
  });

  it('số thay đổi giữa hai lần lưu → POST lần đầu, PUT lần sau (rowId ghi nhận từ kết quả POST)', async () => {
    updateShipmentDeclaration.mockResolvedValue(declarationRow(900, 'TK-660-02'));
    const { result, rerender } = renderWorkflow(lclDeclarationForm);

    await act(async () => { await result.current.save('DRAFT'); });
    rerender({ current: { ...lclDeclarationForm, declarationNumber: 'TK-660-02' } });
    await act(async () => { await result.current.save('DRAFT'); });

    expect(createShipmentDeclaration).toHaveBeenCalledTimes(1);
    expect(updateShipmentDeclaration).toHaveBeenCalledTimes(1);
    expect(updateShipmentDeclaration.mock.calls[0]).toEqual([
      501,
      900,
      { declarationNumber: 'TK-660-02' },
    ]);
  });

  it('edit seed có row: số mới → PUT theo rowId, KHÔNG POST thêm row', async () => {
    const seed: ShipmentEditSeed = {
      shipmentId: 501,
      version: 3,
      hasDispatchedLegs: false,
      fclContainers: false,
      declaration: { rowId: 66, declarationNumber: 'TK-OLD' },
    };
    updateShipmentDeclaration.mockResolvedValue(declarationRow(66, 'TK-NEW'));
    const { result } = renderWorkflow(
      { ...adHocLclForm, declarationNumber: 'TK-NEW' },
      [],
      seed,
    );

    await act(async () => { await result.current.save('DRAFT'); });

    expect(updateShipmentDeclaration).toHaveBeenCalledTimes(1);
    expect(updateShipmentDeclaration.mock.calls[0]).toEqual([
      501,
      66,
      { declarationNumber: 'TK-NEW' },
    ]);
    expect(createShipmentDeclaration).not.toHaveBeenCalled();
  });

  it('edit seed có row: xoá trắng số → PUT declarationNumber null (clear, không xoá row)', async () => {
    const seed: ShipmentEditSeed = {
      shipmentId: 501,
      version: 3,
      hasDispatchedLegs: false,
      fclContainers: false,
      declaration: { rowId: 66, declarationNumber: 'TK-OLD' },
    };
    const { result } = renderWorkflow(
      { ...adHocLclForm, declarationNumber: '' },
      [],
      seed,
    );

    await act(async () => { await result.current.save('DRAFT'); });

    expect(updateShipmentDeclaration).toHaveBeenCalledTimes(1);
    expect(updateShipmentDeclaration.mock.calls[0]).toEqual([
      501,
      66,
      { declarationNumber: null },
    ]);
    expect(createShipmentDeclaration).not.toHaveBeenCalled();
  });

  it('edit seed có row: giữ nguyên số → không gọi API declarations nào', async () => {
    const seed: ShipmentEditSeed = {
      shipmentId: 501,
      version: 3,
      hasDispatchedLegs: false,
      fclContainers: false,
      declaration: { rowId: 66, declarationNumber: 'TK-OLD' },
    };
    const { result } = renderWorkflow(
      { ...adHocLclForm, declarationNumber: 'TK-OLD' },
      [],
      seed,
    );

    await act(async () => { await result.current.save('DRAFT'); });

    expect(createShipmentDeclaration).not.toHaveBeenCalled();
    expect(updateShipmentDeclaration).not.toHaveBeenCalled();
  });

  it('FCL: per-cont có số cũng không đụng entity declarations', async () => {
    const fclRow: ShipmentContainerDraft = {
      key: 'row-1',
      containerNumber: 'TRHU4948488',
      containerTypeId: '3',
      declarationNumber: 'TK-PER-CONT',
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
    const fclForm: ShipmentCreateFormState = {
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '7',
      cargoMode: 'FCL',
      blNumber: 'BL-660-FCL',
      tradeDirection: 'IMPORT',
    };
    saveShipmentContainers.mockResolvedValue({ shipmentVersion: 3 });
    const { result } = renderWorkflow(fclForm, [fclRow]);

    await act(async () => { await result.current.save('DRAFT'); });

    expect(createShipmentDeclaration).not.toHaveBeenCalled();
    expect(updateShipmentDeclaration).not.toHaveBeenCalled();
  });
});
