import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, getShipmentDetail, listOperationalSites, listSharedWarehouseSites, checkShipmentReferenceDuplicate, expenseCatalog } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  checkShipmentReferenceDuplicate: vi.fn(),
  expenseCatalog: vi.fn(),
}));

vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate }));
vi.mock('../../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { catalog: expenseCatalog } }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  getShipmentDetail,
  listOperationalSites,
  listSharedWarehouseSites,
}));
// Drawer internals are the drawer suite's own contract (ExpenseCreateDrawer
// test pins the lot-work shape) — this probe pins the MOUNT contract only.
vi.mock('../../expense-accounting/ExpenseCreateDrawer', () => ({
  ExpenseCreateDrawer: ({ work }: { work: { tripId: number | null; shipmentId: number; shipmentCode: string | null } }) => (
    <div
      data-testid="cost-drawer"
      data-trip-id={String(work.tripId)}
      data-shipment-id={String(work.shipmentId)}
      data-shipment-code={work.shipmentCode ?? ''}
    />
  ),
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** Same minimal persisted FCL lot as the SIL-481 view-mode harness. */
function lotDetail(overrides: { accountingLock?: Record<string, unknown> | null; shipment?: Record<string, unknown> } = {}) {
  return {
    accountingLock: overrides.accountingLock ?? null,
    shipment: {
      id: 9,
      shipmentCode: 'CUS-0009',
      version: 3,
      customerId: 1,
      isAdHoc: false,
      rawCustomerName: null,
      rawRouteName: null,
      factoryName: null,
      routeId: null,
      cargoTypeId: null,
      bookingRef: '',
      blNumber: 'BL-VIEW-001',
      shippingLineName: 'MAERSK',
      declarationNumber: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      isCombined: false,
      operationalSiteId: null,
      pickupWarehouseSiteId: null,
      pickupLocation: null,
      deliveryLocation: null,
      customsCutoffAt: null,
      closingAt: null,
      plannedReturnAt: null,
      expectedDeliveryDate: null,
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      operationalNotes: null,
      ...overrides.shipment,
    },
    declarations: [],
    containers: [],
    documents: [],
    statusHistory: [],
  } as unknown as ShipmentClientModule.ShipmentDetail;
}

function renderView(viewProps: { canEditLot?: boolean; canDeleteLot?: boolean; canDeclareCost?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/shipments/9']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route
              path="/shipments/:id"
              element={<ShipmentCreateWorkspace viewTarget={{ shipmentId: 9, ...viewProps }} />}
            />
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * SIL-453 (FB-098 restore, QA fail 06/11 build dcaa8295): the review page's
 * "Khai chi phí" affordance — the lot-scope entry the pre-SIL-481 detail page
 * mounted (commit d49b0920, detached by f4cd3691) — is back on the view
 * cluster: trio roles only, hidden on an accounting-locked lot (the card's
 * own law), and the drawer mounts at LOT scope (tripId null) named by the
 * lot's business key.
 */
describe('ShipmentCreateWorkspace — view-mode Khai chi phí (SIL-453)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getShipmentDetail.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    checkShipmentReferenceDuplicate.mockReset();
    expenseCatalog.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    getShipmentDetail.mockResolvedValue(lotDetail());
    expenseCatalog.mockResolvedValue({ expenseTypes: [], suppliers: [] });
  });

  it('the trio gate renders Khai chi phí; clicking mounts the lot-scope drawer with the business label', async () => {
    renderView({ canEditLot: true, canDeclareCost: true });

    expect(await screen.findByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Khai chi phí' });
    expect(expenseCatalog).not.toHaveBeenCalled();
    fireEvent.click(button);

    const drawer = await screen.findByTestId('cost-drawer');
    await waitFor(() => expect(expenseCatalog).toHaveBeenCalledTimes(1));
    // LOT scope: no trip, and the Số Bill — never the internal id — labels it.
    expect(drawer.getAttribute('data-trip-id')).toBe('null');
    expect(drawer.getAttribute('data-shipment-id')).toBe('9');
    expect(drawer.getAttribute('data-shipment-code')).toBe('CUS-0009');
  });

  it('an accounting-locked lot hides the affordance entirely (FB-098: ẩn khi khóa kế toán)', async () => {
    getShipmentDetail.mockResolvedValue(lotDetail({ accountingLock: { lockedAt: '2026-11-01T00:00:00.000Z' } }));
    renderView({ canEditLot: true, canDeclareCost: true });

    await screen.findByRole('heading', { name: 'Chi tiết lô hàng' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Sửa/ })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Khai chi phí' })).toBeNull();
    expect(expenseCatalog).not.toHaveBeenCalled();
  });

  it('a role outside the trio never sees the affordance', async () => {
    renderView({ canEditLot: true, canDeleteLot: true });

    await screen.findByRole('heading', { name: 'Chi tiết lô hàng' });
    expect(await screen.findByRole('button', { name: 'Xóa lô' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Khai chi phí' })).toBeNull();
  });

  it('a failed catalog fetch closes loudly instead of a dead drawer', async () => {
    expenseCatalog.mockRejectedValue(new Error('catalog down'));
    renderView({ canDeclareCost: true });

    await screen.findByRole('heading', { name: 'Chi tiết lô hàng' });
    fireEvent.click(await screen.findByRole('button', { name: 'Khai chi phí' }));
    expect(await screen.findByText('Không tải được danh mục khoản chi. Vui lòng thử lại.')).toBeTruthy();
    expect(screen.queryByTestId('cost-drawer')).toBeNull();
  });
});
