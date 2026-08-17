import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      <MemoryRouter initialEntries={['/shipments/1']}>
        <Routes>
          <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Khóa lô do CUS/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cập nhật & điều xe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đã khóa bởi CUS' })).toBeNull();
    expect(screen.queryByText(/Đã khóa bởi Kế toán/)).toBeNull();
    await waitFor(() => expect(getShipmentDetailMock).toHaveBeenCalledWith(1));
  });
});
