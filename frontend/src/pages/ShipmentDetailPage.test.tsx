import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, ShipmentStatus } from '@tingting/shared';
import type { ShipmentDetail as ShipmentDetailData } from '../api/shipmentClient';

const { getShipmentDetailMock } = vi.hoisted(() => ({
  getShipmentDetailMock: vi.fn(),
}));

vi.mock('../api/shipmentClient', () => ({
  getShipmentDetail: getShipmentDetailMock,
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 11,
      role: Role.ADMIN,
      capabilities: ['shipments.read', 'shipments.write'],
    },
  }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import ShipmentDetailPage from './ShipmentDetailPage';

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
  });

  it('shows CUS lock metadata without exposing the removed dossier action', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Khóa lô do CUS/)).toBeTruthy();
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
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('TGHU1234567')).toBeTruthy();
    expect(screen.getByText('[KẸP]')).toBeTruthy();
  });

  it('renders the state-aware carrier section for an unassigned lot', async () => {
    getShipmentDetailMock.mockResolvedValue({ ...detail, carrierAssignments: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
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
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
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
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
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
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
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
        <MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
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
});
