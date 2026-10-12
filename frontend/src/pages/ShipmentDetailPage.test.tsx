import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, ShipmentStatus } from '@tingting/shared';
import type { ShipmentDetail as ShipmentDetailData } from '../api/shipmentClient';

const { getShipmentDetailMock, listShipmentEventsMock, deleteCusShipmentMock, createDeclarationMock, deleteDeclarationMock, currentUser } = vi.hoisted(() => ({
  getShipmentDetailMock: vi.fn(),
  listShipmentEventsMock: vi.fn(),
  deleteCusShipmentMock: vi.fn(),
  createDeclarationMock: vi.fn(),
  deleteDeclarationMock: vi.fn(),
  currentUser: {
    userId: 11,
    role: 'ADMIN',
    capabilities: ['shipments.read', 'shipments.write'],
  },
}));

vi.mock('../api/shipmentClient', () => ({
  getShipmentDetail: getShipmentDetailMock,
  deleteCusShipment: deleteCusShipmentMock,
  createShipmentDeclaration: createDeclarationMock,
  deleteShipmentDeclaration: deleteDeclarationMock,
}));

vi.mock('../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: { listShipmentEvents: listShipmentEventsMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: currentUser,
  }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import ShipmentDetailPage from './ShipmentDetailPage';
import { ToastProvider } from '../components/shared/Toast';

const detail: ShipmentDetailData = {
  shipment: {
    id: 1,
    shipmentCode: 'CUS-0001',
    version: 7,
    customerId: 101,
    responsibleUnitId: null,
    status: ShipmentStatus.READY_FOR_DISPATCH,
    bookingRef: 'BOOK-001',
    blNumber: 'BL-001',
    expectedDeliveryDate: '2026-08-15',
    pickupLocation: 'Cảng Hải Phòng',
    deliveryLocation: 'Kho Hà Nội',
    contactName: 'Nguyễn Văn A',
    contactPhone: '0909123456',
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    operationalSiteId: null,
    pickupWarehouseSiteId: null,
    factoryName: 'Nhà máy Hải Phòng',
    shippingLineName: 'Maersk',
    customsCutoffAt: null,
    closingAt: null,
    plannedReturnAt: null,
    cargoWeightKg: null,
    cargoVolumeCbm: null,
    packageCount: null,
    packageType: null,
    operationalNotes: 'Lô thử nghiệm',
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    pricingProjection: null,
    carrierAllocationSummary: null,
    accountingLock: null,
    customerName: 'Công ty Silver Sea',
    effectiveFactoryName: 'Nhà máy Hải Phòng',
    routeName: 'Hải Phòng – NEWEB',
  },
  containers: [],
  documents: [],
  declarations: [],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  accountingLock: {
    billingDocumentId: 44,
    billingDocumentNumber: 'DN-2026-0044',
    activatedAt: '2026-08-11T02:00:00.000Z',
    activatedByName: 'Nguyễn CUS',
    reason: 'Khóa theo nguồn CUS hiện hành',
  },
};

describe('ShipmentDetailPage', () => {
  beforeEach(() => {
    getShipmentDetailMock.mockReset();
    getShipmentDetailMock.mockResolvedValue(detail);
    listShipmentEventsMock.mockResolvedValue({ items: [] });
  });

  it('uses padded Vietnam business datetimes in details and lock metadata', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: { ...detail.shipment, createdAt: '2026-09-01T18:04:59.000Z' },
    });
    listShipmentEventsMock.mockResolvedValue({ items: [{
      id: 21, eventType: 'DOCUMENT_UPDATE', title: 'Đã cập nhật chứng từ',
      message: 'Đã nhận tờ khai', occurredAt: '2026-09-01T18:05:59.000Z', version: 1,
    }] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('01:04 02/09/2026')).toBeTruthy();
    expect(await screen.findByText('01:05 02/09/2026')).toBeTruthy();
    expect(screen.getByText(/Khóa lô do CUS/).textContent).toContain('09:00 11/08/2026');
    expect(screen.getByText('Cut-off hải quan').nextElementSibling?.textContent).toBe('—');
  });

  // Card 101026163030 (FB-069) + the format half of card 101026163040
  // (FB-074): the detail header echoed the raw numeric columns, so an LCL
  // lot's "500.00" / "2.000" leaked their storage decimals while the
  // overview showed "500 kg" / "2 CBM". Weight rides the house measure axis
  // (formatWeight) and volume the same formatQuantity the overview rows use.
  it('formats weight and volume through the house measure axis, not the raw column', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: {
        ...detail.shipment,
        cargoMode: 'LCL',
        cargoWeightKg: '500.00',
        cargoVolumeCbm: '2.000',
        packageCount: 10,
        packageType: 'thùng',
      },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    const weightCell = (await screen.findByText('Trọng lượng')).nextElementSibling;
    expect(weightCell?.textContent).toBe('500 kg');
    expect(screen.queryByText('500.00 kg')).toBeNull();

    const volumeCell = screen.getByText('Thể tích').nextElementSibling;
    expect(volumeCell?.textContent).toBe('2 CBM');
    expect(screen.queryByText('2.000 CBM')).toBeNull();
  });

  // Card 101026163040 (FB-074): the overview identity line names the lot's
  // route while the detail header had no route fact at all — for a
  // container-less LCL lot the route appeared nowhere on the detail page.
  it('names the lot route in the detail header (same fact as the overview)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    const routeCell = (await screen.findByText('Tuyến đường')).nextElementSibling;
    expect(routeCell?.textContent).toBe('Hải Phòng – NEWEB');
  });

  it('shows CUS lock metadata without exposing the removed dossier action', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Khóa lô do CUS/)).toBeTruthy();
    expect(screen.getAllByText('BL-001').length).toBeGreaterThan(0);
    expect(screen.queryByText('CUS-0001')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cập nhật & điều xe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đã khóa bởi CUS' })).toBeNull();
    expect(screen.queryByText(/Đã khóa bởi Kế toán/)).toBeNull();
    await waitFor(() => expect(getShipmentDetailMock).toHaveBeenCalledWith(1));
  });

  it('renders the [KẸP]/[KẾT HỢP] tag next to the container number (LoHangKepKetHop §3.2)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 7,
        shipmentId: 1,
        containerTypeId: null,
        containerNumber: 'TGHU1234567',
        sealNumber: null,
        cargoWeightKg: null,
        notes: null,
        pairKind: 'KEP',
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('TGHU1234567')).toBeTruthy();
    expect(screen.getByText('[KẸP]')).toBeTruthy();
  });

  it('renders the state-aware carrier section for an unassigned lot', async () => {
    getShipmentDetailMock.mockResolvedValue({ ...detail, carrierAssignments: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Nhà xe')).toBeTruthy();
    expect(screen.getByText('Chưa phân nhà xe')).toBeTruthy();
    // No "đã gán" heading on an unassigned lot (user ruling).
    expect(screen.queryByText('Nhà xe đã gán')).toBeNull();
  });

  it('keeps the assigned rendering when carrier assignments exist', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 21,
        shipmentId: 1,
        containerTypeId: 4,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        containerNumber: 'QATU0900001',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 31,
        fulfillmentVersion: 1,
        shipmentContainerId: 21,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // The heading and the containers-table column share the label.
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  it('keeps the assigned rendering for a 45ft container too (non-20/40 size)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 21,
        shipmentId: 1,
        containerTypeId: 7,
        containerTypeCode: '45HC',
        containerTypeName: "45'HC",
        containerNumber: 'MEDU4927126',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 31,
        fulfillmentVersion: 1,
        shipmentContainerId: 21,
        containerTypeCode: '45HC',
        containerTypeName: "45'HC",
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // A 45'HC has no 20/40 bucket but IS a real carrier assignment — the
    // section must not fall back to the unassigned wording (the chip simply
    // omits the size counts).
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  it('renders unassigned wording when a fulfillment exists but no carrier does (decomposed-carrier-null)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 22,
        shipmentId: 1,
        containerTypeId: 4,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        containerNumber: 'QATU0900043',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 41,
        fulfillmentVersion: 1,
        shipmentContainerId: 22,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        carrierType: null,
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // Fulfillment presence must NOT flip the section to "đã gán": the state
    // keys on carrier presence (user's reported scenario, 9e refined ruling).
    expect((await screen.findAllByText('Nhà xe')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Chưa phân nhà xe')).toBeTruthy();
    expect(screen.queryByText('Nhà xe đã gán')).toBeNull();
  });

  it('keeps the assigned rendering for an LCL fulfillment with no container row', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [],
      carrierAssignments: [{
        fulfillmentId: 51,
        fulfillmentVersion: 1,
        shipmentContainerId: null,
        containerTypeCode: null,
        containerTypeName: null,
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // An LCL assignment has no container to resolve (the backend left join
    // returns null container fields for it) — it is still a real carrier
    // assignment, so the section must not fall back to the unassigned
    // wording and the OWN fleet chip must render.
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  describe('Xóa lô affordance (card 091026225720)', () => {
    it('offers the lot-delete button to ADMIN and CUS on a deletable lot', async () => {
      currentUser.role = Role.ADMIN;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: /Xóa lô/ })).toBeTruthy();

      currentUser.role = Role.CUS;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: /Xóa lô/ })).toBeTruthy();
    });

    it('hides the lot-delete button from roles the delete route refuses (ACCOUNTANT, DISPATCHER)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Xóa lô/ })).toBeNull();

      currentUser.role = Role.DISPATCHER;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Xóa lô/ })).toBeNull();
    });

    it('blocks deletion with warning when shipment status is DISPATCHED', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: { ...detail.shipment, status: ShipmentStatus.DISPATCHED },
      });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      const deleteBtn = await screen.findByRole('button', { name: /Xóa lô/ });
      fireEvent.click(deleteBtn);
      expect(await screen.findByText(/Không thể xóa lô hàng đã có container được điều xe/)).toBeTruthy();
      expect(deleteCusShipmentMock).not.toHaveBeenCalled();
    });

    it('opens confirm modal, requires reason, and calls deleteCusShipment on confirm', async () => {
      currentUser.role = Role.ADMIN;
      deleteCusShipmentMock.mockResolvedValue(undefined);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      const deleteBtn = await screen.findByRole('button', { name: /Xóa lô/ });
      fireEvent.click(deleteBtn);

      expect(await screen.findByText(/Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu/)).toBeTruthy();
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận xóa' });
      expect(confirmBtn).toBeDisabled();

      const reasonInput = screen.getByPlaceholderText(/Nhập lý do xóa lô hàng/);
      fireEvent.change(reasonInput, { target: { value: 'Lô tạo nhầm trong đợt kiểm thử FB-031' } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(deleteCusShipmentMock).toHaveBeenCalledWith(1, 7, 'Lô tạo nhầm trong đợt kiểm thử FB-031');
      });
    });
  });

  // FB-005 (round 16): the 'Tờ khai hải quan' section on the detail page was
  // read-only only — authorized roles had no '+ Thêm tờ khai' button and no
  // per-row delete, while declaration CRUD already serves the CUS quick-edit.
  // The affordances mirror the workspace fieldAccess model for
  // declarationNumber: CUS/ADMIN/MANAGER may write, a locked lot disables.
  describe('Tờ khai hải quan affordances (FB-005)', () => {
    const unlocked = { ...detail, accountingLock: null };
    const declarationRow: ShipmentDetailData['declarations'][number] = {
      id: 9,
      shipmentId: 1,
      declarationNumber: 'TK-0055',
      issuedAt: '2026-08-10T00:00:00.000Z',
      scope: 'SINGLE',
      note: null,
      createdBy: 11,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    beforeEach(() => {
      createDeclarationMock.mockReset();
      deleteDeclarationMock.mockReset();
    });

    it('renders the add affordance for ADMIN and CUS on an unlocked lot, empty or not', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue(unlocked);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('Chưa có tờ khai nào.')).toBeTruthy();
      expect(screen.getByRole('button', { name: '+ Thêm tờ khai' })).toBeTruthy();

      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/2']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: '+ Thêm tờ khai' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeTruthy();
    });

    it('hides both affordances from roles the declaration routes refuse (ACCOUNTANT, DISPATCHER)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('TK-0055');
      expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeNull();

      currentUser.role = Role.DISPATCHER;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('TK-0055');
      expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeNull();
    });

    it('disables both affordances while the accounting lock is active', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({ ...detail, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('TK-0055')).toBeTruthy();
      expect(screen.getByRole('button', { name: '+ Thêm tờ khai' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeDisabled();
    });

    it('add flow requires a number, then creates the declaration and refetches', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue(unlocked);
      createDeclarationMock.mockResolvedValue({ ...declarationRow, declarationNumber: 'TK-0721' });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: '+ Thêm tờ khai' }));

      const confirmBtn = await screen.findByRole('button', { name: 'Thêm tờ khai' });
      expect(confirmBtn).toBeDisabled();

      const numberInput = screen.getByPlaceholderText('Nhập số tờ khai...');
      fireEvent.change(numberInput, { target: { value: ' TK-0721 ' } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(createDeclarationMock).toHaveBeenCalledWith(1, { declarationNumber: 'TK-0721' });
      });
      await waitFor(() => {
        expect(getShipmentDetailMock).toHaveBeenCalledTimes(2);
      });
    });

    it('delete flow confirms, then removes the declaration row and refetches', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      deleteDeclarationMock.mockResolvedValue(undefined);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa tờ khai TK-0055' }));

      expect(await screen.findByText(/Xóa tờ khai TK-0055 khỏi lô hàng/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }));
      await waitFor(() => {
        expect(deleteDeclarationMock).toHaveBeenCalledWith(1, 9);
      });
      await waitFor(() => {
        expect(getShipmentDetailMock).toHaveBeenCalledTimes(2);
      });
    });
  });
});
