import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import { localDateTimeToIso } from '../../lib/shipment-operations';
import type {
  ShipmentChangeRequest,
  ShipmentContainer,
  ShipmentDeclaration,
  ShipmentDetail,
  ShipmentDocument,
} from '../../api/shipmentClient';

const {
  addDocumentMock,
  confirmMock,
  createDeclarationMock,
  currentUserState,
  submitForDispatchMock,
  getBootstrapMock,
  getDispatchHandoffMock,
  getDetailMock,
  listOperationalSitesMock,
  replaceDocumentMock,
  reviewChangeRequestMock,
  saveCarrierAllocationsMock,
  saveContainersMock,
  updateDeclarationMock,
  updateShipmentMock,
} = vi.hoisted(() => ({
  addDocumentMock: vi.fn(),
  confirmMock: vi.fn(),
  createDeclarationMock: vi.fn(),
  currentUserState: { role: 'CLERK', businessUnitIds: [11, 12] as number[] },
  submitForDispatchMock: vi.fn(),
  getBootstrapMock: vi.fn(),
  getDispatchHandoffMock: vi.fn(),
  getDetailMock: vi.fn(),
  listOperationalSitesMock: vi.fn(),
  replaceDocumentMock: vi.fn(),
  reviewChangeRequestMock: vi.fn(),
  saveCarrierAllocationsMock: vi.fn(),
  saveContainersMock: vi.fn(),
  updateDeclarationMock: vi.fn(),
  updateShipmentMock: vi.fn(),
}));

vi.mock('../../api/shipmentClient', () => ({
  addShipmentDocument: addDocumentMock,
  createShipmentDeclaration: createDeclarationMock,
  submitShipmentForDispatch: submitForDispatchMock,
  getShipmentDispatchHandoff: getDispatchHandoffMock,
  getShipmentDetail: getDetailMock,
  listOperationalSites: listOperationalSitesMock,
  replaceShipmentDocument: replaceDocumentMock,
  reviewShipmentChangeRequest: reviewChangeRequestMock,
  saveShipmentCarrierAllocations: saveCarrierAllocationsMock,
  saveShipmentContainers: saveContainersMock,
  updateShipment: updateShipmentMock,
  updateShipmentDeclaration: updateDeclarationMock,
}));

vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap: getBootstrapMock, getPricing: vi.fn() },
}));

vi.mock('../../components/UI', () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
  Drawer: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div className="drawer">{children}</div> : null,
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 1,
      role: currentUserState.role,
      businessUnitIds: currentUserState.businessUnitIds,
    },
  }),
}));

import ClerkShipmentDocsPage from './ClerkShipmentDocsPage';

const CONTAINER_TYPES = [
  { id: 1, code: '20DC', name: "20'DC", notes: null, createdAt: '', updatedAt: '', deletedAt: null },
];

function makeDetail(overrides: Omit<Partial<ShipmentDetail>, 'shipment'> & {
  shipment?: Partial<ShipmentDetail['shipment']>;
} = {}): ShipmentDetail {
  const detail = baseDetail();
  return {
    ...detail,
    ...overrides,
    shipment: {
      ...detail.shipment,
      ...(overrides.shipment ?? {}),
    },
    containers: overrides.containers ?? detail.containers,
    documents: overrides.documents ?? detail.documents,
    declarations: overrides.declarations ?? detail.declarations,
    statusHistory: overrides.statusHistory ?? detail.statusHistory,
    pendingChangeRequests: overrides.pendingChangeRequests ?? detail.pendingChangeRequests,
    podReviews: overrides.podReviews ?? detail.podReviews,
    carrierAssignments: overrides.carrierAssignments ?? detail.carrierAssignments,
    accountingLock: overrides.accountingLock ?? detail.accountingLock,
  };
}

function baseDetail(): ShipmentDetail {
  return {
    shipment: {
      id: 42,
      shipmentCode: 'SHP-2607-00042',
      version: 3,
      customerId: 7,
      customerName: 'Công ty ABC',
      responsibleUnitId: 11,
      status: ShipmentStatus.NEW,
      blNumber: null,
      bookingRef: null,
      expectedDeliveryDate: null,
      pickupLocation: null,
      deliveryLocation: null,
      contactName: null,
      contactPhone: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      createdBy: null,
      updatedBy: null,
      createdAt: '2026-07-27T00:00:00Z',
      updatedAt: '2026-07-27T00:00:00Z',
    },
    containers: [] as ShipmentContainer[],
    documents: [] as ShipmentDocument[],
    declarations: [] as ShipmentDeclaration[],
    statusHistory: [],
    pendingChangeRequests: [] as ShipmentChangeRequest[],
    podReviews: [],
    carrierAssignments: [],
    accountingLock: null,
  };
}

function renderAt(path = '/clerk/shipments/42/docs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clerk/shipments/:id/docs" element={<ClerkShipmentDocsPage />} />
        <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
        <Route path="/trips/:id" element={<div data-testid="trip-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setViewportWidth(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event('resize'));
}

describe('ClerkShipmentDocsPage', () => {
  beforeEach(() => {
    currentUserState.role = 'CLERK';
    currentUserState.businessUnitIds = [11, 12];
    addDocumentMock.mockReset();
    confirmMock.mockReset();
    createDeclarationMock.mockReset();
    submitForDispatchMock.mockReset();
    getBootstrapMock.mockReset();
    getDispatchHandoffMock.mockReset();
    getDetailMock.mockReset();
    listOperationalSitesMock.mockReset();
    replaceDocumentMock.mockReset();
    reviewChangeRequestMock.mockReset();
    saveCarrierAllocationsMock.mockReset();
    saveContainersMock.mockReset();
    updateDeclarationMock.mockReset();
    updateShipmentMock.mockReset();
    confirmMock.mockResolvedValue(true);
    getBootstrapMock.mockResolvedValue({
      containerTypes: CONTAINER_TYPES,
      routes: [{ id: 15, name: 'HCM - Hai Phong' }],
      cargoTypes: [{ id: 27, name: 'Hàng khô' }],
      trucks: [{ id: 31, licensePlate: '51D-123.45' }],
      drivers: [{ id: 44, name: 'Nguyen Van A' }],
      businessUnits: [
        { id: 11, code: 'CT', name: 'Phòng Chứng từ' },
        { id: 12, code: 'DH', name: 'Phòng Điều hành' },
      ],
    });
    getDetailMock.mockResolvedValue(makeDetail());
    getDispatchHandoffMock.mockResolvedValue(null);
    listOperationalSitesMock.mockResolvedValue([]);
    saveCarrierAllocationsMock.mockResolvedValue({
      shipment: { ...makeDetail().shipment, version: 4 },
      assignments: [],
    });
  });

  it('shows the readiness warning when the import Bill and containers are missing', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText(/Còn thiếu: Số Bill/)).toBeTruthy());
    expect(screen.getByText(/Thông tin công-te-nơ đầy đủ/)).toBeTruthy();
  });

  it('never presents database identifiers as shipment, customer, unit, or declaration names', async () => {
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: { shipmentCode: null, customerName: null },
      declarations: [{
        id: 88,
        shipmentId: 42,
        declarationNumber: null,
        issuedAt: null,
        scope: 'SINGLE',
        note: null,
        createdBy: 1,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }],
    }));

    renderAt();

    expect(await screen.findByRole('heading', { name: 'Hồ sơ: Chưa có mã lô hàng' })).toBeTruthy();
    expect(screen.getByText(/Khách hàng: Chưa có tên khách hàng/)).toBeTruthy();
    expect(screen.getByText('Chưa có số tờ khai')).toBeTruthy();
    const responsibleUnitSelect = screen.getByRole('combobox', { name: 'Đơn vị phụ trách' });
    expect(responsibleUnitSelect).toBeTruthy();
    expect(responsibleUnitSelect.textContent).toContain('Phòng Chứng từ');
    fireEvent.click(responsibleUnitSelect);
    expect(screen.getByRole('option', { name: 'Phòng Điều hành' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/#(?:42|7|11|12|88)\b/);
  });

  it('preserves a legacy unknown cargo mode when saving another field', async () => {
    getDetailMock.mockResolvedValue(makeDetail({ shipment: { cargoMode: null, tradeDirection: 'EXPORT' } }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      cargoMode: null,
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      changeMode: 'DIRECT',
      changeRequestId: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Số Booking')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Số Booking'), { target: { value: 'BK-LEGACY' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledTimes(1));
    const [, payload] = updateShipmentMock.mock.calls[0];
    expect(payload.bookingRef).toBe('BK-LEGACY');
    expect(payload.cargoMode).toBeNull();
    expect(payload.cargoVolumeCbm).toBeNull();
    expect(payload.packageCount).toBeNull();
    expect(payload.packageType).toBeNull();
  });

  it('persists clearing cargo mode from LCL to unknown and nulls the LCL-only payload fields', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getDetailMock
      .mockResolvedValueOnce(makeDetail({
        shipment: {
          cargoMode: 'LCL',
          cargoVolumeCbm: '7.500',
          packageCount: 2,
          packageType: 'Pallet',
        },
      }))
      .mockResolvedValueOnce(makeDetail({
        shipment: {
          cargoMode: null,
          cargoVolumeCbm: null,
          packageCount: null,
          packageType: null,
        },
      }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      cargoMode: null,
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      changeMode: 'DIRECT',
      changeRequestId: null,
    });

    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Số Bill')).toBeTruthy());
    const cargoModeField = screen.getByText('Loại lô hàng').closest('.ds-field');
    expect(cargoModeField).toBeTruthy();
    fireEvent.click(cargoModeField!.querySelector('button.ds-select-trigger') as HTMLButtonElement);
    const unknownOption = Array.from(cargoModeField!.querySelectorAll('.ds-select-popover li[role="option"]'))
      .find((option) => (option.textContent || '').includes('— Chưa xác định —'));
    expect(unknownOption).toBeTruthy();
    fireEvent.click(unknownOption as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledTimes(1));
    const [, payload] = updateShipmentMock.mock.calls[0];
    expect(payload.cargoMode).toBeNull();
    expect(payload.cargoVolumeCbm).toBeNull();
    expect(payload.packageCount).toBeNull();
    expect(payload.packageType).toBeNull();
    confirmSpy.mockRestore();
  });

  it('resends the stored bill when saving a direction-less shipment instead of wiping it', async () => {
    // Legacy row: a bill exists but tradeDirection was never classified.
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: {
        tradeDirection: null,
        blNumber: 'BILL-LEGACY-7',
        bookingRef: null,
      },
    }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      tradeDirection: null,
      blNumber: 'BILL-LEGACY-7',
      bookingRef: null,
      changeMode: 'DIRECT',
      changeRequestId: null,
    });

    renderAt();
    // Edit an unrelated field and save — the invisible legacy bill must survive.
    await waitFor(() => expect(screen.getByLabelText('Người liên hệ')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Người liên hệ'), { target: { value: 'Anh Nam' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledTimes(1));
    const [, payload] = updateShipmentMock.mock.calls[0];
    expect(payload.blNumber).toBe('BILL-LEGACY-7');
    expect(payload.bookingRef).toBeNull();
    expect(payload.contactName).toBe('Anh Nam');
  });

  it('round-trips stored operational instants without timezone drift', async () => {
    const storedInstant = '2026-07-29T03:00:00.000Z';
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: { customsCutoffAt: storedInstant },
    }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      customsCutoffAt: storedInstant,
      changeMode: 'DIRECT',
      changeRequestId: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Cut-off tờ khai')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledTimes(1));
    expect(new Date(updateShipmentMock.mock.calls[0][1].customsCutoffAt).toISOString()).toBe(storedInstant);
  });

  it('submits a complete LCL shipment to dispatch without container data', async () => {
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: {
        cargoMode: 'LCL', blNumber: 'BL-LCL', routeId: 15,
        operationalSiteId: 81, pickupWarehouseSiteId: 82,
        packageType: 'Pallet', packageCount: 3,
        cargoWeightKg: '1250', cargoVolumeCbm: '8.5',
        expectedDeliveryDate: '2026-08-10',
      },
    }));
    listOperationalSitesMock.mockResolvedValue([
      { id: 81, name: 'Nhà máy A', siteType: 'FACTORY' },
      { id: 82, name: 'Kho lấy hàng B', siteType: 'WAREHOUSE' },
    ]);
    submitForDispatchMock.mockResolvedValue({
      shipment: makeDetail().shipment,
      handoff: { id: 401, status: 'UNSEEN' },
      replayed: false,
    });
    renderAt();
    const submitButton = await screen.findByRole('button', { name: 'Gửi sang điều phối' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Công-te-nơ \(/)).toBeNull();
    fireEvent.click(submitButton);
    await waitFor(() => expect(submitForDispatchMock).toHaveBeenCalledWith(
      42,
      { expectedVersion: 3 },
      expect.any(String),
    ));
  });

  it('shows a submitted NEW shipment as awaiting dispatch and prevents duplicate handoff submission', async () => {
    getDispatchHandoffMock.mockResolvedValue({
      id: 401,
      shipmentId: 42,
      status: 'UNSEEN',
    });

    renderAt();

    expect(await screen.findByText(/Trạng thái: Sẵn sàng điều xe/)).toBeTruthy();
    expect(screen.getByText('Lô hàng đang chờ Điều vận tiếp nhận. Bạn vẫn có thể bổ sung thông tin và chứng từ trong thời gian chờ.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gửi sang điều phối' })).toBeNull();
  });

  it('allows a rejected handoff to be submitted again', async () => {
    getDispatchHandoffMock.mockResolvedValue({
      id: 401,
      shipmentId: 42,
      status: 'REJECTED',
    });

    renderAt();

    expect(await screen.findByText(/Trạng thái: Chờ chốt lịch/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gửi sang điều phối' })).toBeTruthy();
  });

  it('keeps a successful submission visible when the follow-up reload fails', async () => {
    getDetailMock
      .mockResolvedValueOnce(makeDetail({
        shipment: {
          blNumber: 'BL-FCL',
          routeId: 15,
          operationalSiteId: 81,
        },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: null,
          cargoWeightKg: null,
          shippingLineName: 'Maersk',
          pickupPortId: 1,
          dropoffPortId: 1,
          notes: null,
        }],
        carrierAssignments: [{
          fulfillmentId: 501,
          fulfillmentVersion: 1,
          shipmentContainerId: 100,
          containerTypeCode: '20DC',
          containerTypeName: "20'DC",
          carrierType: 'OWN',
          externalCarrierId: null,
          externalCarrierName: null,
        }],
      }))
      .mockRejectedValueOnce(new Error('refresh failed'));
    listOperationalSitesMock.mockResolvedValue([{ id: 81, name: 'Nhà máy A', siteType: 'FACTORY' }]);
    submitForDispatchMock.mockResolvedValue({
      shipment: { ...makeDetail().shipment, version: 4 },
      handoff: { id: 401, shipmentId: 42, status: 'UNSEEN' },
      replayed: false,
    });

    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi sang điều phối' }));

    expect(await screen.findByText(/Đã gửi lô hàng sang bảng điều phối\. Dữ liệu mới nhất/)).toBeTruthy();
    expect(screen.getByText(/Trạng thái: Sẵn sàng điều xe/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gửi sang điều phối' })).toBeNull();
  });

  it('uses the dedicated carrier-allocation endpoint while awaiting dispatch', async () => {
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: { status: ShipmentStatus.NEW },
      containers: [{
        id: 100,
        shipmentId: 42,
        containerTypeId: 1,
        containerNumber: 'MSKU1234565',
        sealNumber: null,
        cargoWeightKg: null,
        shippingLineName: 'Maersk',
        pickupPortId: 1,
        dropoffPortId: 1,
        notes: null,
      }],
    }));
    getDispatchHandoffMock.mockResolvedValue({
      id: 401,
      shipmentId: 42,
      status: 'SEEN',
    });

    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("20'"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

    await waitFor(() => expect(saveCarrierAllocationsMock).toHaveBeenCalledWith(42, {
      expectedVersion: 3,
      carrierAllocations: [{
        carrierType: 'OWN',
        externalCarrierId: null,
        carrierName: 'Đội xe nội bộ SilverSea',
        count20: 1,
        count40: 0,
      }],
    }));
    expect(saveContainersMock).not.toHaveBeenCalled();
  });

  it('sends expectedVersion for container saves and reuses the refreshed version on the next shipment save', async () => {
    getDetailMock
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(makeDetail({
        shipment: { version: 4, blNumber: null },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: null,
          cargoWeightKg: null,
          notes: null,
        }],
      }))
      .mockResolvedValue(makeDetail({
        shipment: { version: 4, blNumber: 'BL-UPDATED' },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: null,
          cargoWeightKg: null,
          notes: null,
        }],
      }));
    saveContainersMock.mockResolvedValue({
      items: [{
        id: 100,
        shipmentId: 42,
        containerTypeId: 1,
        containerNumber: 'MSKU1234565',
        sealNumber: null,
        cargoWeightKg: null,
        notes: null,
      }],
      upsertedIds: [100],
      shipmentVersion: 4,
      changeMode: 'DIRECT',
      changeRequestId: null,
      notificationDelivered: true,
      message: 'Đã lưu 1 công-te-nơ.',
    });
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      version: 5,
      blNumber: 'BL-UPDATED',
      changeMode: 'DIRECT',
      changeRequestId: null,
      notificationDelivered: true,
      message: 'Đã lưu thông tin lô hàng.',
    });

    renderAt();
    await waitFor(() => expect(screen.getByRole('button', { name: /Thêm công-te-nơ/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Thêm công-te-nơ/ }));
    const containerSection = screen.getByText(/Công-te-nơ \(/).closest('section');
    const containerSelects = containerSection?.querySelectorAll('select');
    const containerTypeSelect = containerSelects?.[0] as HTMLSelectElement | undefined;
    expect(containerTypeSelect).toBeTruthy();
    fireEvent.change(containerTypeSelect!, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Số công-te-nơ (ISO 6346)'), { target: { value: 'MSKU1234565' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu công-te-nơ/ }));

    await waitFor(() => expect(saveContainersMock).toHaveBeenCalledWith(42, expect.objectContaining({
      expectedVersion: 3,
      containers: [expect.objectContaining({ containerTypeId: 1, containerNumber: 'MSKU1234565' })],
    })));

    fireEvent.change(screen.getByLabelText('Số Bill'), { target: { value: 'BL-UPDATED' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      expectedVersion: 4,
      blNumber: 'BL-UPDATED',
    })));
  });

  it('surfaces the server request message for post-dispatch plan edits', async () => {
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: { status: ShipmentStatus.DISPATCHED, version: 8, pickupLocation: 'Kho A' },
    }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      version: 8,
      status: ShipmentStatus.DISPATCHED,
      pickupLocation: 'Kho A',
      changeMode: 'REQUESTED',
      changeRequestId: 501,
      notificationDelivered: true,
      message: 'Đã ghi nhận yêu cầu thay đổi kế hoạch và thông báo điều vận.',
    });

    renderAt();
    await waitFor(() => expect(screen.getByText(/Sau khi điều vận/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Điểm nhận'), { target: { value: 'Kho B' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu hoặc gửi yêu cầu$/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      expectedVersion: 8,
      pickupLocation: 'Kho B',
    })));
    expect(screen.getByText(/Đã ghi nhận yêu cầu thay đổi kế hoạch và thông báo điều vận/)).toBeTruthy();
  });

  it('creates a declaration and then updates an existing declaration', async () => {
    getDetailMock
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(makeDetail({
        declarations: [{
          id: 77,
          shipmentId: 42,
          declarationNumber: 'TK-001',
          issuedAt: '2026-07-27T09:00:00.000Z',
          scope: 'SHARED',
          note: 'Khai chung',
          createdBy: 1,
          createdAt: '2026-07-27T09:00:00.000Z',
          updatedAt: '2026-07-27T09:00:00.000Z',
        }],
      }))
      .mockResolvedValue(makeDetail({
        declarations: [{
          id: 77,
          shipmentId: 42,
          declarationNumber: 'TK-001A',
          issuedAt: '2026-07-27T10:00:00.000Z',
          scope: 'SINGLE',
          note: null,
          createdBy: 1,
          createdAt: '2026-07-27T09:00:00.000Z',
          updatedAt: '2026-07-27T10:00:00.000Z',
        }],
      }));
    createDeclarationMock.mockResolvedValue({
      id: 77,
      shipmentId: 42,
      declarationNumber: 'TK-001',
      issuedAt: '2026-07-27T09:00:00.000Z',
      scope: 'SHARED',
      note: 'Khai chung',
      createdBy: 1,
      createdAt: '2026-07-27T09:00:00.000Z',
      updatedAt: '2026-07-27T09:00:00.000Z',
    });
    updateDeclarationMock.mockResolvedValue({
      id: 77,
      shipmentId: 42,
      declarationNumber: 'TK-001A',
      issuedAt: '2026-07-27T10:00:00.000Z',
      scope: 'SINGLE',
      note: null,
      createdBy: 1,
      createdAt: '2026-07-27T09:00:00.000Z',
      updatedAt: '2026-07-27T10:00:00.000Z',
    });

    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Số tờ khai')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-001' } });
    fireEvent.change(screen.getByLabelText('Ngày giờ phát hành'), { target: { value: '2026-07-27T09:00' } });
    const declarationSection = screen.getByText('Tờ khai').closest('section');
    const declarationSelect = declarationSection?.querySelector('select') as HTMLSelectElement | null;
    expect(declarationSelect).toBeTruthy();
    fireEvent.change(declarationSelect!, { target: { value: 'SHARED' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm tờ khai/ }));

    await waitFor(() => expect(createDeclarationMock).toHaveBeenCalledWith(42, {
      declarationNumber: 'TK-001',
      issuedAt: localDateTimeToIso('2026-07-27T09:00'),
      scope: 'SHARED',
      note: null,
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-001A' } });
    fireEvent.change(screen.getByLabelText('Ngày giờ phát hành'), { target: { value: '2026-07-27T10:00' } });
    fireEvent.change(declarationSection?.querySelector('select') as HTMLSelectElement, { target: { value: 'SINGLE' } });
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật tờ khai/ }));

    await waitFor(() => expect(updateDeclarationMock).toHaveBeenCalledWith(42, 77, {
      declarationNumber: 'TK-001A',
      issuedAt: localDateTimeToIso('2026-07-27T10:00'),
      scope: 'SINGLE',
      note: 'Khai chung',
    }));
  });

  it('adds and replaces shipment documents', async () => {
    getDetailMock
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(makeDetail({
        documents: [{
          id: 91,
          shipmentId: 42,
          type: 'BL',
          storageKey: 'uploads/shipment-42/bl-v1.pdf',
          uploadedBy: 1,
          expiresAt: null,
          replacedBy: null,
          createdAt: '2026-07-27T09:00:00.000Z',
        }],
      }))
      .mockResolvedValue(makeDetail({
        documents: [{
          id: 92,
          shipmentId: 42,
          type: 'BL',
          storageKey: 'uploads/shipment-42/bl-v2.pdf',
          uploadedBy: 1,
          expiresAt: '2026-08-01',
          replacedBy: null,
          createdAt: '2026-07-27T10:00:00.000Z',
        }],
      }));
    addDocumentMock.mockResolvedValue({
      id: 91,
      shipmentId: 42,
      type: 'BL',
      storageKey: 'uploads/shipment-42/bl-v1.pdf',
      uploadedBy: 1,
      expiresAt: null,
      replacedBy: null,
      createdAt: '2026-07-27T09:00:00.000Z',
    });
    replaceDocumentMock.mockResolvedValue({
      id: 92,
      shipmentId: 42,
      type: 'BL',
      storageKey: 'uploads/shipment-42/bl-v2.pdf',
      uploadedBy: 1,
      expiresAt: '2026-08-01',
      replacedBy: null,
      createdAt: '2026-07-27T10:00:00.000Z',
    });

    renderAt();
    const documentSection = await screen.findByText('Tài liệu chứng từ');
    const documentTypeSelect = documentSection.closest('section')?.querySelector('select') as HTMLSelectElement | null;
    expect(documentTypeSelect).toBeTruthy();

    fireEvent.change(documentTypeSelect!, { target: { value: 'BL' } });
    fireEvent.change(screen.getByLabelText('Đường dẫn lưu trữ tài liệu'), { target: { value: 'uploads/shipment-42/bl-v1.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm tài liệu/ }));

    await waitFor(() => expect(addDocumentMock).toHaveBeenCalledWith(42, {
      type: 'BL',
      storageKey: 'uploads/shipment-42/bl-v1.pdf',
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Thay thế' }));
    fireEvent.change(screen.getByLabelText('Đường dẫn lưu trữ mới cho tài liệu BL'), {
      target: { value: 'uploads/shipment-42/bl-v2.pdf' },
    });
    fireEvent.change(screen.getByLabelText('Ngày hết hạn (nếu có)'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Thay thế tài liệu/ }));

    await waitFor(() => expect(replaceDocumentMock).toHaveBeenCalledWith(42, 91, {
      expectedVersion: 3,
      storageKey: 'uploads/shipment-42/bl-v2.pdf',
      expiresAt: '2026-08-01',
    }));
  });

  it.each([
    { viewport: 'mobile', width: 390 },
    { viewport: 'desktop', width: 1280 },
  ])('saves seal edits and delivery-order documents on the %s viewport', async ({ width }) => {
    setViewportWidth(width);
    getDetailMock
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(makeDetail({
        shipment: { version: 4 },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: 'SEAL-Q17',
          cargoWeightKg: null,
          notes: null,
        }],
      }))
      .mockResolvedValueOnce(makeDetail({
        shipment: { version: 4 },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: 'SEAL-Q17',
          cargoWeightKg: null,
          notes: null,
        }],
        documents: [{
          id: 91,
          shipmentId: 42,
          type: 'DO',
          storageKey: 'uploads/shipment-42/do-v1.pdf',
          uploadedBy: 1,
          expiresAt: null,
          replacedBy: null,
          createdAt: '2026-07-28T09:00:00.000Z',
        }],
      }))
      .mockResolvedValue(makeDetail({
        shipment: { version: 4 },
        containers: [{
          id: 100,
          shipmentId: 42,
          containerTypeId: 1,
          containerNumber: 'MSKU1234565',
          sealNumber: 'SEAL-Q17',
          cargoWeightKg: null,
          notes: null,
        }],
        documents: [{
          id: 92,
          shipmentId: 42,
          type: 'DO',
          storageKey: 'uploads/shipment-42/do-v2.pdf',
          uploadedBy: 1,
          expiresAt: '2026-08-02',
          replacedBy: null,
          createdAt: '2026-07-28T10:00:00.000Z',
        }],
      }));
    saveContainersMock.mockResolvedValue({
      items: [{
        id: 100,
        shipmentId: 42,
        containerTypeId: 1,
        containerNumber: 'MSKU1234565',
        sealNumber: 'SEAL-Q17',
        cargoWeightKg: null,
        notes: null,
      }],
      upsertedIds: [100],
      shipmentVersion: 4,
      changeMode: 'DIRECT',
      changeRequestId: null,
      notificationDelivered: true,
      message: 'Đã lưu 1 công-te-nơ.',
    });
    addDocumentMock.mockResolvedValue({
      id: 91,
      shipmentId: 42,
      type: 'DO',
      storageKey: 'uploads/shipment-42/do-v1.pdf',
      uploadedBy: 1,
      expiresAt: null,
      replacedBy: null,
      createdAt: '2026-07-28T09:00:00.000Z',
    });
    replaceDocumentMock.mockResolvedValue({
      id: 92,
      shipmentId: 42,
      type: 'DO',
      storageKey: 'uploads/shipment-42/do-v2.pdf',
      uploadedBy: 1,
      expiresAt: '2026-08-02',
      replacedBy: null,
      createdAt: '2026-07-28T10:00:00.000Z',
    });

    renderAt();
    await waitFor(() => expect(screen.getByRole('button', { name: /Thêm công-te-nơ/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Thêm công-te-nơ/ }));
    const containerSection = screen.getByText(/Công-te-nơ \(/).closest('section');
    const containerSelect = containerSection?.querySelector('select') as HTMLSelectElement | null;
    expect(containerSelect).toBeTruthy();
    fireEvent.change(containerSelect!, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Số công-te-nơ (ISO 6346)'), { target: { value: 'MSKU1234565' } });
    fireEvent.change(screen.getByLabelText('Số niêm phong'), { target: { value: 'SEAL-Q17' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu công-te-nơ/ }));

    await waitFor(() => expect(saveContainersMock).toHaveBeenCalledWith(42, expect.objectContaining({
      expectedVersion: 3,
      containers: [expect.objectContaining({
        containerTypeId: 1,
        containerNumber: 'MSKU1234565',
        sealNumber: 'SEAL-Q17',
      })],
    })));

    const documentSection = await screen.findByText('Tài liệu chứng từ');
    const documentTypeSelect = documentSection.closest('section')?.querySelector('select') as HTMLSelectElement | null;
    expect(documentTypeSelect).toBeTruthy();
    fireEvent.change(documentTypeSelect!, { target: { value: 'DO' } });
    fireEvent.change(screen.getByLabelText('Đường dẫn lưu trữ tài liệu'), { target: { value: 'uploads/shipment-42/do-v1.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm tài liệu/ }));

    await waitFor(() => expect(addDocumentMock).toHaveBeenCalledWith(42, {
      type: 'DO',
      storageKey: 'uploads/shipment-42/do-v1.pdf',
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Thay thế' }));
    fireEvent.change(screen.getByLabelText('Đường dẫn lưu trữ mới cho tài liệu DO'), {
      target: { value: 'uploads/shipment-42/do-v2.pdf' },
    });
    fireEvent.change(screen.getByLabelText('Ngày hết hạn (nếu có)'), {
      target: { value: '2026-08-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Thay thế tài liệu/ }));

    await waitFor(() => expect(replaceDocumentMock).toHaveBeenCalledWith(42, 91, {
      expectedVersion: 4,
      storageKey: 'uploads/shipment-42/do-v2.pdf',
      expiresAt: '2026-08-02',
    }));
  });

  it('lets a manager review a pending change request', async () => {
    currentUserState.role = 'MANAGER';
    getDetailMock
      .mockResolvedValueOnce(makeDetail({
        shipment: { status: ShipmentStatus.DISPATCHED, version: 8 },
        pendingChangeRequests: [{
          id: 501,
          shipmentId: 42,
          sourceVersion: 8,
          requestKind: 'PLAN_UPDATE',
          requestedBy: 7,
          beforeSnapshot: {},
          afterSnapshot: { pickupLocation: 'Kho B' },
          createdAt: '2026-07-27T10:00:00.000Z',
          requester: { id: 7, fullName: 'Nhân viên chứng từ', username: 'clerk.q17' },
        }],
      }))
      .mockResolvedValue(makeDetail({
        shipment: { status: ShipmentStatus.DISPATCHED, version: 9, pickupLocation: 'Kho B' },
        pendingChangeRequests: [],
      }));
    reviewChangeRequestMock.mockResolvedValue({
      shipment: { ...makeDetail().shipment, version: 9, pickupLocation: 'Kho B', status: ShipmentStatus.DISPATCHED },
      resolution: 'APPLIED',
      changeRequestId: 501,
      shipmentVersion: 9,
      notificationDelivered: true,
      message: 'Đã áp dụng yêu cầu thay đổi và thông báo kết quả cho người gửi.',
    });

    renderAt('/clerk/shipments/42/docs');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(reviewChangeRequestMock).toHaveBeenCalledWith(42, 501, 'APPLIED'));
    expect(screen.getByText(/Đã áp dụng yêu cầu thay đổi/)).toBeTruthy();
  });


  it('shows the load error when the shipment is missing', async () => {
    getDetailMock.mockRejectedValue(new Error('Không tìm thấy lô hàng'));
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không tìm thấy lô hàng/)).toBeTruthy());
  });
});
