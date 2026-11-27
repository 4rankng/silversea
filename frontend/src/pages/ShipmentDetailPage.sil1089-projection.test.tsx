// SIL-1089 (K2.24) — the DETAIL page wiring pin: the saved lot's pricing
// projection must reach FreightPreviewCard through the workspace seed, so a
// MISSING_INPUT projection renders "Chưa xác định" + the named gap and NEVER
// the computed quote — and a READY projection keeps the quote. The card and
// the prefill mapping have their own unit pins; this file pins the WIRING the
// r40b QA report was actually about (ShipmentDetailPage → workspace → card).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';
import type * as ShipmentClientModule from '../api/shipmentClient';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, checkDuplicate, freightPreviewMock, userRole } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn().mockResolvedValue([]),
  listSharedWarehouseSites: vi.fn().mockResolvedValue([]),
  checkDuplicate: vi.fn(),
  freightPreviewMock: vi.fn<(input: unknown) => unknown>(() => ({ data: undefined })),
  userRole: { current: 'ADMIN' as string | undefined },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: userRole.current == null ? null : { role: userRole.current } }),
}));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate: checkDuplicate }));
vi.mock('../hooks/usePricingQueries', () => ({
  useFreightPreview: (input: unknown) => freightPreviewMock(input),
}));
vi.mock('../features/shipments/detail/ShipmentExternalPlateSection', () => ({
  ShipmentExternalPlateSection: () => null,
}));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));
vi.mock('../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigClientModule>();
  return {
    ...actual,
    configClient: {
      ...actual.configClient,
      getVehicleSizeClasses: vi.fn().mockResolvedValue([
        { id: 18, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
      ]),
    },
  };
});

import type * as ConfigClientModule from '../api/configClient';
import { ToastProvider } from '../components/shared/Toast';
import ShipmentDetailPage from './ShipmentDetailPage';

const AUTO_QUOTE = {
  source: 'AUTO' as const, freight: 3_952_000, surcharge: 506_714, total: 4_458_714,
  billedKm: 200, liters: 64, sharePct: 100, fuelDelta: 7917.4074, formula: 'J = I × 1 + H',
};

const projectionMissingCargoType = {
  readiness: 'MISSING_INPUT' as const,
  message: 'Chọn loại hàng để xem cước LCL dự kiến.',
  missingInput: 'loại hàng',
  freightPrice: null,
  freightSource: null,
  freightFormula: null,
  expectedFuelSurcharge: null,
  expectedFuelLiters: null,
  estimationDate: null,
  breakdown: [],
};

const projectionReady = {
  readiness: 'READY' as const,
  message: 'Cước dự kiến được tính theo cấu hình hiện hành.',
  missingInput: null,
  freightPrice: 3_952_000,
  freightSource: 'TABLE' as const,
  freightFormula: '1 nhóm giá CONT20 × 3.952.000 ₫',
  expectedFuelSurcharge: 506_714,
  expectedFuelLiters: 64,
  estimationDate: '2026-11-18',
  breakdown: [],
};

/** LCL lot 1207's reported shape (W3A-LCL-03): customer + route + class +
 *  closing day exist, the cargo TYPE does not — the projection answers
 *  MISSING_INPUT 'loại hàng' while every preview ground is filled. */
function lotDetail(pricingProjection: ShipmentClientModule.ShipmentPricingProjection | null): ShipmentClientModule.ShipmentDetail {
  return {
    shipment: {
      id: 1207,
      shipmentCode: 'W3A-LCL-03',
      version: 2,
      customerId: 7,
      routeId: 11,
      responsibleUnitId: null,
      status: ShipmentStatus.READY_FOR_DISPATCH,
      bookingRef: null,
      blNumber: 'BL-R40B-1207',
      expectedDeliveryDate: '2026-11-18',
      pickupLocation: null,
      deliveryLocation: null,
      contactName: null,
      contactPhone: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'LCL',
      revVehicleClassId: 18,
      operationalSiteId: null,
      pickupWarehouseSiteId: null,
      additionalPickupWarehouses: [],
      factoryName: null,
      shippingLineName: null,
      customsCutoffAt: null,
      closingAt: '2026-11-17T18:00:00.000Z',
      plannedReturnAt: null,
      cargoWeightKg: '14000',
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      operationalNotes: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      pricingProjection,
      carrierAllocationSummary: null,
      accountingLock: null,
      customerName: 'Công ty Silver Sea',
      effectiveFactoryName: null,
      pickupWarehouseSiteName: null,
      pickupWarehouseSiteType: null,
      routeName: 'Cát Lái — Sóng Thần',
    },
    containers: [],
    documents: [],
    declarations: [],
    statusHistory: [],
    pendingChangeRequests: [],
    podReviews: [],
    carrierAssignments: [],
    hasLiveTrips: false,
    freightRate: null,
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={['/shipments/1207']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  userRole.current = 'ADMIN';
  getBootstrap.mockResolvedValue({
    customers: [{ id: 7, name: 'Công ty Silver Sea' }],
    routes: [{ id: 11, name: 'Cát Lái — Sóng Thần' }],
    ports: [],
    containerTypes: [],
    cargoTypes: [],
    externalCarriers: [],
  });
  freightPreviewMock.mockReset();
  freightPreviewMock.mockReturnValue({ data: AUTO_QUOTE });
});

afterEach(() => { cleanup(); });

describe('ShipmentDetailPage — SIL-1089 (K2.24) projection wiring into the cước block', () => {
  it('MISSING_INPUT projection → "Chưa xác định" + Thiếu loại hàng, KHÔNG con số (lô vẫn render)', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail(projectionMissingCargoType));
    renderDetailPage();
    await screen.findByText('Chưa xác định');
    expect(screen.getByText('Thiếu loại hàng')).toBeTruthy();
    expect(screen.getByText('Chọn loại hàng để xem cước LCL dự kiến.')).toBeTruthy();
    expect(screen.queryByText('Cước gốc sau chia sẻ')).toBeNull();
    expect(screen.queryByText('Tổng cước thu khách')).toBeNull();
    expect(screen.queryByText('3.952.000 ₫')).toBeNull();
  });

  it('READY projection → báo giá giữ nguyên (Cước gốc sau chia sẻ + số tiền)', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail(projectionReady));
    renderDetailPage();
    await screen.findByText('Cước gốc sau chia sẻ');
    expect(screen.getByText('3.952.000 ₫')).toBeTruthy();
    expect(screen.queryByText('Chưa xác định')).toBeNull();
  });

  it('SIL-1147 — căn cứ preview cấp lô luôn là số, không bao giờ NaN/undefined', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail(projectionReady));
    renderDetailPage();
    await screen.findByText('Cước gốc sau chia sẻ');
    await waitFor(() => expect(freightPreviewMock).toHaveBeenCalled());
    const input = freightPreviewMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | null;
    // Grounds exist on this lot, so the ask fires with REAL numbers.
    expect(input).not.toBeNull();
    expect(Number.isInteger(input?.customerId)).toBe(true);
    expect(Number.isInteger(input?.routeId)).toBe(true);
    expect(typeof input?.vehicleSizeClassCode).toBe('string');
    expect(input?.transportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
