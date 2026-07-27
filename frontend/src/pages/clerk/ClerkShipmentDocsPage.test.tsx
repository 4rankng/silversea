import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, ShipmentStatus } from '@tingting/shared';
import type {
  ShipmentChangeRequest,
  ShipmentContainer,
  ShipmentDeclaration,
  ShipmentDetail,
  ShipmentDocument,
} from '../../api/shipmentClient';

const {
  addDocumentMock,
  createDeclarationMock,
  currentUserState,
  dispatchMock,
  getBootstrapMock,
  getDetailMock,
  replaceDocumentMock,
  reviewChangeRequestMock,
  saveContainersMock,
  updateDeclarationMock,
  updateShipmentMock,
} = vi.hoisted(() => ({
  addDocumentMock: vi.fn(),
  createDeclarationMock: vi.fn(),
  currentUserState: { role: 'CLERK', businessUnitIds: [11, 12] as number[] },
  dispatchMock: vi.fn(),
  getBootstrapMock: vi.fn(),
  getDetailMock: vi.fn(),
  replaceDocumentMock: vi.fn(),
  reviewChangeRequestMock: vi.fn(),
  saveContainersMock: vi.fn(),
  updateDeclarationMock: vi.fn(),
  updateShipmentMock: vi.fn(),
}));

vi.mock('../../api/shipmentClient', () => ({
  addShipmentDocument: addDocumentMock,
  createShipmentDeclaration: createDeclarationMock,
  dispatchShipment: dispatchMock,
  getShipmentDetail: getDetailMock,
  replaceShipmentDocument: replaceDocumentMock,
  reviewShipmentChangeRequest: reviewChangeRequestMock,
  saveShipmentContainers: saveContainersMock,
  updateShipment: updateShipmentMock,
  updateShipmentDeclaration: updateDeclarationMock,
}));

vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap: getBootstrapMock },
}));

vi.mock('../../components/UI', () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 1,
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
      status: ShipmentStatus.DRAFT,
      blNumber: null,
      bookingRef: null,
      expectedDeliveryDate: null,
      pickupLocation: null,
      deliveryLocation: null,
      contactName: null,
      contactPhone: null,
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
  };
}

function renderAt(path = '/clerk/shipments/42/docs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clerk/shipments/:id/docs" element={<ClerkShipmentDocsPage />} />
        <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClerkShipmentDocsPage', () => {
  beforeEach(() => {
    currentUserState.role = 'CLERK';
    currentUserState.businessUnitIds = [11, 12];
    addDocumentMock.mockReset();
    createDeclarationMock.mockReset();
    dispatchMock.mockReset();
    getBootstrapMock.mockReset();
    getDetailMock.mockReset();
    replaceDocumentMock.mockReset();
    reviewChangeRequestMock.mockReset();
    saveContainersMock.mockReset();
    updateDeclarationMock.mockReset();
    updateShipmentMock.mockReset();
    getBootstrapMock.mockResolvedValue({ containerTypes: CONTAINER_TYPES });
    getDetailMock.mockResolvedValue(makeDetail());
  });

  it('shows the readiness warning when BL and containers are missing', async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText(/Còn thiếu: Số vận đơn/)).toBeTruthy());
    expect(screen.getByText(/Công-te-nơ \(ít nhất một\)/)).toBeTruthy();
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

    fireEvent.change(screen.getByLabelText('Số vận đơn (B/L)'), { target: { value: 'BL-UPDATED' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu hồ sơ lô hàng/ }));

    await waitFor(() => expect(updateShipmentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      expectedVersion: 4,
      blNumber: 'BL-UPDATED',
    })));
  });

  it('surfaces the server request message for post-dispatch plan edits', async () => {
    getDetailMock.mockResolvedValue(makeDetail({
      shipment: { status: ShipmentStatus.IN_PROGRESS, version: 8, pickupLocation: 'Kho A' },
    }));
    updateShipmentMock.mockResolvedValue({
      ...makeDetail().shipment,
      version: 8,
      status: ShipmentStatus.IN_PROGRESS,
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
      issuedAt: '2026-07-27T09:00',
      scope: 'SHARED',
      note: null,
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-001A' } });
    fireEvent.change(declarationSection?.querySelector('select') as HTMLSelectElement, { target: { value: 'SINGLE' } });
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật tờ khai/ }));

    await waitFor(() => expect(updateDeclarationMock).toHaveBeenCalledWith(42, 77, {
      declarationNumber: 'TK-001A',
      issuedAt: '2026-07-27T09:00',
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
    fireEvent.change(screen.getByLabelText('Storage key tài liệu'), { target: { value: 'uploads/shipment-42/bl-v1.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm tài liệu/ }));

    await waitFor(() => expect(addDocumentMock).toHaveBeenCalledWith(42, {
      type: 'BL',
      storageKey: 'uploads/shipment-42/bl-v1.pdf',
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Thay thế' }));
    fireEvent.change(screen.getByLabelText(/Storage key tài liệu mới thay cho #91/), {
      target: { value: 'uploads/shipment-42/bl-v2.pdf' },
    });
    fireEvent.change(screen.getByLabelText('Ngày hết hạn (nếu có)'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Thay thế tài liệu/ }));

    await waitFor(() => expect(replaceDocumentMock).toHaveBeenCalledWith(42, 91, {
      storageKey: 'uploads/shipment-42/bl-v2.pdf',
      expiresAt: '2026-08-01',
    }));
  });

  it('lets a manager review a pending change request', async () => {
    currentUserState.role = 'MANAGER';
    getDetailMock
      .mockResolvedValueOnce(makeDetail({
        shipment: { status: ShipmentStatus.IN_PROGRESS, version: 8 },
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
        shipment: { status: ShipmentStatus.IN_PROGRESS, version: 9, pickupLocation: 'Kho B' },
        pendingChangeRequests: [],
      }));
    reviewChangeRequestMock.mockResolvedValue({
      shipment: { ...makeDetail().shipment, version: 9, pickupLocation: 'Kho B', status: ShipmentStatus.IN_PROGRESS },
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
