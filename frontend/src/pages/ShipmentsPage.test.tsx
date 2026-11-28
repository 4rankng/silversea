import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  Role,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentStatus,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

const { apiGet, apiPost, apiPut, authState, downloadCSV } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  authState: { user: { role: 'CUS' } },
  downloadCSV: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: apiPut },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../lib/csv', () => ({ downloadCSV }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));

import ShipmentsPage from './ShipmentsPage';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
const uiSource = readFileSync(resolve(process.cwd(), 'src/components/UI.tsx'), 'utf8');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const recordCss = css.slice(css.indexOf('@media (max-width: 999px)'), css.indexOf('@media (max-width: 620px)'));
// Row markup + bucket colors moved into the feature leaves in the 2026-09-01
// structural split; these guard assertions follow the markup, not the page file.
const rowSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');
const cusUtilsSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/cusUtils.ts'), 'utf8');
const defaultResizeObserver = window.ResizeObserver;
const directAccess = { mode: 'DIRECT' as const, reason: 'Có thể sửa.' };

const row: ShipmentCusWorkspaceListItem = {
  id: 1,
  version: 3,
  status: ShipmentStatus.READY_FOR_DISPATCH,
  cargoMode: 'FCL',
  bucket: ShipmentCusBucket.PENDING_LOCK,
  bucketLabel: 'Chờ khóa',
  customerName: 'Công ty Silver Sea',
  // Ticket 18/11 Task 1.2 — creator rides the wire; fixture owns none.
  creatorName: null,
  creatorCode: null,
  factoryName: 'Nhà máy Hải Phòng',
  billOrBookNumber: 'BILL-12345',
  declarationNumber: 'TK-54321',
  shippingLineName: 'Maersk',
  routeName: 'Hải Phòng → Hà Nội',
  isCombined: false,
  direction: 'IMPORT' as const,
  containerSummary: '2x40HC',
  packageCount: null,
  packageType: null,
  weightKg: '25000',
  volumeCbm: '52.5',
  transportDate: '2026-08-12',
  customsCutoffAt: '2026-08-11T08:00:00.000Z',
  closingAt: null,
  plannedReturnAt: '2026-08-12T10:00:00.000Z',
  deliveryLocation: 'Kho Long Biên',
  liftSiteNames: ['Cảng Đình Vũ'],
  dropoffSiteNames: ['Bãi Tân Vũ'],
  customerAppointmentAts: ['2026-08-12T02:30:00.000Z'],
  effectiveFactoryNames: ['Nhà máy ABC'],
  appointmentGroups: [
    { at: '2026-08-12T02:30:00.000Z', localDate: '2026-08-12', factoryName: 'Nhà máy ABC', factoryShortName: 'Nhà máy ABC', factoryFullName: 'Nhà máy ABC', containerSummary: '1x40HC' },
    { at: '2026-08-12T09:30:00.000Z', localDate: '2026-08-12', factoryName: 'Nhà máy ABC', factoryShortName: 'Nhà máy ABC', factoryFullName: 'Nhà máy ABC', containerSummary: '1x20GP' },
  ],
  carrierAssignments: [{ carrierName: 'Nhà xe An Phát', plateNumber: '15C-123.45' }],
  customerNotes: 'Giao buổi sáng',
  operationalNotes: 'Ưu tiên cổng số 2',
  raw: {
    customerId: 7, isAdHoc: false, factoryName: 'Nhà máy Hải Phòng', routeId: 3, deliveryLocation: 'Kho Long Biên',
    blNumber: 'BILL-12345', bookingRef: null, declarationNumber: 'TK-54321', tradeDirection: 'IMPORT', shippingLineName: 'Maersk',
    packageCount: null, packageType: null, cargoWeightKg: '25000', cargoVolumeCbm: '52.5', customsCutoffAt: '2026-08-11T08:00:00.000Z',
    closingAt: null, plannedReturnAt: '2026-08-12T10:00:00.000Z', customerNotes: 'Giao buổi sáng', operationalNotes: 'Ưu tiên cổng số 2',
    declarationId: 9, declarationIssuedAt: null, declarationScope: 'SINGLE', declarationNote: null,
    declarations: [{ id: 9, declarationNumber: 'TK-54321', issuedAt: null, scope: 'SINGLE', note: null }],
  },
  fieldAccess: {
    customerId: directAccess, factoryName: directAccess, routeId: directAccess, deliveryLocation: directAccess,
    blNumber: directAccess, bookingRef: directAccess, declarationNumber: directAccess, tradeDirection: directAccess, shippingLineName: directAccess,
    packageCount: directAccess, packageType: directAccess, cargoWeightKg: directAccess, cargoVolumeCbm: directAccess,
    customsCutoffAt: directAccess, closingAt: directAccess, plannedReturnAt: directAccess, customerNotes: directAccess, operationalNotes: directAccess,
  },
  operational: {
    scheduleReadiness: 'SCHEDULED',
    vehicleReadiness: 'READY',
    totalContainers: 2,
    assignedContainers: 2,
    externalContainers: 1,
    plateAssignedContainers: 2,
    orderIssuedContainers: 0,
    missingCarrierContainers: 0,
    missingPlateContainers: 0,
    transportDateEditable: true,
    deletable: true,
  },
  finance: {
    customerInvoiceTotal: '12000000',
    customerNoInvoiceTotal: '1500000',
    totalCost: '14000000',
    isLoss: true,
    hasPendingRecovery: true,
    customerChargeTotalsAvailable: true,
    totalCostAvailable: true,
  },
  debitNote: {
    available: true,
    billingDocumentId: 44,
    documentNumber: 'DN-2026-0044',
    issuedAt: '2026-08-12T01:00:00.000Z',
    debitNoteStatus: 'ISSUED',
    disabledReason: null,
  },
  documentCustody: {
    status: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING,
    label: 'Đã nộp Kế toán',
    available: true,
    editable: true,
  },
  accountingConfirmation: {
    status: 'CONFIRMED' as const,
    billingDocumentId: 44,
    confirmationId: 71,
    checksum: 'checksum-71',
    confirmedAt: '2026-08-12T01:30:00.000Z',
    confirmedByName: 'Kế toán',
  },
  activeLock: null,
  costLocked: false,
  action: {
    kind: 'LOCK' as const,
    label: 'Khóa lô',
    enabled: true,
    disabledReason: null,
  },
};

const detail = {
  summary: row,
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    operationalSiteId: 31,
    containerTypeId: 2,
    containerTypeLabel: '40HC',
    routeId: 7,
    routeName: 'Đình Vũ — KCN VSIP',
    dispatchStatus: 'CREATED' as const,
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: 8,
    externalCarrierVehicleId: 18,
    carrierName: 'Nhà xe An Phát',
    plateNumber: '15C-123.45',
    liftSiteId: 31,
    liftSite: 'Cảng Đình Vũ',
    factoryName: 'Cảng Đình Vũ',
    dropoffSiteId: 32,
    dropoffSite: 'Bãi Tân Vũ',
    customerAppointmentAt: '2026-08-12T02:30:00.000Z',
    raw: { containerNumber: 'MSKU1234567', containerTypeId: 2, cargoWeightKg: '12500', cargoVolumeCbm: '26.25' },
    fieldAccess: {
      containerNumber: directAccess, containerTypeId: directAccess, cargoWeightKg: directAccess, cargoVolumeCbm: directAccess,
      carrierType: directAccess, externalCarrierId: directAccess, externalCarrierVehicleId: directAccess, plateNumber: directAccess,
      liftSiteId: directAccess, dropoffSiteId: directAccess, customerAppointmentAt: directAccess,
    },
    permissions: {
      carrierEditable: true,
      plateEditable: true,
      containerTypeEditable: true,
      routeEditable: true,
      liftSiteEditable: true,
      dropoffSiteEditable: true,
      customerAppointmentEditable: true,
    },
    shipmentVersion: 3,
    relatedTripVersion: 2,
  }],
  selectors: {
    containerTypes: [{ id: 2, code: '40HC', name: 'Container 40HC', label: '40HC · Container 40HC' }],
    routes: [
      { id: 7, name: 'Đình Vũ — KCN VSIP', label: 'Đình Vũ — KCN VSIP' },
      { id: 9, name: 'Đình Vũ — Quốc lộ 5', label: 'Đình Vũ — Quốc lộ 5' },
    ],
    operationalSites: [
      { id: 31, siteType: 'WAREHOUSE' as const, code: 'DV', name: 'Cảng Đình Vũ', label: 'DV · Cảng Đình Vũ' },
      { id: 32, siteType: 'WAREHOUSE' as const, code: 'TV', name: 'Bãi Tân Vũ', label: 'TV · Bãi Tân Vũ' },
    ],
    externalCarriers: [{ id: 8, name: 'Nhà xe An Phát', shortName: 'An Phát', label: 'Nhà xe An Phát' }],
    carrierVehicles: [{ id: 18, carrierId: 8, licensePlate: '15C-123.45', label: '15C-123.45' }],
    ports: [
      { id: 51, code: 'DV', name: 'Cảng Đình Vũ', label: 'Cảng Đình Vũ' },
      { id: 52, code: 'TV', name: 'Bãi Tân Vũ', label: 'Bãi Tân Vũ' },
    ],
  },
  dataState: {
    hasExplicitDocumentCustody: true,
    hasExplicitRecoveryFacts: true,
    hasAuthoritativeChargeBreakdown: true,
  },
};

// Card 20260922_41 dialog fixtures: line 10 is attached to a live dispatch
// trip (delete blocked — the 409 guard's client-side presentation), line 13
// is free (deletable), line 14 carries a CANCELED trip (delete must stay
// enabled — an over-block has no in-UI recovery).
const manageDetail = {
  ...detail,
  containers: [
    { ...detail.containers[0], tripId: 5, tripStatus: 'CREATED', dispatchStatus: 'CREATED' },
    {
      ...detail.containers[0],
      id: 13,
      ordinal: 2,
      containerNumber: 'MSKU7654321',
      containerTypeId: 3,
      containerTypeLabel: '20DC',
      dispatchStatus: 'AWAITING_VEHICLE',
      tripId: null,
      tripStatus: null,
      customerAppointmentAt: null,
      raw: { containerNumber: 'MSKU7654321', containerTypeId: 3, cargoWeightKg: '3000.00', cargoVolumeCbm: null },
    },
    {
      ...detail.containers[0],
      id: 14,
      ordinal: 3,
      containerNumber: 'MSKU2222333',
      dispatchStatus: 'AWAITING_VEHICLE',
      tripId: 7,
      tripStatus: 'CANCELED',
      customerAppointmentAt: null,
      raw: { containerNumber: 'MSKU2222333', containerTypeId: 2, cargoWeightKg: null, cargoVolumeCbm: null },
    },
  ],
  selectors: {
    ...detail.selectors,
    containerTypes: [
      { id: 2, code: '40HC', name: 'Container 40HC', label: '40HC · Container 40HC' },
      { id: 3, code: '20DC', name: 'Container 20DC', label: '20DC · Container 20DC' },
    ],
  },
};

function listResponse(items = [row]) {
  return {
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    // Card 081026093520: FULL-set tab counts (same filtered set as `total`,
    // status lens excluded). Tests that pin count semantics override these.
    statusCounts: {
      needsSchedule: items.filter((item) => item.operational.scheduleReadiness === 'WAITING_DATE').length,
      needsVehicle: items.filter((item) => ['WAITING_CARRIER', 'WAITING_PLATE'].includes(item.operational.vehicleReadiness)).length,
      waitingAccounting: items.filter((item) => (
        item.activeLock == null
        && (item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE')
      )).length,
    },
    items,
  };
}

function renderPage(path = '/shipments') {
  // Fresh client per render — retry:false mirrors the app-wide default in
  // main.tsx; everything else stays per-query (30s poll etc. never fires
  // inside a test's wall-clock).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/shipments" element={<ShipmentsPage />} />
            <Route path="/shipments/new" element={<div data-testid="shipment-create-page">Tạo lô hàng mới</div>} />
            <Route path="/shipments/:id/edit" element={<div data-testid="shipment-edit-page">Sửa lô hàng</div>} />
            <Route path="/shipments-detail" element={<div data-testid="container-detail-page">Chi tiết container</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function masterRow(): HTMLTableRowElement {
  const element = document.querySelector('tr.cus-dashboard-row');
  if (!(element instanceof HTMLTableRowElement)) throw new Error('shipment master row not rendered');
  return element;
}

/** Card 20260928_193: the row the auto-hide rule is measured against — a lot
 *  with no note on either channel, at both the payload and the raw shape. */
function noteLessRow() {
  return {
    ...row,
    customerNotes: null,
    operationalNotes: null,
    raw: { ...row.raw, customerNotes: null, operationalNotes: null },
  };
}

function masterRowDetailButton(): HTMLButtonElement {
  const element = document.querySelector('button.cus-dashboard-detail');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment detail button not rendered');
  return element;
}

/** SIL-1150 (KB §3.1.7): the drawer hosts the SHARED lot form
 *  (ShipmentCreateWorkspace), whose own reads ride every drawer-opening
 *  test's routing alongside the workspace detail — the catalog bootstrap,
 *  the /shipments/:id edit prefill and the site / duplicate-check probes. */
const bootstrapCatalog = {
  customers: [{ id: 7, name: 'Công ty Silver Sea' }],
  routes: [{ id: 11, name: 'Cát Lái — Sóng Thần' }],
  ports: [{ id: 21, name: 'Cảng Cát Lái' }, { id: 22, name: 'Cảng ICD Sóng Thần' }],
  containerTypes: [{ id: 2, code: '40HC', name: 'Container 40HC' }],
  cargoTypes: [{ id: 32, code: 'LCL', name: 'Hàng lẻ' }],
  externalCarriers: [],
  shippingLines: [{ name: 'Maersk' }],
};

/** The SHIPMENTS wire (GET /shipments/:id) the shared form prefills from —
 *  lot 1 mirrors the list row fixture (FCL IMPORT, one container
 *  MSKU1234567); the shape is the one ClerkShipmentEditPage.test.tsx proves
 *  the edit form accepts and saves. */
function editShipmentDetail(id = 1) {
  return {
    shipment: {
      id,
      shipmentCode: 'BILL-12345',
      version: 3,
      customerId: 7,
      routeId: null,
      responsibleUnitId: null,
      status: ShipmentStatus.READY_FOR_DISPATCH,
      bookingRef: null,
      blNumber: 'BILL-12345',
      expectedDeliveryDate: null,
      pickupLocation: null,
      deliveryLocation: null,
      contactName: null,
      contactPhone: null,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      operationalSiteId: null,
      pickupWarehouseSiteId: null,
      additionalPickupWarehouses: [],
      factoryName: null,
      shippingLineName: 'Maersk',
      customsCutoffAt: null,
      closingAt: null,
      plannedReturnAt: null,
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      packageCount: null,
      packageType: null,
      operationalNotes: 'Ưu tiên cổng số 2',
      customerNotes: 'Giao buổi sáng',
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      pricingProjection: null,
      carrierAllocationSummary: null,
      customerName: 'Công ty Silver Sea',
      effectiveFactoryName: null,
      pickupWarehouseSiteName: null,
      pickupWarehouseSiteType: null,
      routeName: null,
    },
    containers: [{
      id: 10,
      shipmentId: id,
      containerTypeId: 2,
      containerNumber: 'MSKU1234567',
      sealNumber: null,
      cargoWeightKg: '12500',
      customerAppointmentAt: '2026-08-12T02:30:00.000Z',
      pickupPortId: 21,
      dropoffPortId: 22,
      routeId: 11,
      operationalSiteId: 41,
      notes: null,
    }],
    documents: [],
    declarations: [],
    statusHistory: [],
    pendingChangeRequests: [],
    podReviews: [],
    carrierAssignments: [],
    hasLiveTrips: false,
    accountingLock: null,
    costLock: false,
    documentSet: null,
    statusSummary: null,
  };
}

function mockDrawerRoutes(detailResponse: unknown, listResponseValue: unknown, editDetailOverride?: unknown) {
  apiGet.mockImplementation((url: string) => {
    if (/^\/shipments\/\d+$/.test(url)) {
      return Promise.resolve(editDetailOverride ?? editShipmentDetail(Number(url.split('/').pop())));
    }
    if (url === '/catalogs/bootstrap') return Promise.resolve(bootstrapCatalog);
    if (url.startsWith('/shipments/operational-sites')) return Promise.resolve({ items: [] });
    if (url.startsWith('/shipments/duplicate-check')) return Promise.resolve({ conflicts: [] });
    if (url.startsWith('/pricing/freight-preview')) {
      return Promise.resolve({ readiness: 'MISSING_INPUT', status: 'MISSING_INPUT', message: 'Thiếu điều khoản tính cước.', missingInput: 'bảng giá' });
    }
    if (url.startsWith('/vehicle-size-classes')) return Promise.resolve({ items: [] });
    return url === '/shipments/cus-workspace/1' ? Promise.resolve(detailResponse) : Promise.resolve(listResponseValue);
  });
}

/** SIL-1150 (KB §3.1.7 / K3.18): the drawer body is the SHARED lot form —
 *  the same ShipmentCreateWorkspace /shipments/new renders — in edit context
 *  for the clicked lot. The edit action bar (Huỷ / Lưu thay đổi) is its
 *  signature: it replaces the retired footer "Sửa" navigation. */
function expectSharedLotFormInDrawer(drawer: HTMLElement) {
  expect(drawer.querySelector('form.csc-workspace')).toBeTruthy();
  expect(within(drawer).getByRole('button', { name: 'Lưu thay đổi' })).toBeTruthy();
  expect(within(drawer).getByRole('button', { name: 'Huỷ' })).toBeTruthy();
}

describe('ShipmentsPage — CUS closeout workspace', () => {
  // QA 28/11 (P2 sweep): the row's "Chi tiết" is the shared quiet outlined
  // button (.btn--secondary.btn--sm) — it reads as clickable; no chevron
  // icon, and the lot-delete affordance stays out of the row (it lives in
  // the drawer header).
  it('row actions: outlined "Chi tiết" button without an icon; no trash on the row', async () => {
    renderPage();
    await screen.findByRole('table');
    const row = masterRow();
    // SIL-699 r2: every read-only cell also opens the drawer with the same
    // 'Mở chi tiết lô hàng' name — pin the row's button via its class.
    const detailButton = masterRowDetailButton();
    expect(row.contains(detailButton)).toBe(true);
    expect(detailButton.textContent).toContain('Chi tiết');
    expect(detailButton.querySelector('svg')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Xóa lô hàng/ })).toBeNull();

    // The quiet outlined voice: the shared secondary button classes, so the
    // affordance reads as a button — not a stray green text link.
    expect(detailButton.classList.contains('btn--secondary')).toBe(true);
    expect(detailButton.classList.contains('btn--sm')).toBe(true);
  });

  beforeEach(() => {
    authState.user.role = Role.CUS;
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    downloadCSV.mockReset();
    window.localStorage.clear();
    mockDrawerRoutes(detail, listResponse());
    apiPost.mockResolvedValue({ replayed: false });
    apiPut.mockResolvedValue({ ...row, version: 4 });
  });

  afterEach(() => {
    window.ResizeObserver = defaultResizeObserver;
  });

  it('renders one focused shipment workspace without unfinished navigation', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Tổng quan lô hàng' })).toBeTruthy();
    // No status tab strip before data arrives (the date-preset group in the
    // toolbar is a different control and does render).
    expect(screen.queryByRole('tablist', { name: 'Trạng thái lô hàng' })).toBeNull();
    // KB §3.1.5 (24/11): the page's section switcher — "Tất cả lô hàng" is
    // the live section, "Hóa đơn kết hợp" is the RESERVED position: present,
    // disabled, never a dead navigation target.
    const sectionTabs = screen.getByRole('tablist', { name: 'Chức năng quản lý lô hàng' });
    expect(within(sectionTabs).getByRole('tab', { name: /Tất cả lô hàng/ })).toBeTruthy();
    const reserved = within(sectionTabs).getByRole('tab', { name: 'Hóa đơn kết hợp' });
    expect(reserved).toBeDisabled();
    // QA 28/11 sweep — the reserved tab explains its disable: tooltip and an
    // inline muted note under the strip.
    expect(reserved).toHaveAttribute('title', 'Chưa có lô nào đủ điều kiện gộp hóa đơn');
    expect(screen.getByText('Chưa có lô nào đủ điều kiện gộp hóa đơn.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tìm lô hàng').getAttribute('type')).toBe('text');
  });

  it('surfaces API-backed operational priorities before the detailed shipment table', async () => {
    const priorityRow = {
      ...row,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const, vehicleReadiness: 'WAITING_PLATE' as const },
      accountingConfirmation: { ...row.accountingConfirmation, status: 'PENDING' as const },
    };
    apiGet.mockResolvedValue(listResponse([priorityRow]));

    renderPage();

    // Card 20260926_47: the priority rail is the tab strip now — the API's
    // full-set statusCounts ride the tab counts, and the strip precedes the table.
    const tablist = await screen.findByRole('tablist', { name: 'Trạng thái lô hàng' });
    for (const label of ['Tất cả', 'Chưa chốt lịch', 'Chờ điều xe', 'Chờ đối soát']) {
      expect(within(tablist).getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(within(tablist).getByRole('tab', { name: /Tất cả/ }).textContent).toContain('1');
    expect(tablist.textContent).not.toContain('(trang)');
    expect(tablist.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Card 20260922_42: the bar applies live (one apply model, shared bar
  // search slot) — a pattern-violating draft is never applied at all.
  it('applies a valid suffix after the debounce and never applies a pattern-violating draft', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Tìm lô hàng');

    fireEvent.change(input, { target: { value: 'A12' } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('searchSuffix=A12'));

    fireEvent.change(input, { target: { value: 'AB$1' } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('searchSuffix=AB%241'));

    fireEvent.change(input, { target: { value: 'aB12C' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=aB12C')));
  });

  it('accepts the full Bill/Booking number, not only a 4-5 char suffix (2026-09-09 report)', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Tìm lô hàng');

    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=MSCU6639870')));
  });

  // QA2-005: the record search covers the customer name too, so a Vietnamese
  // diacritic draft must validate like an ASCII reference and reach the wire.
  it('applies a Vietnamese customer-name search after the debounce (QA2-005)', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Tìm lô hàng');

    fireEvent.change(input, { target: { value: 'Nguyễn Văn A' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=Nguy%E1%BB%85n+V%C4%83n+A')));
  });

  // QA2-005: search composes with the existing filters — one request carries
  // both the record search and the direction criterion.
  it('composes the record search with the direction filter on one request (QA2-005)', async () => {
    renderPage('/shipments?searchSuffix=aB12C&direction=IMPORT');
    await screen.findByRole('table');
    const url = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
    expect(url).toContain('searchSuffix=aB12C');
    expect(url).toContain('direction=IMPORT');
  });

  it('renders the approved seven-column multi-line dashboard and opens detail in a drawer', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const surface = within(table);
    const headers = ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú', 'Trạng thái'];
    for (const header of headers) {
      expect(surface.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(surface.getByText('Công ty Silver Sea')).toBeTruthy();
    expect(surface.getByText('Hải Phòng → Hà Nội')).toBeTruthy();
    expect(surface.getByText('TK-54321')).toBeTruthy();
    expect(surface.queryByText(/CBM/)).toBeNull();
    expect(surface.getAllByText(/12\/08\/2026/).length).toBeGreaterThan(0);
    // The overview only shows explicit container appointments; it must not
    // repeat the nearest closing/return time from plannedReturnAt.
    expect(surface.queryByText('17:00 · trả hàng')).toBeNull();
    // Per-container appointment groups (SIL-603): each group stacks its facts
    // — the datetime holds one line, the factory name drops to the next line
    // in full — instead of one `·`-packed run an ellipsis could cut.
    const scheduleCell = surface.getByText('12/08/2026 09:30').closest('td');
    expect(within(scheduleCell!).getAllByText('Nhà máy ABC')).toHaveLength(2);
    expect(within(scheduleCell!).getByText('1x40HC')).toBeTruthy();
    expect(within(scheduleCell!).getByText('12/08/2026 16:30')).toBeTruthy();
    expect(within(scheduleCell!).getByText('1x20GP')).toBeTruthy();
    expect(masterRowDetailButton().textContent).toContain('Chi tiết');
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn cột hiển thị' })).toBeNull();

    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    // SIL-1150 (KB §3.1.7): the drawer hosts the SHARED lot form in edit
    // context — the same ShipmentCreateWorkspace /shipments/new renders,
    // prefilled with this lot's container.
    expectSharedLotFormInDrawer(dialog);
    expect(within(dialog).getByDisplayValue('MSKU1234567')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
    expect(apiGet).toHaveBeenCalledWith('/shipments/1');
  });

  // Card 091026164530: the lot quick-view dialog ('Mở chi tiết lô hàng') was
  // reported to show a 'Tổng quan'/'Chi tiết' tablist on the first open and no
  // tablist on later opens. The drawer is a single-view surface that carries
  // NO tablist at any width, and its content must be identical on every open
  // of the same lot. SIL-1150: that surface is the SHARED lot form. Pin that
  // consistency contract: three open/close cycles, byte-identical dialog
  // content, no tablist ever — any reopen-divergent render state (a flag not
  // reset on close, a condition keyed to the detail cache) turns this red.
  it('quick-view dialog renders identical content with no tablist on every reopen (card 091026164530)', async () => {
    renderPage();
    await screen.findByRole('table');

    const opens: string[] = [];
    for (let open = 1; open <= 3; open++) {
      fireEvent.click(masterRowDetailButton());
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expectSharedLotFormInDrawer(dialog));
      // Design truth pinned per the card's consistency AC: the dialog is not a
      // tabbed surface — no tablist inside it, ever.
      expect(dialog.querySelectorAll('[role="tablist"], [role="tab"]')).toHaveLength(0);
      opens.push(dialog.textContent ?? '');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(new Set(opens).size).toBe(1);
  });

  it('opens straight into the shared form with the head chrome, no tabs (SIL-485 chrome, SIL-1150 body)', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    // Still a single-view surface: no segmented lot bar and no 'Chi tiết lô
    // hàng' Link to /shipments/:id inside the drawer.
    expect(document.querySelector('.cus-drawer-lot-bar')).toBeNull();
    expect(within(drawer).queryByRole('link', { name: /Chi tiết lô hàng/ })).toBeNull();
    expect(within(drawer).queryByRole('tablist')).toBeNull();
    // Head chrome: the workflow icon (Khóa lô for this lot's action) and the
    // Xóa lô ghost trash ride the head-actions cluster beside expand/close.
    expect(within(drawer).getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Xóa lô' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Phóng to toàn màn hình' })).toBeTruthy();
    // Head row carries the status chips inline after the title (Hàng FCL solid
    // + the operational signals) — scoped to the heading: the form body also
    // names the mode ("Hàng FCL" radio option).
    expect(within(drawer.querySelector('.drawer__heading') as HTMLElement).getByText('Hàng FCL')).toBeTruthy();
    // SIL-1150 (KB §3.1.7): the body is the SHARED lot form — the same
    // ShipmentCreateWorkspace /shipments/new renders, in edit context.
    expectSharedLotFormInDrawer(drawer);
  });

  it('does not repeat the shipment-level closing or return date before container appointments', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, transportDate: '2026-08-19' }]));
    renderPage();

    const scheduleCell = (await screen.findByText('12/08/2026 09:30')).closest('td');
    expect(scheduleCell).toBeTruthy();
    expect(within(scheduleCell!).queryByText('19/8/2026')).toBeNull();
    expect(within(scheduleCell!).getByText('12/08/2026 09:30')).toBeTruthy();
    expect(within(scheduleCell!).queryByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' })).toBeNull();
  });

  it('shows the actual ready-for-dispatch status instead of the generic new bucket label', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      bucket: ShipmentCusBucket.NEW,
      bucketLabel: 'Mới tạo',
      status: ShipmentStatus.READY_FOR_DISPATCH,
    }]));
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Sẵn sàng điều xe')).toBeTruthy();
    expect(within(table).queryByText('Mới tạo')).toBeNull();
  });

  it('shows CBM only for LCL cargo', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    expect(await screen.findByText(/52,5 CBM/)).toBeTruthy();
  });

  it('renders inline Lẻ badge for LCL cargo summary (SIL-758) and exports Cont/Lẻ in XLSX', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'FCL' }, { ...row, id: 2, cargoMode: 'LCL', containerSummary: '4 Pallet' }]));
    renderPage();
    const table = await screen.findByRole('table');
    // SIL-758 (id 879): FCL has no redundant Cont pill; LCL carries the inline
    // Lẻ badge in the cargo overview cell.
    expect(within(table).queryByText('Cont')).toBeNull();
    const lclBadge = within(table).getByText('Lẻ');
    expect(lclBadge).toBeTruthy();
    expect(lclBadge.className).toContain('cus-cargo-summary__lcl-badge');

    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const exportArgs = downloadCSV.mock.calls[0];
    const rows = exportArgs?.[2] as Array<Array<string | number>>;
    // Column index 3 = "Tổng quan hàng hóa" — opens with the approved Cont/Lẻ label.
    expect(rows[0]?.[3]).toContain('Cont');
    expect(rows[1]?.[3]).toContain('Lẻ');
  });

  it('keeps the detail action visually attached to its shipment status evidence', async () => {
    renderPage();
    await screen.findByRole('table');

    const statusCell = within(masterRow()).getByText('Sẵn sàng điều xe').closest('td');
    expect(statusCell).toBeTruthy();
    expect(statusCell?.querySelector('.cus-row-actions__status')).toBeTruthy();
    // ', trạng thái' suffix keeps this on the row's LINK button — the cell
    // triggers (SIL-699 r2) carry the same prefix without the suffix.
    expect(within(statusCell!).getByRole('button', { name: /Mở chi tiết lô hàng BILL-12345, trạng thái/ }).textContent).toContain('Chi tiết');
    // QA 28/11 (P2 sweep): the button is the shared quiet outlined voice —
    // the page no longer paints it as a green text link.
    expect(css).not.toMatch(/\.cus-dashboard-detail\s*\{[^}]*color/);
    expect(recordCss).toMatch(/\.cus-row-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*space-between;/);
  });

  // Card 20260924_21 (BATCH A, item 8): the compound Trạng thái cell must
  // split the lifecycle badge from the missing-data warning into separate
  // slots (§1 "One concept, one place per row"). The default row carries
  // `isLoss: true` so it exercises both halves of the split.
  it('splits the compound Trạng thái cell into a lifecycle slot and a signal slot', async () => {
    renderPage();
    await screen.findByRole('table');

    const statusCell = within(masterRow()).getByText('Sẵn sàng điều xe').closest('td');
    expect(statusCell).toBeTruthy();

    // Lifecycle badge owns its own slot — the badge is wrapped in
    // `.cus-row-actions__lifecycle`, a child of the status slot.
    const lifecycle = statusCell?.querySelector('.cus-row-actions__lifecycle');
    expect(lifecycle).toBeTruthy();
    expect(within(lifecycle as HTMLElement).getByText('Sẵn sàng điều xe')).toBeTruthy();

    // Missing-data warning owns its own slot — a sibling of the lifecycle
    // slot, NOT a child. Both are children of the status slot.
    const signal = statusCell?.querySelector('.cus-row-actions__signal');
    expect(signal).toBeTruthy();
    // The default row carries `isLoss: true`, so the primary danger signal
    // is "Lỗ"; that label is now its own slot, separate from the lifecycle
    // badge above it.
    expect(within(signal as HTMLElement).getByText('Lỗ')).toBeTruthy();

    // Sanity: the lifecycle and signal slots are SIBLINGS, not nested — one
    // concept, one place.
    const status = statusCell?.querySelector('.cus-row-actions__status');
    const kids = status ? [...status.children] : [];
    expect(kids.length).toBe(2);
    expect(kids[0]?.classList.contains('cus-row-actions__lifecycle')).toBe(true);
    expect(kids[1]?.classList.contains('cus-row-actions__signal')).toBe(true);
  });

  it('uses the package authority instead of claiming zero containers and exports that same value', async () => {
    const lclRow: ShipmentCusWorkspaceListItem = {
      ...row,
      containerSummary: '4 Pallet',
      packageCount: 4,
      packageType: 'Pallet',
      operational: { ...row.operational, totalContainers: 0, vehicleReadiness: 'NO_CONTAINERS' },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve({ ...detail, summary: lclRow }) : Promise.resolve(listResponse([lclRow]))
    ));

    renderPage();
    expect((await screen.findAllByText('4 Pallet')).length).toBe(1);
    expect(screen.queryByText('0 cont')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const exportArgs = downloadCSV.mock.calls[0];
    const exportColumns = exportArgs?.[1] as string[];
    expect(exportColumns).toHaveLength(7);
    const rows = exportArgs?.[2] as Array<Array<string | number>>;
    // Column index 3 = "Tổng quan hàng hóa" — includes the package-authority quantity.
    expect(rows[0]?.[3]).toContain('4 Pallet');
  });

  it('shows every container type on its own line in the cargo summary without an ellipsis', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL', containerSummary: '1x40HC + 1x20DC' }]));

    renderPage();
    // Mixed container types split one line per type (Kiến nghị L2 item 1.2).
    // Scoped to the cargo cell: since SIL-603 the schedule cell's group also
    // renders its own '1x40HC' span, so the page-wide query is ambiguous.
    const table = await screen.findByRole('table');
    const cargoCell = table.querySelector(
      "tr.cus-dashboard-row td[data-label='Tổng quan hàng hóa']",
    ) as HTMLElement;
    const firstType = await within(cargoCell).findByText('1x40HC');
    expect(firstType.className).toContain('cus-cargo-summary__containers');
    const secondType = within(masterRow()).getByText('1x20DC');
    expect(secondType.className).toContain('cus-cargo-summary__containers');
    expect(within(masterRow()).queryByText('1x40HC + 1x20DC')).toBeNull();
    expect(within(masterRow()).getByText('25 tấn · 52,5 CBM')).toBeTruthy();
  });

  it('renders note previews as compact supporting text rather than table headings', async () => {
    renderPage();

    const customerNote = await screen.findByText('Giao buổi sáng');
    expect(customerNote.className).toContain('cus-note-preview__customer');
    expect(css).toMatch(/\.cus-note-preview > \.cus-note-preview__customer\s*\{[^}]*font-size:\s*var\(--ops-table-note-size\);[^}]*font-weight:\s*var\(--ops-table-note-weight\);/);
    expect(source).not.toContain('<strong>{customerNoteLines[0]');
  });

  it('gives customer and operational notes fixed visual priority instead of letting both consume the cell', async () => {
    const longNotes = {
      ...row,
      customerNotes: 'Lô hàng WHLU12258972 đã sẵn sàng, đề nghị điều xe đến nhà máy trước 16h. Vui lòng liên hệ điều phối trước khi nhận hàng.',
      operationalNotes: 'Hãng tàu Wan Hai Lines đã xác nhận lịch tàu cập cảng Hải Phòng. Liên hệ đại lý nếu cần điều chỉnh lịch giao nhận.',
    };
    apiGet.mockResolvedValue(listResponse([longNotes]));

    renderPage();

    // SIL-1150: every cell trigger shares the drawer route's accessible name,
    // so the notes trigger is reached through its own preview content.
    const customerPreview = await screen.findByText(/đề nghị điều xe đến nhà máy trước 16h/);
    const notes = customerPreview.closest('button')!;
    expect(notes.id).toBe('cus-inline-notes-1');
    expect(notes.querySelectorAll(':scope > span')).toHaveLength(2);
    expect(notes.textContent).toContain('đề nghị điều xe đến nhà máy trước 16h');
    expect(notes.textContent).toContain('Hãng tàu Wan Hai Lines đã xác nhận');
    expect(css).toMatch(/\.cus-note-preview\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/);
    expect(css).toMatch(/\.cus-note-preview__customer\s*\{[^}]*-webkit-line-clamp:\s*2;/);
    expect(css).toMatch(/\.cus-note-internal\s*\{[^}]*-webkit-line-clamp:\s*1;/);
  });

  it('counts only plate-complete containers as assigned in the dispatch-readiness label', async () => {
    const waitingForEveryPlate: ShipmentCusWorkspaceListItem = {
      ...row,
      id: 11,
      billOrBookNumber: 'BILL-WAIT-ALL',
      operational: {
        ...row.operational,
        vehicleReadiness: 'WAITING_PLATE',
        totalContainers: 2,
        assignedContainers: 2,
        plateAssignedContainers: 0,
        orderIssuedContainers: 0,
        missingPlateContainers: 2,
      },
    };
    const waitingForOnePlate: ShipmentCusWorkspaceListItem = {
      ...row,
      id: 12,
      billOrBookNumber: 'BILL-WAIT-ONE',
      operational: {
        ...row.operational,
        vehicleReadiness: 'WAITING_PLATE',
        totalContainers: 2,
        assignedContainers: 2,
        plateAssignedContainers: 1,
        orderIssuedContainers: 0,
        missingPlateContainers: 1,
      },
    };
    apiGet.mockResolvedValue(listResponse([waitingForEveryPlate, waitingForOnePlate]));

    renderPage();

    expect((await screen.findAllByText('Toàn bộ chờ phân xe')).length).toBe(1);
    expect(screen.getByText('1 cont chờ phân xe')).toBeTruthy();
    expect(screen.queryByText('0 cont chờ phân xe')).toBeNull();
  });

  it('sends the direction filter and keeps the grouped dashboard columns fixed', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Xuất' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Trạng thái' })).toBeTruthy();
    expect(window.localStorage.getItem('silversea:cus-shipments:master-columns:v3')).toBeNull();
  });

  // Office request 2026-09-18: the table must offer a rows-per-page choice up to
  // 200. The choice is a URL param, so the fetch, the summary and a shared link
  // all agree — and an unknown value falls back to the 20 default.
  it('takes rows-per-page from the URL and refetches when the selector changes', async () => {
    // Three pages of lots, so the pagination (and its selector) renders.
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve({ ...listResponse(), total: 144, totalPages: 3 })
    ));
    renderPage('/shipments?limit=200');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('limit=200')));
    // The design-system select trigger's acc-name is "<selected> <label>".
    fireEvent.click(await screen.findByRole('button', { name: '200 Số dòng mỗi trang' }));
    fireEvent.click(await screen.findByRole('option', { name: '50' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('limit=50')));
  });

  it('keeps the rows-per-page selector when the list fits one page', async () => {
    // Staging 2026-09-18: choosing 200 left a single page, the whole bar was
    // gated on totalPages > 1 and the choice could not be changed back.
    mockDrawerRoutes(detail, listResponse());
    renderPage('/shipments?limit=200');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('limit=200')));
    expect(await screen.findByLabelText('Số dòng mỗi trang')).toBeTruthy();
  });

  it('ends the worksheet at the pagination surface — no block renders after the list (MOBFOOT-1016)', async () => {
    // Owner phone report 2026-10-16: an empty grey band below the last lot
    // card read as a stray footer. The DOM side of that contract: the page's
    // element chain terminates in the worksheet, and the worksheet's own
    // terminal block is the pagination surface — a footer, empty-state block
    // or spacer appended after it would recreate the stray-band reading.
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve({ ...listResponse(), total: 144, totalPages: 3 })
    ));
    renderPage('/shipments');
    const nav = await screen.findByRole('navigation', { name: 'Phân trang' });
    expect(nav.classList.contains('ds-pagination')).toBe(true);

    const viewport = nav.closest('.cus-dashboard-viewport');
    expect(viewport).not.toBeNull();
    expect(viewport?.lastElementChild).toBe(nav);

    const pageEl = nav.closest('.shipments-page');
    expect(pageEl).not.toBeNull();
    expect(pageEl?.lastElementChild).toBe(nav.closest('.cus-workspace'));
    expect(pageEl?.parentElement?.lastElementChild).toBe(pageEl);
  });

  it('falls back to 20 rows when the URL carries an unsupported size', async () => {
    renderPage('/shipments?limit=37');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('limit=20')));
  });

  it('does not render a redundant active-filters chip strip', async () => {
    renderPage('/shipments?searchSuffix=AB12');
    await screen.findByRole('table');
    expect(screen.queryByText('Đang lọc')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa bộ lọc Mã: AB12' })).toBeNull();
  });

  it('clears an applied suffix via the bar reset action', async () => {
    renderPage('/shipments?searchSuffix=AB12');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lọc' }));

    await waitFor(() => {
      const latestUrl = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
      expect(latestUrl).not.toContain('searchSuffix=');
    });
  });

  it('offers a co-located reset action from the filtered no-results state', async () => {
    apiGet.mockResolvedValue(listResponse([]));
    renderPage('/shipments?searchSuffix=ZZZZ9');

    expect(await screen.findByText('Không có lô hàng phù hợp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Xóa bộ lọc$/ }));

    await waitFor(() => {
      const latestUrl = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
      expect(latestUrl).not.toContain('searchSuffix=');
    });
  });

  it('SIL-1104 (K2.157): a failed list load shows the error banner ONLY — never an empty state or a zero count', async () => {
    apiGet.mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.'));
    renderPage('/shipments');

    // The failure surfaces as banner + retry (kept from the pre-fix behavior).
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();

    // Neither empty-state variant may present a failed fetch as data truth.
    expect(screen.queryByText('Chưa có lô hàng')).toBeNull();
    expect(screen.queryByText('Không có lô hàng phù hợp')).toBeNull();
    expect(screen.queryByLabelText('Bảng tổng hợp lô hàng')).toBeNull();

    // The section tab carries no numeral while nothing loaded — "Tất cả lô
    // hàng 0" would claim an empty table the API never reported.
    const sectionTabs = screen.getByRole('tablist', { name: 'Chức năng quản lý lô hàng' });
    expect(within(sectionTabs).getByRole('tab', { name: 'Tất cả lô hàng' })).toBeTruthy();
    expect(within(sectionTabs).getByText('Tất cả lô hàng').textContent).toBe('Tất cả lô hàng');
  });

  it('stacks the same seven groups at narrow widths without a horizontal rail', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(document.querySelector('.cus-dashboard-viewport')).not.toBeNull();
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(css).toMatch(/\.cus-dashboard-viewport\s*\{[\s\S]*?overflow-x:\s*clip;/);
    expect(css).toMatch(/@media \(max-width: 999px\)[\s\S]*?\.cus-dashboard-table tbody > tr\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
    // Data-dense card (operator 2026-09-27: "redesign this to make it data dense
    // card"): the row is a two-column FACT grid — only the identity cell spans
    // both columns, every other cell pairs with its neighbour, and the section
    // label rides the first value's line instead of owning one.
    expect(recordCss).toMatch(/th\[data-label='Khách hàng & nhà máy'\]\s*\{\s*grid-column:\s*1 \/ -1;/);
    expect(recordCss).toMatch(/th:not\(\[data-label='Khách hàng & nhà máy'\]\),[\s\S]*?td\s*\{\s*grid-column:\s*auto;/);
    // The label owns its OWN line now (QA 28/11 P2 sweep): the inline run
    // fused "HÀNG HÓA" onto the first value, reading as one sentence. It is
    // a block eyebrow above the cell's own text flow — the shape the shared
    // record-table card band uses for a stacked labelled fact.
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*display\s*:\s*block\s*;[^}]*width\s*:\s*auto\s*;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger\[data-cell-short\]::before\s*\{[^}]*content:\s*attr\(data-cell-short\);/);
    // The ` · ` join is now UNCONDITIONAL in the phone card: the
    // `data-facts="inline"` markup flag is gone from every source file (the
    // card always joins), and the separator is stated for the trigger's direct
    // children too, because the schedule cell paints its facts straight into
    // the trigger without a `.cus-multiline-cell` wrapper.
    // Card c6b02380 REPLACED the ` · ` join at phone widths, and this pin used
    // to assert the join's presence — so it went red on correct code and
    // nobody could tell a real regression from the intended change. The
    // contract now (after the QA 28/11 P2 sweep): the LABEL
    // (`.cus-inline-trigger::before`) is a block eyebrow on its own line, the
    // first fact opens the value run and every later fact takes its own line
    // as a block. There is deliberately no
    // separator glyph, because nothing is trying to share a line, so there is
    // no "where does one fact end" question to mark and no glyph to strand on
    // a narrow screen.
    //
    // Pinned on the behaviour that replaced the join, not merely dropped:
    //   - the stack is an inline run after the block label
    //   - children are blocks, so each later fact breaks to its own line
    //   - :first-child is the inline exception, and it is :first-child and NOT
    //     :first-of-type because these cells alternate `strong` and `span`
    expect(recordCss).toMatch(/\.cus-dashboard-table \.cus-multiline-cell\s*\{[^}]*display:\s*inline\s*;/);
    expect(recordCss).toMatch(/\.cus-dashboard-table \.cus-multiline-cell > \*,\s*\.cus-dashboard-table \.cus-inline-trigger > \*\s*\{[^}]*display:\s*block\s*;/);
    expect(recordCss).toMatch(/\.cus-dashboard-table \.cus-multiline-cell > \*:first-child,\s*\.cus-dashboard-table \.cus-inline-trigger > \*:first-child\s*\{[^}]*display:\s*inline\s*;/);
    // And the join must stay gone — this is the assertion that fails if the
    // old separator is reintroduced alongside the new stacking.
    expect(recordCss).not.toMatch(/::after[^{}]*content:\s*' ·'/);
    expect(css).not.toMatch(/\[data-facts/);
    // SIL-1150 (QA 28/11): the per-cell quick-edit modal is retired — its
    // stylesheet hooks are gone with it, and no modal host remains in the
    // page or the row (every cell opens the lot drawer; the drawer's Sửa
    // routes to the shared edit form).
    expect(css).not.toMatch(/cus-quick-edit-modal/);
    expect(source).not.toContain('ShipmentQuickEditModal');
    expect(rowSource).not.toContain('ShipmentQuickEditModal');
    expect(rowSource).toContain('guardRowClick(drawerTrigger.onClick)');
  });

  it('CUS-OVERVIEW-03 shows the missing-date warning once and retains the lifecycle badge', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      transportDate: null,
      plannedReturnAt: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const },
      finance: { ...row.finance, isLoss: false, hasPendingRecovery: false },
    }]));

    renderPage();
    // The board's status TAB is also named "Chưa chốt lịch", so the missing-date
    // warning is asserted inside the row — the cell, not the tab.
    await screen.findByRole('table');
    expect(await within(masterRow()).findByText('Chưa chốt lịch')).toBeTruthy();
    expect(masterRow().classList.contains('cus-dashboard-row--waiting')).toBe(true);
    expect(within(masterRow()).getAllByText('Chưa chốt lịch')).toHaveLength(1);
    expect(within(masterRow()).queryByText('Chờ chốt lịch')).toBeNull();
    expect(within(masterRow()).getByText('Sẵn sàng điều xe')).toBeTruthy();
    expect(screen.queryByText('Cần kiểm tra')).toBeNull();
    // The attention signal is the CELL'S TEXT, not a colour field. This sheet
    // once tinted the whole schedule cell cream; when nearly every row is
    // waiting — which is the unfiltered default — the tint covered 100% of the
    // column, signalled nothing, and became a solid beige band the full height
    // of the table. §10 is the same rule from the parity side: a status is the
    // 3×20px strip, never a full-height fill. "Chưa chốt lịch" carries it in
    // the warning ink, and the row keeps its per-bucket StatusStrip.
    expect(css).not.toMatch(/\.cus-dashboard-table tbody > tr\.cus-dashboard-row--waiting[^{]*\{[^}]*background/);
    expect(css).toMatch(/\.cus-schedule-missing\s*\{[^}]*color:/);
    // The per-bucket status strip on the identity cell stays.
    expect(css).toMatch(/\.cus-dashboard-row \.status-strip\s*\{[^}]*pointer-events:\s*none;/);
  });

  // Owner ruling 03-10 (screenshot): hovering a shipment card highlighted the
  // WHOLE card. The sheet carried `.cus-dashboard-row:hover > th, > td`, so every
  // cell in the row lit and the cell actually under the pointer no longer read
  // as the hovered one. The hover belongs to the cell alone.
  it('CUS-HOVER-01 highlights the hovered cell, never the whole row', () => {
    // Comments quote the removed rule verbatim, so assert against the sheet with
    // comments stripped — otherwise the explanation of the fix fails the fix.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // No descendant-combinator row tint: that is the shape that lit every cell.
    expect(rules).not.toMatch(/\.cus-dashboard-row:hover\s*>\s*(th|td)/);
    expect(rules).not.toMatch(/\.cus-dashboard-row:hover[^{]*\{[^}]*background/);
    // The cell under the pointer is what carries the hover, and only on a fine
    // pointer — a touch browser keeps :hover stuck on the last-touched target.
    expect(rules).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[^}]*\.cus-dashboard-table td:hover[^}]*background:\s*var\(--surface-2\)/);
  });

  it('CUS-OVERVIEW-03 retains a distinct recovery warning after deduplicating the missing-date signal', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      appointmentGroups: [],
      transportDate: null,
      plannedReturnAt: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const },
      finance: { ...row.finance, isLoss: false, hasPendingRecovery: true },
    }]));
    renderPage();
    await screen.findByRole('table');
    const record = within(masterRow());
    expect(record.getAllByText('Chưa chốt lịch')).toHaveLength(1);
    expect(record.queryByText('Chờ chốt lịch')).toBeNull();
    expect(record.getByTitle('Chờ thu hồi')).toBeTruthy();
    expect(record.getByText('Sẵn sàng điều xe')).toBeTruthy();
  });

  it('CUS-OVERVIEW-03 keeps overdue, assignment and partial issuance information distinct', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      operational: { ...row.operational, scheduleReadiness: 'OVERDUE' as const, orderIssuedContainers: 1 },
      finance: { ...row.finance, isLoss: false, hasPendingRecovery: false },
    }]));
    renderPage();
    await screen.findByRole('table');
    const record = within(masterRow());
    expect(record.getByTitle('Lịch đã quá hạn')).toBeTruthy();
    expect(record.getByText('Đã điều xe')).toBeTruthy();
    expect(record.getByText('Đã phát lệnh 1/2 cont')).toBeTruthy();
    expect(record.getByText('Sẵn sàng điều xe')).toBeTruthy();
  });

  // Card 20260928_193 (source card 20260927_67 item 3): GHI CHÚ hides itself by
  // DEFAULT while every rendered row is empty, and shows the moment one row
  // carries a note. The two cases below pin both halves of that contract at the
  // page level; the resolver's own rules live in lib/column-visibility.test.ts.
  it('hides the empty GHI CHÚ column by default, with the picker as the way back to it', async () => {
    apiGet.mockResolvedValue(listResponse([noteLessRow()]));
    renderPage();
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Ghi chú' })).toBeNull();
    // Seven groups render instead of eight, and no column is left dangling.
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    // The picker rides the bar (card 20260927_152's one filter plane), and it
    // is the affordance that brings the column back.
    expect(document.querySelector('.filter-bar.list-filter-bar .column-picker')).toBeTruthy();
    expect(localStorage.getItem('cus-lots-hidden-cols')).toBeNull();
  });

  it('shows the GHI CHÚ column as soon as a rendered row carries a note', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...noteLessRow(), customerNotes: 'Gọi trước 30 phút' }]));
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Ghi chú' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
  });

  // KB §3.1.5 (24/11): the customer's money that carries NO invoice is a
  // first-class column of the Chứng từ board — the CUS chases it on every lot.
  it('shows the Tổng thu Khách (Không Hóa đơn) column and its value', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    const { container } = renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Tổng thu Khách (Không Hóa đơn)' })).toBeTruthy();
    const cell = container.querySelector('td[data-label="Tổng thu Khách (Không Hóa đơn)"]');
    expect(cell?.textContent).toContain('1.500.000 ₫');
  });

  // QA 28/11 (P2 sweep): with no rendered row carrying a total, the column
  // is a run of '—' — it hides itself like GHI CHÚ (autoHideWhenEmpty)
  // instead of painting whitespace. One row with money brings it back.
  it('auto-hides the Tổng thu Khách column while every rendered row lacks a total', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, finance: { ...row.finance, customerNoInvoiceTotal: null } }]));
    const { container } = renderPage();
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Tổng thu Khách (Không Hóa đơn)' })).toBeNull();
    expect(container.querySelector('td[data-label="Tổng thu Khách (Không Hóa đơn)"]')).toBeNull();
  });

  it('CUS-OVERVIEW-04 keeps empty notes reachable through the named cell (SIL-1150: the drawer owns editing)', async () => {
    // The column hides by DEFAULT while it is empty (previous case), so this
    // reaches the action the way an operator does — with the column shown by an
    // explicit choice. SIL-1150 retired the per-cell notes dialog: the cell
    // opens the lot drawer, whose Sửa routes to the shared edit form; the
    // empty-cell 'Thêm ghi chú' naming stays.
    localStorage.setItem('cus-lots-hidden-cols', '[]');
    apiGet.mockResolvedValue(listResponse([noteLessRow()]));
    renderPage();
    const trigger = await screen.findByText('Thêm ghi chú');
    expect(trigger.closest('button')!.id).toBe('cus-inline-notes-1');
    fireEvent.click(trigger.closest('button')!);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText('Công ty Silver Sea').length).toBeGreaterThan(0);
  });

  it('CUS-OVERVIEW-02: every filter control rides the one Row 2 toolbar — visible, no disclosure', async () => {
    renderPage();
    await screen.findByRole('table');
    // Row 2 is the shared bar (card 20260927_152).
    const toolbar = document.querySelector('.cus-workspace .filter-bar.list-filter-bar') as HTMLElement;
    expect(screen.getByLabelText('Tìm lô hàng')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Khoảng ngày giao' })).toBeTruthy();
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    // While the strip fits two rows every criterion renders INLINE — no
    // `Bộ lọc` trigger at all (operator 2026-09-27: "when there is enough space
    // we try our best to display all filters, not group inside bo loc").
    expect(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Loại: Tất cả' })).toBeTruthy();
    expect(toolbar.querySelector('.shipments-control__plan button[aria-haspopup]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Xuất' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));
  });

  it('nối mọi số tờ khai bằng ", " trong một chuỗi ở ô Chứng từ (SIL-787, thay law SIL-532)', async () => {
    const multiDeclaration: ShipmentCusWorkspaceListItem = {
      ...row,
      declarationNumbers: ['TK-54321', 'TK-77777'],
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([multiDeclaration]))
    ));
    renderPage();
    await screen.findByRole('table');

    // One joined ', ' run — same string the XLSX CHỨNG TỪ column carries
    // (KB Ch3 §3.4.4). Wraps whole, never truncated.
    expect(screen.getByText('TK-54321, TK-77777')).toBeTruthy();
  });

  it('documents cell với Bill/Booking READ_ONLY: mở DRAWER thay editor — hết đường ghi tờ khai cấp lô (SIL-521, SIL-699 r2)', async () => {
    const declarationOnlyRow: ShipmentCusWorkspaceListItem = {
      ...row,
      fieldAccess: {
        ...row.fieldAccess,
        blNumber: { mode: 'READ_ONLY', reason: 'Chỉ CUS được sửa bill.' },
        bookingRef: { mode: 'READ_ONLY', reason: 'Chỉ CUS được sửa booking.' },
      },
    };
    mockDrawerRoutes(detail, listResponse([declarationOnlyRow]));
    renderPage();
    await screen.findByRole('table');

    // documents mode giờ chỉ ghi Bill/Booking (SIL-521 bỏ tờ khai cấp lô) —
    // khi cả hai READ_ONLY, nhóm không còn gì ghi được: ô chuyển sang mở
    // DRAWER chi tiết lô (SIL-699 r2: không còn ô chết), không editor, không ghi.
    const documentsTrigger = within(masterRow()).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
      .find((button) => button.getAttribute('data-cell-label') === 'Chứng từ');
    expect(documentsTrigger).toBeTruthy();
    fireEvent.click(documentsTrigger!);
    const drawer = await screen.findByRole('dialog');
    expectSharedLotFormInDrawer(drawer);
    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).toBeNull();
    expect(apiPut).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('SIL-1150: every cell control opens the one lot drawer — no per-cell dialog remains', { timeout: 15000 }, async () => {
    mockDrawerRoutes({ ...detail, summary: { ...detail.summary, cargoMode: 'LCL' } }, listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    const table = await screen.findByRole('table');
    const rowElement = masterRow();
    // One labelled trigger per data cell — the full-cell button the shared
    // drawer route rides (SIL-583 geometry law holds: the trigger is the
    // cell's only button).
    const cellLabels = ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú'];
    for (const label of cellLabels) {
      const trigger = within(rowElement).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
        .find((button) => button.getAttribute('data-cell-label') === label);
      expect(trigger, `cell ${label}`).toBeTruthy();
      const cell = trigger!.closest<HTMLElement>('th, td');
      expect(within(cell!).getAllByRole('button')).toEqual([trigger]);

      trigger!.focus();
      const focus = vi.spyOn(trigger!, 'focus');
      fireEvent.click(trigger!);
      const drawer = await screen.findByRole('dialog');
      expectSharedLotFormInDrawer(drawer);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(focus).not.toHaveBeenCalled();
      focus.mockRestore();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    // The row's Chi tiết opener opens the SAME drawer (one surface per row).
    fireEvent.click(masterRowDetailButton());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
    expect(within(table).getByText('Công ty Silver Sea')).toBeTruthy();
    // No per-cell edit dialog exists anywhere on the board.
    expect(screen.queryByRole('dialog', { name: /^Chỉnh sửa / })).toBeNull();
  });

  it('SIL-699: the FCL identity cell opens the lot DRAWER on the list — the list never navigates to /shipments-detail', async () => {
    // Spec I.4a: /shipments is a flat list + drawer. The lot detail opens as a
    // drawer ON the list; the separate /shipments-detail page is no longer a
    // target of the row (the fleet-wide ledger stays reachable from INSIDE
    // the drawer, one deliberate click away).
    mockDrawerRoutes(detail, listResponse([{ ...row, cargoMode: 'FCL' }]));
    renderPage();
    await screen.findByRole('table');
    // SIL-1150: the identity cell trigger shares the drawer route's name —
    // reach it through its cell label.
    fireEvent.click(within(masterRow()).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
      .find((button) => button.getAttribute('data-cell-label') === 'Khách hàng & nhà máy')!);

    const drawer = await screen.findByRole('dialog');
    expectSharedLotFormInDrawer(drawer);
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
    // No navigation to the separate page, and no lot write.
    expect(screen.queryByTestId('container-detail-page')).toBeNull();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('SIL-1150: the drawer form edits the lot in place — container fields are live inputs', async () => {
    mockDrawerRoutes(detail, listResponse([{ ...row, cargoMode: 'FCL' }]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(drawer));
    // The shared form's container row is EDITABLE inside the drawer — the
    // edit context, never a view sheet (KB §3.1.7).
    const number = within(drawer).getByDisplayValue('MSKU1234567') as HTMLInputElement;
    fireEvent.change(number, { target: { value: 'TLLU7654321' } });
    expect(number.value).toBe('TLLU7654321');
    // Editing in the drawer never navigates off the list.
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    expect(screen.queryByTestId('container-detail-page')).toBeNull();
  });

  // SIL-717's drawer "Thêm container" flow left with the SIL-1150 cutover (KB
  // §3.1.7): the drawer body is the shared lot form, whose container rows are
  // edited (and added) in place — the form's own behavior, pinned in the
  // create/edit suites. The pure copy/write law stays pinned in
  // features/shipments/cus/cusContainerAdd.test.ts.

  it('SIL-699: the drawer keeps the container ledger reachable (lot-scoped)', async () => {
    mockDrawerRoutes(detail, listResponse([{ ...row, cargoMode: 'FCL' }]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');

    // The list never navigates to /shipments-detail — but the ledger stays
    // one deliberate click away, from INSIDE the drawer.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Mở bảng chi tiết container' }));
    expect(await screen.findByTestId('container-detail-page')).toBeTruthy();
  });

  it('renders the lot-level schedule line when a lot has no container appointment groups (card 20260915_35)', async () => {
    // Lead ruling fork (a): the "Chỉnh sửa Lịch trình" dialog writes the
    // shipment-level closingAt/plannedReturnAt, but for FCL lots the readiness
    // rule counts only per-container appointments — the cell must still SHOW
    // the saved lot-level schedule instead of leaving "Chưa chốt lịch" alone.
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: { ...detail.summary, cargoMode: 'FCL' } })
        : Promise.resolve(listResponse([{ ...row, appointmentGroups: [], plannedReturnAt: '2026-09-19T13:03:00.000Z' }]))
    ));
    renderPage();
    await screen.findByRole('table');
    expect(await within(masterRow()).findByText('19/09/2026 20:03')).toBeTruthy();
  });

  // 15s, not the 5s default (card 20260928_196). This is the slowest test in
  // the file and it was never flaky — it is deterministically over the default
  // when run alone, and only passes at 5s when earlier tests in the same file
  // have already paid the first-render cost.
  //
  // SIL-1150 (QA 28/11): the per-cell dialogs are retired — the contract now
  // is ONE full-cell drawer-opening trigger per data cell, and the drawer
  // (not a dialog) is what every click opens.
  it('uses exactly one full-cell button per cell, and every click opens the drawer', { timeout: 15000 }, async () => {
    mockDrawerRoutes({ ...detail, summary: { ...detail.summary, cargoMode: 'LCL' } }, listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    await screen.findByRole('table');
    const cellLabels = ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú'];

    for (const label of cellLabels) {
      // Re-query the row each pass: opening the drawer fetches the detail and
      // the workspace may re-render the table body between iterations, so a
      // row node held across iterations can go stale.
      const rowElement = masterRow();
      const trigger = within(rowElement).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
        .find((button) => button.getAttribute('data-cell-label') === label);
      expect(trigger, `cell ${label}`).toBeTruthy();
      const cell = trigger!.closest<HTMLElement>('th, td');
      expect(cell).toBeTruthy();
      expect(within(cell!).getAllByRole('button')).toEqual([trigger]);
      // fireEvent.click does not apply the browser's native pointer-focus step.
      // Model it so this verifies that opening never refocuses the clicked cell.
      trigger!.focus();
      const focus = vi.spyOn(trigger!, 'focus');
      fireEvent.click(trigger!);
      expect(await screen.findByRole('dialog')).toBeTruthy();
      expect(focus).not.toHaveBeenCalled();
      focus.mockRestore();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(source).not.toContain('openQuickEditFromCell');
    expect(source).not.toContain('ReactMouseEvent');
    expect(source).not.toContain('onStartQuickEdit');
    expect(rowSource).toContain('data-cell-label="Chứng từ"');
    expect(css).toMatch(/\.cus-dashboard-cell--editable\s*\{[^}]*padding:\s*0 !important;/);
    // SIL-699 r2: no read-only cells remain — every data cell answers its
    // click (SIL-1150: always the lot drawer now), so the readonly geometry
    // rules are gone with the class.
    expect(css).not.toContain('cus-dashboard-cell--readonly');
    expect(css).toMatch(/\.cus-dashboard-cell--editable > \.cus-inline-trigger\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100%;/);
    expect(recordCss).toMatch(/tbody > tr > td::before\s*\{\s*display:\s*none;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*content:\s*attr\(data-cell-label\);/);
  });

  it('opens the lot drawer from the FCL cargo cell without navigating (SIL-1150, card 20260923_1)', async () => {
    mockDrawerRoutes(manageDetail, listResponse([{ ...row, cargoMode: 'FCL' }]));
    renderPage();
    await screen.findByRole('table');

    // SIL-1150: container composition lives in the drawer — the FCL cargo
    // cell opens the DRAWER (never a per-cell dialog, never a navigation).
    fireEvent.click(within(masterRow()).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
      .find((button) => button.getAttribute('data-cell-label') === 'Tổng quan hàng hóa')!);
    const drawer = await screen.findByRole('dialog');
    expectSharedLotFormInDrawer(drawer);
    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Tổng quan hàng hóa' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Quản lý container/ })).toBeNull();
    // The shared form carries the lot's container rows — edit context, not a
    // view sheet (KB §3.1.7).
    await waitFor(() => expect(within(drawer).getByDisplayValue('MSKU1234567')).toBeTruthy());
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    expect(screen.queryByTestId('container-detail-page')).toBeNull();
  });

  it('allows Xóa lô directly when deletable=true even with containers remaining, resolving Catch-22 deadlock (cards 351, 352)', { timeout: 15000 }, async () => {
    // Cards 351 & 352: Previously, "Xóa lô" required deleting all containers first,
    // but deleting the last container was blocked by "Lô hàng phải có ít nhất một container".
    // Now, clicking "Xóa lô" on a deletable lot immediately opens the confirmed delete modal
    // (cascading all containers), eliminating the deadlock.
    const containers = manageDetail.containers.map((line) => ({ ...line, tripId: null, tripStatus: null }));
    mockDrawerRoutes({ ...manageDetail, containers }, listResponse([{ ...row, cargoMode: 'FCL', operational: { ...row.operational, deletable: true } }]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;

    // Containers present (3 containers) → no deadlock; confirmed delete flow opens immediately
    fireEvent.click(within(drawer).getByRole('button', { name: 'Xóa lô' }));
    await waitFor(() => expect(document.querySelector('.cus-action-reason textarea')).toBeTruthy());
  });

  it('offers the lot-delete affordance to CUS on a deletable lot (card 071026204710)', async () => {
    // The write guard is `requireRoles(Role.CUS)`, so CUS is the role the
    // affordance is meant for.
    const deletable = { ...row.operational, deletable: true };
    mockDrawerRoutes({ ...manageDetail, containers: [] }, listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]));
    authState.user.role = Role.CUS;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    expect(within(drawer).getByRole('button', { name: 'Xóa lô' })).toBeTruthy();
  });

  it('offers the lot-delete affordance to ADMIN, which the delete route now admits (card 071026204710)', async () => {
    // The lead re-ruled this card: the delete is CUS **or** ADMIN — the route
    // (cus-workspace.routes.ts:344) and the service guard
    // (shipment-governance.service.ts:36) widened together. An earlier revision
    // of this file hid the button from ADMIN to match the then-current guard,
    // which would have left ADMIN able to delete via the API but unable to reach
    // the control at all.
    const deletable = { ...row.operational, deletable: true };
    mockDrawerRoutes({ ...manageDetail, containers: [] }, listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]));
    authState.user.role = Role.ADMIN;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    expect(within(drawer).getByRole('button', { name: 'Xóa lô' })).toBeTruthy();
  });

  it('hides the lot-delete affordance from roles the delete route refuses (card 071026204710)', async () => {
    // The point of gating on the role rather than on `operational.deletable`
    // alone: that flag is a data-state check (no live trip left on the lot) and
    // carries no role, so an unlisted role must not be offered the action.
    const deletable = { ...row.operational, deletable: true };
    mockDrawerRoutes({ ...manageDetail, containers: [] }, listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]));
    authState.user.role = Role.ACCOUNTANT;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    expect(within(drawer).queryByRole('button', { name: 'Xóa lô' })).toBeNull();
  });

  it('keeps Xóa lô reachable and states why a dispatched lot cannot be deleted (card 20260923_1)', async () => {
    // deletable:false = a trip already left on this lot (orderIssuedContainers /
    // direct live trip). The affordance stays visible and answers with the
    // guard's own reason — hiding the button left the operator with no reason.
    const dispatchedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      cargoMode: 'FCL',
      operational: { ...row.operational, deletable: false },
    };
    mockDrawerRoutes({ ...manageDetail, containers: [] }, listResponse([dispatchedRow]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;

    fireEvent.click(within(drawer).getByRole('button', { name: 'Xóa lô' }));

    expect(await screen.findByText(/Không thể xóa lô hàng đã có container được điều xe/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  // SIL-1307: the drawer showed "+ Khai chi phí" TWICE (Nhận diện lô card +
  // sticky footer, both wired SIL-748). One entry only — the sticky footer's
  // (the action cluster with Sửa); the card copy is gone.
  it('SIL-1307: renders exactly ONE [Khai chi phí] — the sticky footer\'s — for Ops role', async () => {
    authState.user.role = Role.OPS;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    const expenseButtons = within(drawer).getAllByRole('button', { name: /Khai chi phí/ });
    expect(expenseButtons).toHaveLength(1);
    expect(expenseButtons[0].className).toContain('cus-drawer-declare-expense');
    expect(expenseButtons[0].className).not.toContain('cus-lot-declare-expense');
  });

  it('SIL-1307: renders exactly ONE [Khai chi phí] for CUS role too, and it opens the form', async () => {
    authState.user.role = Role.CUS;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    const expenseButtons = within(drawer).getAllByRole('button', { name: /Khai chi phí/ });
    expect(expenseButtons).toHaveLength(1);
    expect(expenseButtons[0].className).toContain('cus-drawer-declare-expense');
    // Clicking mounts the shared declaration form (same path Ops drives).
    fireEvent.click(expenseButtons[0]);
    expect(await screen.findByRole('dialog', { name: 'Khai báo chi phí' })).toBeTruthy();
  });


  it('locked shipment cells answer with the lot DRAWER — no editor, no write (SIL-699 r2)', async () => {
    const lockedFieldAccess = Object.fromEntries(Object.entries(row.fieldAccess).map(([key, access]) => [
      key,
      { ...access, mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
    ])) as typeof row.fieldAccess;
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      cargoMode: 'LCL',
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      fieldAccess: lockedFieldAccess,
      operational: { ...row.operational, transportDateEditable: false },
    };
    mockDrawerRoutes(detail, listResponse([lockedRow]));

    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    // Every read-only cell trigger answers with the same drawer action name —
    // click each of them in turn (SIL-699 r2: no dead cells).
    const cellTriggers = within(rowElement).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' });
    expect(cellTriggers.length).toBeGreaterThanOrEqual(5);
    for (const cellTrigger of cellTriggers) {
      fireEvent.click(cellTrigger);
      // The read-only cell opens the lot DRAWER (the shared form) — never a
      // per-cell editor dialog.
      const drawer = await screen.findByRole('dialog');
      expectSharedLotFormInDrawer(drawer);
      expect(screen.queryByRole('dialog', { name: /^Chỉnh sửa / })).toBeNull();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(apiPut).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('opens shipment creation as the dedicated canonical page', async () => {
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô mới' }));
    expect(await screen.findByTestId('shipment-create-page')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Tạo lô hàng mới' })).toBeNull();
  });

  it('shows the create action only to shipment operators', async () => {
    authState.user.role = Role.ACCOUNTANT;
    const readerView = renderPage();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Tạo lô mới' })).toBeNull();
    readerView.unmount();

    authState.user.role = Role.MANAGER;
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Tạo lô mới' })).toBeTruthy();
  });

  it('opens the governed workflow controls from the row button', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Điều hành lô hàng')).toBeNull();
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    // SIL-1150: the body is the shared lot form — the review cards of the
    // retired CusLotView drawer are gone with the cutover.
    expectSharedLotFormInDrawer(dialog);
    // The workflow action rides the header as the ghost icon.
    expect(within(dialog).getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
  });

  it('shows the reason for a disabled consequential action without relying on a tooltip', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      action: {
        kind: 'LOCK' as const,
        label: 'Khóa lô',
        enabled: false,
        disabledReason: 'Xác nhận Kế toán đã hết hiệu lực.',
      },
    }]));

    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    // SIL-485: the header icon stays clickable; its accessible name already
    // carries the guard's reason (SR users hear why before acting), and the
    // click answers on the surface with the same reason (card 20260923_1
    // banner law) — no tooltip and no dead control.
    const blocked = within(dialog).getByRole('button', { name: /Khóa lô — Xác nhận Kế toán đã hết hiệu lực\./ });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(blocked);
    expect(await screen.findByRole('alert')).toHaveTextContent('Xác nhận Kế toán đã hết hiệu lực.');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('loads the lot detail lazily when the drawer opens — the shared form prefills from /shipments/:id', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/1');

    fireEvent.click(masterRowDetailButton());
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/1'));
    const dialog = await screen.findByRole('dialog');
    // SIL-1150 (KB §3.1.7): the drawer body is the SHARED lot form in edit
    // context — prefilled with this lot's identity and container row.
    expectSharedLotFormInDrawer(dialog);
    await waitFor(() => expect(within(dialog).getByDisplayValue('MSKU1234567')).toBeTruthy());
    expect(within(dialog).getByDisplayValue('BILL-12345')).toBeTruthy();
    expect(within(masterRow()).getByText('Maersk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
  });

  it('keeps a clear empty state when a shipment has no container rows', async () => {
    mockDrawerRoutes({ ...detail, containers: [] }, listResponse(), { ...editShipmentDetail(), containers: [] });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(dialog));
    // The shared form's own law: an FCL lot with zero persisted container
    // rows opens the editor with one EMPTY row (the create form's starting
    // shape) — never a dead sheet.
    const number = within(dialog).getByLabelText('Số container') as HTMLInputElement;
    expect(number.value).toBe('');
    expect(within(dialog).queryByText(/Chi phí không nhập tại đây/)).toBeNull();
  });

  it('a locked lot keeps the shared form disarmed and its escape closes the drawer (SIL-1150 cutover of the lock law)', async () => {
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      costLocked: true,
      activeLock: {
        id: 91,
        billingDocumentId: 44,
        activatedAt: '2026-08-12T02:00:00.000Z',
        activatedByName: 'CUS',
        reason: 'Đã chốt lô',
      },
      action: { kind: 'REQUEST_REOPEN', label: 'Đề nghị điều chỉnh', enabled: true, disabledReason: null },
    };
    mockDrawerRoutes({ ...detail, summary: lockedRow }, listResponse([lockedRow]), {
      ...editShipmentDetail(),
      accountingLock: { id: 91, reason: 'Đã chốt lô' },
    });

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    // The shared form's own lock law (SIL-171/SIL-1305): an accounting-locked
    // lot never arms the edit form — the surface explains and offers the way
    // back, the same copy the full edit page shows.
    expect(await within(dialog).findByText('Lô hàng đã bị khóa kế toán nên không thể sửa thông tin. Ghi chú vẫn sửa được ở Tổng quan.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
    // The reopen request still rides the header icon.
    expect(within(dialog).getByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeTruthy();
    // The escape closes the drawer and stays on the list — it never navigates.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
  });

  it('SIL-1150: the drawer IS the edit form — no "Sửa", no full-page navigation from the list', async () => {
    // The QA FAIL (build 61999831): the footer "Sửa" navigated to the full
    // page /shipments/:id/edit ("Một phần sửa = FAIL"). The drawer body is
    // the shared form now (KB §3.1.7 / K3.18) — the button is gone and no
    // entry point navigates off the list.
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(dialog));
    expect(within(dialog).queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    expect(screen.queryByTestId('container-detail-page')).toBeNull();
    expect(screen.queryByTestId('shipment-create-page')).toBeNull();
  });

  it('SIL-706: a non-editor (ACCOUNTANT) gets the shared form read-only — no save bar, no navigation', async () => {
    // The drawer body follows the edit route's law (App.tsx
    // `shipmentEditorOnly`): intake editors get the form in edit context,
    // everyone else the SAME shared form in view context (SIL-481) — the
    // SIL-706 ruling that non-editors never edit lot metadata survives the
    // cutover.
    authState.user.role = Role.ACCOUNTANT;
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Quay lại' })).toBeTruthy());
    expect(within(dialog).queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    authState.user.role = Role.CUS;
  });

  // ── SIL-1150 acceptance (KB §3.1.7 / K3.18, QA retest criteria 1–3) ────
  it('AC-1: clicking a non-interactive cell opens the drawer with the shared lot form for THAT lot (edit context)', async () => {
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findByRole('table');
    // TỔNG THU KHÁCH is a plain data cell (no trigger button) — a
    // non-interactive cell of the row answers with the drawer.
    const cell = masterRow().querySelector('td[data-label="Tổng thu Khách (Không Hóa đơn)"]')!;
    fireEvent.click(cell.querySelector('span')!);
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(drawer));
    // Edit context for THAT lot — the same ShipmentCreateWorkspace
    // /shipments/new renders, prefilled with lot 1's own container.
    await waitFor(() => expect(within(drawer).getByDisplayValue('MSKU1234567')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith('/shipments/1');
  });

  it('AC-2: [Chi tiết] opens the SAME drawer — URL stays /shipments, no full-page navigation', async () => {
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(drawer));
    // The list stays mounted underneath — no route change to any full page.
    expect(document.querySelector('.cus-dashboard-table')).toBeTruthy();
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    expect(screen.queryByTestId('shipment-create-page')).toBeNull();
    expect(screen.queryByTestId('container-detail-page')).toBeNull();
    // A row click opens the SAME one-drawer surface (one dialog, shared form).
    fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(masterRow()).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
      .find((button) => button.getAttribute('data-cell-label') === 'Chứng từ')!);
    const second = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(second));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('AC-3: interactive cell elements keep their own action — the row route never hijacks them', async () => {
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    // The container ledger's onOpenLotEditor guard rides the row route
    // verbatim: an interactive element (button/a/input/…) is never a
    // row-click drawer target.
    expect(rowSource).toContain(`closest('button, a, input, select, textarea, label, [role="button"]')`);
    // A synthetic interactive element inside a cell runs its OWN handler and
    // never bubbles into the row's drawer route.
    const cell = rowElement.querySelector('td[data-label="Tổng thu Khách (Không Hóa đơn)"]')!;
    const ownAction = vi.fn();
    const button = document.createElement('button');
    button.textContent = 'Ô riêng';
    button.addEventListener('click', ownAction);
    cell.appendChild(button);
    fireEvent.click(button);
    expect(ownAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The cell's own drawer trigger opens the drawer exactly once — its own
    // action, never double-fired through the row route.
    fireEvent.click(within(rowElement).getAllByRole('button', { name: 'Mở chi tiết lô hàng BILL-12345' })
      .find((b) => b.getAttribute('data-cell-label') === 'Chứng từ')!);
    const drawer = await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await waitFor(() => expectSharedLotFormInDrawer(drawer));
  });

  it('AC-4: the form Huỷ / Lưu thay đổi actions close the drawer and stay on the list', async () => {
    mockDrawerRoutes(detail, listResponse());
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(drawer));

    // Cancel (Huỷ) runs the shared form's OWN leave guard — the same law as
    // the full edit page (a form carrying values confirms the discard) — and
    // then closes the drawer. Never the old footer-Sửa navigation.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Huỷ' }));
    const leaveDialog = await screen.findByRole('dialog', { name: 'Bỏ thay đổi?' });
    fireEvent.click(within(leaveDialog).getByRole('button', { name: 'Bỏ thay đổi và rời trang' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();

    // Save (Lưu thay đổi) PATCHes the lot, closes the drawer, stays on the
    // list and announces the save on the page's notice channel.
    fireEvent.click(masterRowDetailButton());
    const reopened = await screen.findByRole('dialog');
    await waitFor(() => expectSharedLotFormInDrawer(reopened));
    fireEvent.click(within(reopened).getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({ expectedVersion: 3 })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('.cus-dashboard-table')).toBeTruthy();
    expect(screen.queryByTestId('shipment-edit-page')).toBeNull();
    expect(await screen.findByText('Đã lưu thay đổi lô hàng.')).toBeTruthy();
  });

  it('confirms the consequential lock action and closes the dialog after success', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Khóa lô' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/chế độ chỉ đọc/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/lock',
      expect.objectContaining({ expectedVersion: 3 }),
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reuses the same idempotency key for a retried lock action and rotates after success', async () => {
    // The mutation-identity law is caller-agnostic (the drawer form also
    // mints draft ids), so the pin reads the WIRE keys, not a uuid spy:
    // a retry reuses its key, a NEW action rotates it.
    apiPost.mockRejectedValueOnce(new Error('Mất kết nối'));

    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const firstKey = (apiPost.mock.calls[0]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    expect(await screen.findByText('Mất kết nối')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    const secondKey = (apiPost.mock.calls[1]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(secondKey).toBe(firstKey);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(masterRowDetailButton());
    const secondDrawer = await screen.findByRole('dialog');
    fireEvent.click(within(secondDrawer).getByRole('button', { name: 'Khóa lô' }));
    const secondDialog = await screen.findByRole('dialog');
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    const thirdKey = (apiPost.mock.calls[2]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(thirdKey).toBeTruthy();
    expect(thirdKey).not.toBe(firstKey);
  });

  it('uses an unbounded, sticky, keyboard-focusable dashboard without horizontal overflow', () => {
    expect(css).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*clip;/);
    // Re-measured 2026-09-28 at 1440px: the split follows what each column
    // actually holds, but the contract is unchanged — every column pins an
    // explicit percentage (table-layout: fixed only measures from the FIRST
    // rendered row, so an `auto` column clips real names on later rows) and the
    // shares still sum to 100% in EVERY band.
    const widthByColumn = new Map<string, number[]>();
    for (const [, column, percent] of css.matchAll(/col\.(cus-dashboard-col--[a-z-]+)\s*\{[^}]*width:\s*(\d+(?:\.\d+)?)%\s*;/g)) {
      widthByColumn.set(column, [...(widthByColumn.get(column) ?? []), Number(percent)]);
    }
    // The contract is structural, not numeric: every column pins an explicit
    // percentage in the default band AND in the ≥1024 band, and each band
    // sums to 100%. The individual percentages follow what each column
    // actually holds and are re-measured as the data shape moves (2026-09-28:
    // classification 9%→13%, notes 14%→10% after the header wrapped to four
    // lines and the notes column printed "Thêm ghi chú" on nearly every row;
    // SIL-919 24/11: 'Tổng thu Khách (Không Hóa đơn)' joins the grid and
    // takes 11%, the other seven scaled to 89% of their measured shares).
    expect(widthByColumn.size).toBe(8);
    const widthsIn = (text: string) => [...text.matchAll(/col\.(cus-dashboard-col--[a-z-]+)\s*\{[^}]*width:\s*(\d+(?:\.\d+)?)%\s*;/g)]
      .map(([, , percent]) => Number(percent));
    const wideBandStart = css.indexOf('@media (min-width: 1024px)');
    expect(wideBandStart).toBeGreaterThan(-1);
    const narrowBand = widthsIn(css.slice(0, wideBandStart));
    const wideBand = widthsIn(css.slice(wideBandStart));
    expect(narrowBand).toHaveLength(8);
    expect(wideBand).toHaveLength(8);
    expect(narrowBand.reduce((sum, percent) => sum + percent, 0)).toBeCloseTo(100, 2);
    expect(wideBand.reduce((sum, percent) => sum + percent, 0)).toBeCloseTo(100, 2);
    expect(css).not.toMatch(/\.cus-dashboard-viewport\s*\{[^}]*max-height/);
    expect(css).toMatch(/\.cus-dashboard-table\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-dashboard-table thead th\s*\{[\s\S]*?position:\s*sticky;/);
    expect(recordCss).not.toMatch(/grid-template-columns:\s*(?:76px|98px|minmax\(112px)/);
    expect(responsiveCss).not.toContain('#root .cus-dashboard-table');
    // SIL-1150 (QA 28/11): the quick-edit modal field metrics are retired
    // with the modal.
    expect(css).not.toContain('cus-quick-edit-modal');
    expect(source).toContain('tabIndex={0}');
    expect(rowSource).toContain('aria-haspopup="dialog"');
    expect(source).not.toContain('cus-mobile-list');
    expect(source).not.toContain('MASTER_COLUMN_PREFERENCES_KEY');
  });

  it('keeps pagination in the table scroll region so it is reachable without separately scrolling the page', () => {
    expect(source).toMatch(/<div className="cus-dashboard-viewport"[\s\S]*?<Pagination page=\{page\}/);
  });

  it('keeps worksheet controls and primary row values on one compact typography rhythm', () => {
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page\s*\{[^}]*width:\s*min\(100%, 1800px\);[^}]*max-width:\s*1800px;[^}]*margin-inline:\s*auto;/);
    expect(css).toMatch(/\.cus-workspace\.cus-workspace--worksheet\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/);
    // Row 2 IS the shared bar (card 20260927_151) — the page keeps its
    // controls, the bar owns the layout (the former `WorkboardFilters` host and
    // its `.list-filter-bar__pair` wrapper are deleted, card 20260927_152).
    expect(source).toContain("placeholder: 'Bill, Book, Cont, Tờ khai...'");
    expect(source).toContain('<ListFilterBar');
    expect(source).toContain('<DateRangeFields');
    expect(source).toContain('<InlineLabelSelect');
    expect(source).toContain('<SearchableMultiSelect');
    expect(css).not.toMatch(/\.cus-worksheet-toolbar \.shipment-uui-field \[data-label\]\s*\{[^}]*margin-bottom:/);
    expect(css).not.toMatch(/\.shipment-uui-control__input\s*\{[^}]*(?:height|min-height):/);
    // Card 20260922_42 dead-chrome pin: the self-made toolbar family is gone.
    expect(css).not.toMatch(/cus-worksheet-toolbar|cus-search-field|cus-worksheet-advanced|cus-advanced-toggle|cus-active-filter-summary/);
    // Card 20260926_47: the create action rides the Row 1 actions cluster.
    expect(source).toMatch(/\{canCreateShipment && \(\s*<UUIButton/);
    // 2026-09-18 relocation ruling: the copy affordance replaces the ordinal on
    // hover — same top-right slot, never over the container number.
    // (SIL-485: the editable ledger retired, so its cell/copy rules went with
    // it; the row-level multiline rhythm below is the surviving contract.)
    // Card 20260926_47: export rides the Row 1 action cluster; the rail's
    // export class is retired from source and CSS.
    expect(source).toContain('shipments-control__export');
    expect(source).not.toContain('cus-workspace-summary__export');
    expect(css).not.toContain('cus-workspace-summary__export');
    expect(css).toMatch(/\.cus-multiline-cell--mono strong\s*\{[^}]*font-size:\s*var\(--ops-table-primary-size\);/);
    expect(rowSource).toContain('cus-cargo-summary__containers');
    expect(rowSource).toContain('formatWeight');
    expect(css).toMatch(/\.cus-multiline-cell \.cus-cargo-summary__containers\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.cus-multiline-cell \.cus-cargo-summary__metrics\s*\{[^}]*white-space:\s*normal;/);
    // SIL-1150 (QA 28/11): the per-cell quick-edit modal is retired — its
    // field-grid stylesheet block is gone with the host component.
    expect(css).not.toContain('cus-quick-edit-modal');
    expect(css).toMatch(/@media \(max-width: 999px\)[\s\S]*?\.cus-dashboard-table tbody > tr\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('adapts the drawer to its actual canvas instead of only the browser width', () => {
    expect(css).toMatch(/\.cus-shipment-drawer\s*\{[\s\S]*?container-name:\s*shipment-drawer;[\s\S]*?container-type:\s*inline-size;/);
    // SIL-485: the review cards reflow on the drawer's own canvas — the fact
    // grids step 4→2→1 and the bottom card pair stacks.
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-lot-fact-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 760px\)[\s\S]*?\.cus-lot-cards-row\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/@container shipment-drawer \(max-width: 480px\)[\s\S]*?\.cus-lot-fact-grid,\s*\n\s*\.cus-lot-fact-grid--two\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('keeps the shipment drawer flat, compact, and honest about blocked actions', () => {
    expect(css).toMatch(/\.cus-shipment-drawer\s*\{[^}]*background:\s*var\(--surface\);/);
    // SIL-485: the body is the sage canvas with white cards; the card band is
    // the next surface rung, and the sheet table collapses like the page's.
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__body\s*\{[^}]*background:\s*var\(--surface-2\);/);
    expect(css).toMatch(/\.cus-lot-card__band\s*\{[^}]*background:\s*var\(--surface-3\);/);
    expect(css).toMatch(/\.cus-lot-card\s*\{[^}]*border-radius:\s*var\(--radius-field\);/);
    expect(css).toMatch(/\.cus-lot-table\s*\{[^}]*border-collapse:\s*collapse;/);
    // Blocked semantics stay on the surface: the banner law (card 20260923_1)
    // is the only blocked-action presentation — no dead affordances.
    expect(css).toMatch(/\.cus-drawer-lot-error\s*\{[^}]*color:\s*var\(--danger-text\);/);
    expect(css).not.toMatch(/cus-drawer-workflow|cus-container-ledger|cus-container-table/);
    expect(source).not.toContain('cus-drawer-workflow');
    expect(source).not.toContain('cus-container-ledger');
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__foot\s*\{[^}]*background:\s*var\(--surface\);/);
    expect(css).not.toMatch(/\.cus-shipment-drawer \.drawer__body\s*\{[^}]*padding:\s*0 0 \d+px/);
  });

  it('normalizes the drawer chrome to the SIL-480/SIL-483 consult spec', () => {
    // Owner spec 25/10 (consult px table, tickets SIL-480 + SIL-483): header
    // bar 56px, title 18/24/600 truncated, close 32×32 with a 16px icon,
    // content inset 20/24 with the first section 16px below the header
    // divider. Catalog: Untitled UI PRO application/slideout-menus.
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__head\s*\{[^}]*min-height:\s*calc\(56px \+ env\(safe-area-inset-top, 0px\)\);/);
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__head\s*\{[^}]*align-items:\s*center;/);
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__title\s*\{[^}]*font-size:\s*18px;[^}]*line-height:\s*24px;[^}]*font-weight:\s*var\(--fw-semibold\);[\s\S]*?text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__close\s*\{[^}]*width:\s*32px;[\s\S]*?min-height:\s*32px;/);
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__close svg\s*\{[^}]*width:\s*16px;/);
    // SIL-483 supplements 3+4 (owner 25/10): the lot-bar tabs are GONE — the
    // drawer opens straight into the content; Xóa lô is the header ghost
    // trash (danger hover) and the /shipments/:id Link is removed. The
    // segmented lot control must not come back.
    expect(css).not.toMatch(/\.cus-drawer-lot-bar|\.cus-drawer-lot-seg/);
    expect(source).not.toContain('cus-drawer-lot-bar');
    expect(source).not.toContain('cus-drawer-lot-seg');
    expect(source).toContain('cus-drawer-lot-delete');
    expect(css).toMatch(/\.cus-shipment-drawer \.cus-drawer-lot-delete:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--danger-soft\);[^}]*color:\s*var\(--overdue-text\);/);
    // SIL-483: the drawer width ladder + expand toggle (Maximize2 ghost beside
    // close; expanded = full viewport).
    expect(css).toMatch(/@media \(min-width: 1280px\)\s*\{\s*\.cus-shipment-drawer\s*\{[^}]*width:\s*min\(92vw, 1200px\);/);
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\.cus-shipment-drawer\s*\{[^}]*width:\s*min\(96vw, 960px\);/);
    expect(css).toMatch(/\.cus-shipment-drawer\.drawer--expanded\s*\{[^}]*width:\s*100vw;/);
    expect(uiSource).toContain('expandable');
    expect(uiSource).toContain('Maximize2');
    // Content band: 16px below the divider, 20/24 inset owned by the body.
    expect(css).toMatch(/\.cus-shipment-drawer \.drawer__body\s*\{[^}]*padding:\s*16px 24px 20px;/);
    // SIL-485: the card band h3 and the body micro-labels carry the
    // uppercase-muted section-label contract the workflow heading used to own.
    expect(css).toMatch(/\.cus-lot-card__band h3\s*\{[^}]*font-size:\s*var\(--text-label-size, 13px\);/);
    expect(css).toMatch(/\.cus-lot-card__band h3\s*\{[^}]*font-weight:\s*var\(--fw-semibold\);/);
    expect(css).toMatch(/\.cus-lot-microlabel\s*\{[^}]*text-transform:\s*uppercase;/);
    expect(css).toMatch(/\.cus-lot-microlabel\s*\{[^}]*letter-spacing:\s*0\.05em;/);
    expect(css).toMatch(/\.cus-lot-microlabel\s*\{[^}]*color:\s*var\(--ink-3\);/);
  });

  it('uses distinct semantic colors for running and locked shipments', () => {
    expect(cusUtilsSource).toMatch(/\[ShipmentCusBucket\.RUNNING\]:\s*'var\(--accent\)'/);
    expect(cusUtilsSource).toMatch(/\[ShipmentCusBucket\.LOCKED\]:\s*'var\(--slate-4\)'/);
    // Card 20260922_27 (operator): the status is TEXT ONLY — modifiers carry
    // semantic text color, never a pill body (no fill, no border, no radius).
    expect(css).toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*color:\s*var\(--slate-4\);/);
    expect(css).not.toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*background/);
    expect(css.indexOf('.cus-workflow-badge {')).toBeGreaterThan(-1);
    expect(css.indexOf('.cus-workflow-badge {')).toBeLessThan(css.indexOf('.cus-workflow-badge--new'));
    expect(css).toMatch(/\.cus-workflow-badge--new\s*\{[^}]*color:\s*var\(--ink-2\);/);
    expect(css).not.toMatch(/\.cus-workflow-badge\s*\{[^}]*border-radius:\s*999/);
  });

  it('emits the seven-column grouped dashboard schema from the XLSX export', async () => {
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const exportColumns = downloadCSV.mock.calls[0]?.[1] as string[];
    expect(exportColumns).toEqual([
      'Khách hàng & nhà máy',
      'Chứng từ',
      'Phân loại & hãng tàu',
      'Tổng quan hàng hóa',
      'Lịch trình & điều xe',
      'Ghi chú',
      'Trạng thái',
    ]);
    const rows = downloadCSV.mock.calls[0]?.[2] as Array<Array<string | number>>;
    // Column 6 (index 5) = "Ghi chú" — should contain the customer-facing note.
    expect(rows[0]?.[5]).toContain('Giao buổi sáng');
  });

  it('shows the specific highest-priority exception instead of a generic attention flag', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByTitle('Lỗ')).toBeTruthy();
    expect(screen.queryByText('Cần kiểm tra')).toBeNull();
  });

  it('prioritizes a danger signal over earlier schedule warnings in the grid and export', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      transportDate: null,
      plannedReturnAt: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const },
    }]));

    renderPage();
    await screen.findByRole('table');
    expect(screen.getByTitle('Lỗ')).toBeTruthy();
    expect(screen.queryByText('Chờ chốt lịch')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const rows = downloadCSV.mock.calls[0]?.[2] as Array<Array<string | number>>;
    expect(rows[0]?.[6]).toContain('Lỗ');
    expect(rows[0]?.[6]).not.toContain('Chờ chốt lịch');
  });

  it('does not flag an ordinary disabled no-op row as an exception', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      finance: { ...row.finance, isLoss: false, hasPendingRecovery: false },
      action: { kind: 'NONE' as const, label: '', enabled: false, disabledReason: null },
    }]));

    renderPage();
    await screen.findByRole('table');
    expect(screen.queryByText('Cần kiểm tra')).toBeNull();
    expect(document.querySelector('.cus-attention-label')).toBeNull();
  });

  it('renders the combined-cargo marker in the classification cell', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, isCombined: true }]));

    renderPage();
    await screen.findByRole('table');
    expect(within(masterRow()).getByText('Đóng kết hợp')).toBeTruthy();
  });

  it('keeps classification tags compact and wraps the shipping-line label', () => {
    expect(rowSource).toContain('className="cus-multiline-cell cus-classification"');
    expect(rowSource).toContain("className={item.shippingLineName ? 'cus-classification__shipping-line' : 'cus-classification__shipping-line cus-empty'}");
    expect(css).toMatch(/\.cus-multiline-cell \.cus-classification__shipping-line\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    // No min-height floor (2026-09-28): a placeholder-only cell used to reserve
    // 44px inside a 110px row, and stretching the row to 1fr stranded the
    // direction badge at the bottom of tall cells. The two rows are now
    // content-sized (`auto auto`) and packed to the top.
    expect(css).toMatch(/\.cus-multiline-cell\.cus-classification\s*\{[^}]*grid-template-areas:[\s\S]*?"shipping-line shipping-line"[\s\S]*?"combined direction";[^}]*grid-template-rows:\s*auto auto\s*;[^}]*align-content:\s*start\s*;/);
    expect(css).not.toMatch(/\.cus-multiline-cell\.cus-classification\s*\{[^}]*min-height\s*:/);
    expect(css).toMatch(/\.cus-classification \.cus-direction-badge\s*\{[^}]*grid-area:\s*direction;[^}]*align-self:\s*end;[^}]*justify-self:\s*end;/);
    expect(css).toMatch(/\.cus-direction-badge,[\s\S]*?\.cus-combined-tag\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*min-height:\s*22px;/);
  });

  // Card 20260927_67 (5). The three-way reading of the CUS surface:
  // solid grey = neutral/empty, outlined = identifier, peach = warning.
  it('reads static classifications as plain text, reserving peach for warnings', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
    // Xuất/Nhập and Đóng kết hợp are plain classifications per the owner session ruling.
    // The two direction modifiers share one rule, so match the whole block.
    const outlineBlock = css.match(/\.cus-direction-badge--import,[\s\S]*?\.cus-direction-badge--export[\s\S]*?\{[^}]*\}/)?.[0] ?? '';
    expect(outlineBlock).toMatch(/border:\s*0/);
    expect(outlineBlock).toMatch(/background:\s*transparent/);
    expect(css).toMatch(/\.cus-combined-tag\s*\{[^}]*border:\s*0/);
    // The combined tag used to be a solid peach fill, which spent the warning
    // colour on a harmless category. Peach now means warning and nothing else.
    const combined = css.match(/\.cus-combined-tag\s*\{[^}]*\}/)?.[0] ?? '';
    expect(combined).not.toMatch(/background:\s*var\(--warning-soft\)/);
    expect(combined).not.toMatch(/background:\s*var\(--danger-soft\)/);
    // The real warning badge keeps it, so the rule still has a home —
    // SIL-485: the drawer head chips carry the amber/mint/danger soft fills.
    expect(css).toMatch(/\.cus-lot-chip--amber\s*\{[^}]*background:\s*var\(--warning-soft\)/);
    expect(css).toMatch(/\.cus-lot-chip--mint\s*\{[^}]*background:\s*var\(--success-soft\)/);
    expect(css).toMatch(/\.cus-lot-chip--danger\s*\{[^}]*background:\s*var\(--danger-soft\)/);
  });

  it('renders every --warn consumer off the real token, not a raw hex fallback', () => {
    // --warn was undeclared until card 20260927_67, so each of its 7 call sites
    // fell back to a different hex and #d97706 landed at 3.19:1 on white. The
    // alias in tokens.css is the heal; this is what stops the fallbacks coming
    // back and quietly re-fragmenting the colour.
    for (const f of [
      'src/styles/tokens.css',
      'src/pages/ShipmentsPage.css',
      'src/pages/DriverTripDetailPage.css',
      'src/pages/OpsOrdersPage.css',
      'src/pages/clerk/ClerkShipmentCreatePage.css',
    ]) {
      const text = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(text, f).not.toMatch(/var\(--warn,\s*#/);
    }
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--warn:\s*var\(--warning-text\);/);
  });

  it('shows the full customer company name with compact wrapping instead of an ellipsis', async () => {
    const longCompanyName = 'CÔNG TY TNHH THƯƠNG MẠI VÀ VẬN TẢI LONG MINH';
    apiGet.mockResolvedValue(listResponse([{ ...row, customerName: longCompanyName }]));

    renderPage();
    const companyName = await screen.findByText(longCompanyName);

    expect(companyName.className).toContain('cus-customer-name');
    expect(css).toMatch(/\.cus-multiline-cell \.cus-customer-name\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);[^}]*line-height:\s*var\(--ops-table-supporting-line-height\);[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.cus-multiline-cell strong\s*\{[^}]*font-size:\s*var\(--ops-table-primary-size\);/);
  });

  it('wraps identity factory/route lines fully — no line clamp (ticket 18/11)', () => {
    // ticket 18/11 (spec Chương 4 §4.1.3 cấm cắt chữ) supersedes card
    // 191026181942's 2-line clamp: 'Chưa có tuyến đường' / 'Chưa có tờ khai'
    // and long factory/route lines wrap fully on the base __multiline-cell
    // span law; NameCell keeps the full value accessible (title + aria-label
    // + focusable reveal).
    expect(css).not.toMatch(/\.cus-dashboard-cell--identity \.cus-multiline-cell span\s*\{[^}]*-webkit-line-clamp/);
    expect(css).not.toMatch(/\.cus-dashboard-cell--identity \.cus-multiline-cell span\s*\{[^}]*overflow:\s*hidden/);
    const row = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');
    expect(row).toContain('Chưa có tuyến đường');
    expect(row).toContain('Chưa có tờ khai');
    expect(row).toMatch(/<NameCell name=\{item\.factoryName\} \/>/);
    expect(row).toMatch(/<NameCell name=\{item\.routeName \|\| item\.deliveryLocation\} \/>/);
  });

  it('CUS-OVERVIEW-01 stacks the label above the value and wraps complete identifiers without inherited fixed columns', () => {
    // QA 28/11 (P2 sweep): the eyebrow label owns its OWN line above the
    // value run — the inline run fused label and value into "HÀNG HÓA
    // Chưa có hàng / hóa", which read as one sentence. The
    // `grid-template-columns: auto minmax(0, 1fr)` label/value grid it
    // replaced stays gone — re-measured 2026-09-28 at 390px it gave the
    // label ~70px and left the value a ~100px strip, so "Chưa có Bill/Book"
    // wrapped to two lines and the card measured 241px.
    expect(recordCss).not.toMatch(/\.cus-inline-trigger:has\(\.cus-multiline-cell\)/);
    // The fact stack is inline (after the block label), so the value run
    // breaks where its children say, not on a grid (`display: grid` here is
    // what kept every card two lines taller than the text needs).
    expect(recordCss).toMatch(/\.cus-dashboard-table \.cus-multiline-cell\s*\{[^}]*display\s*:\s*inline\s*;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*display\s*:\s*block\s*;[^}]*width\s*:\s*auto\s*;[^}]*margin\s*:\s*0 0 2px\s*;[^}]*content\s*:\s*attr\(data-cell-label\)\s*;/);
    expect(recordCss).toMatch(/\.cus-multiline-cell span\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(recordCss).not.toMatch(/grid-template-columns:\s*(?:76px|98px|minmax\(112px)/);
    expect(responsiveCss).not.toContain('#root .cus-dashboard-table');
  });

});


describe('Loại lô filter — ad-hoc tri-state (20260917_12)', () => {
  it('URL adHoc=true refetches the workboard list with isAdHoc=true', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, totalPages: 0, filterOptions: { customers: [] } });
    renderPage('/shipments?adHoc=true');
    await waitFor(() => {
      const url = String(apiGet.mock.lastCall?.[0] ?? '');
      expect(url).toContain('isAdHoc=true');
    });
  });

  it('URL adHoc=false refetches with isAdHoc=false (catalog flow only)', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, totalPages: 0, filterOptions: { customers: [] } });
    renderPage('/shipments?adHoc=false');
    await waitFor(() => {
      const url = String(apiGet.mock.lastCall?.[0] ?? '');
      expect(url).toContain('isAdHoc=false');
    });
  });
});


// MemoryRouter keeps history in memory — jsdom's location never moves. A
// sibling probe component prints the live search string so tests can pin the
// URL contract (cards _47/_48: click = URL state) directly.
function UrlProbe() {
  const { search } = useLocation();
  return <div data-testid="url-probe" data-search={search} />;
}
function renderTabsPage(path = '/shipments') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/shipments" element={<><UrlProbe /><ShipmentsPage /></>} />
            <Route path="/shipments/new" element={<div data-testid="shipment-create-page">Tạo lô hàng mới</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Card 20260926_47 — Row 1: title + segmented status tabs + actions', () => {
  // The fixture quartet: one row per readiness dimension, one row in no tab.
  const scheduleWaitingRow: ShipmentCusWorkspaceListItem = {
    ...row,
    id: 2,
    operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE', vehicleReadiness: 'READY' },
    accountingConfirmation: { ...row.accountingConfirmation, status: 'CONFIRMED' as const },
  };
  const vehicleWaitingRow: ShipmentCusWorkspaceListItem = {
    ...row,
    id: 3,
    operational: { ...row.operational, scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'WAITING_PLATE' },
    accountingConfirmation: { ...row.accountingConfirmation, status: 'CONFIRMED' as const },
  };
  const accountingWaitingRow: ShipmentCusWorkspaceListItem = {
    ...row,
    id: 4,
    operational: { ...row.operational, scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY' },
    accountingConfirmation: { ...row.accountingConfirmation, status: 'PENDING' as const },
    activeLock: null,
  };
  const tabbedItems = [row, scheduleWaitingRow, vehicleWaitingRow, accountingWaitingRow];

  it('renders Row 1 as one baseline: title, tabs and actions share it; the summary strip is gone', async () => {
    apiGet.mockResolvedValue(listResponse(tabbedItems));
    renderPage();
    await screen.findByRole('table');
    // The old decision rail is dead — its four numbers live in the tabs now.
    expect(document.querySelector('.cus-workspace-summary')).toBeNull();
    // One 36px primary row carries the heading + actions; export is one
    // of its actions. On a phone the heading is the a11y-tree copy only — the
    // topbar prints the visible title (the same split `PageHeader` uses).
    expect(document.querySelector('.shipments-control__row--primary')).toBeTruthy();
    const primaryRow = document.querySelector('.shipments-control__row--primary') as HTMLElement;
    expect(primaryRow.querySelector('h1')?.textContent).toBe('Tổng quan lô hàng');
    expect(document.querySelector('.list-filter-bar [role="tablist"]')).toBeTruthy();
    expect(Array.from(primaryRow.querySelectorAll('button')).some((b) => b.textContent?.includes('Tải XLSX'))).toBe(true);
    expect(primaryRow.textContent).toContain('Tạo lô mới');
    // The 36px lock is CSS law, not accident.
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
    expect(css).toMatch(/\.shipments-control__row--primary\s*\{[^}]*min-height:\s*36px/);
    // …and at ≤640px that heading steps aside for the topbar's copy, so the
    // screen name is printed exactly once.
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.shipments-control__title\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/);
    expect(responsiveCss).not.toContain('app--page-own-heading');
    // The old PageHeader action slot is gone from the page source.
    expect(source).not.toContain('PageHeader');
  });

  it('renders EVERY status tab with its full-set count — the API numbers, never the loaded page', async () => {
    // Card 081026093520: the page holds 4 rows (one per bucket) while the
    // filtered set holds 72 — the numerals wear the FULL-set statusCounts the
    // API reports, each sizing exactly the rows its tab's lens reveals.
    apiGet.mockResolvedValue({
      ...listResponse(tabbedItems),
      total: 72,
      totalPages: 4,
      statusCounts: { needsSchedule: 31, needsVehicle: 20, waitingAccounting: 3 },
    });
    renderPage();
    const tablist = await screen.findByRole('tablist', { name: 'Trạng thái lô hàng' });
    const all = within(tablist).getByRole('tab', { name: /Tất cả/ });
    expect(all.getAttribute('aria-selected')).toBe('true');
    // Exact text mapping: label + the statusCounts numeral for that tab id.
    expect(all.textContent).toBe('Tất cả72');
    expect(within(tablist).getByRole('tab', { name: /Chưa chốt lịch/ }).textContent).toBe('Chưa chốt lịch31');
    expect(within(tablist).getByRole('tab', { name: /Chờ điều xe/ }).textContent).toBe('Chờ điều xe20');
    expect(within(tablist).getByRole('tab', { name: /Chờ đối soát/ }).textContent).toBe('Chờ đối soát3');
    // Never the loaded page's own slice (which would read 1/1/1 here)…
    expect(document.querySelectorAll('tr.cus-dashboard-row').length).toBe(tabbedItems.length);
    // …and never a page-scope suffix.
    expect(tablist.textContent).not.toContain('(trang)');
  });

  it('shows 0, never blank, when a status bucket is empty', async () => {
    apiGet.mockResolvedValue({
      ...listResponse([]),
      total: 0,
      totalPages: 0,
      statusCounts: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0 },
    });
    renderPage();
    const tablist = await screen.findByRole('tablist', { name: 'Trạng thái lô hàng' });
    for (const label of ['Tất cả', 'Chưa chốt lịch', 'Chờ điều xe', 'Chờ đối soát']) {
      const tab = within(tablist).getByRole('tab', { name: new RegExp(label) });
      expect(tab.textContent).toBe(`${label}0`);
    }
  });

  it('keeps the counts consistent when the base search changes', async () => {
    apiGet.mockImplementation((url: string) => Promise.resolve(url.includes('searchSuffix=MSCU')
      ? {
        ...listResponse(tabbedItems),
        total: 4,
        totalPages: 1,
        statusCounts: { needsSchedule: 2, needsVehicle: 1, waitingAccounting: 1 },
      }
      : {
        ...listResponse(tabbedItems),
        total: 72,
        totalPages: 4,
        statusCounts: { needsSchedule: 31, needsVehicle: 20, waitingAccounting: 3 },
      }));
    renderPage();
    const tablist = await screen.findByRole('tablist', { name: 'Trạng thái lô hàng' });
    expect(within(tablist).getByRole('tab', { name: /Chưa chốt lịch/ }).textContent).toBe('Chưa chốt lịch31');
    const input = screen.getByLabelText('Tìm lô hàng');
    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=MSCU6639870')));
    // The strip re-numerals from the SAME response the filtered rows ride.
    await waitFor(() => {
      expect(within(tablist).getByRole('tab', { name: /Tất cả/ }).textContent).toBe('Tất cả4');
    });
    expect(within(tablist).getByRole('tab', { name: /Chưa chốt lịch/ }).textContent).toBe('Chưa chốt lịch2');
    expect(within(tablist).getByRole('tab', { name: /Chờ điều xe/ }).textContent).toBe('Chờ điều xe1');
    expect(within(tablist).getByRole('tab', { name: /Chờ đối soát/ }).textContent).toBe('Chờ đối soát1');
  });

  it('clicking a readiness tab writes ?status= and slices the table without a reload', async () => {
    apiGet.mockResolvedValue({ ...listResponse(tabbedItems), total: 72, totalPages: 4 });
    renderTabsPage();
    await screen.findByRole('table');
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Trạng thái lô hàng' })).getByRole('tab', { name: /Chờ điều xe/ }));
    // URL state carries the slice; the server list is untouched (client-side
    // slice of the loaded page — the API has no status param).
    await waitFor(() => {
      expect(document.querySelector('[data-testid="url-probe"]')?.getAttribute('data-search')).toContain('status=needsVehicle');
    });
    const bodyRows = document.querySelectorAll('tr.cus-dashboard-row');
    expect(bodyRows.length).toBe(1);
    expect(bodyRows[0].textContent).toContain('BILL-12345');
  });

  it('the status slice coexists with server filters and resets with Xóa lọc', async () => {
    apiGet.mockResolvedValue({ ...listResponse(tabbedItems), total: 72, totalPages: 4 });
    renderTabsPage('/shipments?direction=EXPORT&status=waitingAccounting');
    await screen.findByRole('table');
    // Server filter still hits the API; the status tab slices the page locally.
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));
    expect(document.querySelectorAll('tr.cus-dashboard-row').length).toBe(1);
    expect(within(screen.getByRole('tablist', { name: 'Trạng thái lô hàng' })).getByRole('tab', { name: /Chờ đối soát/ }).getAttribute('aria-selected')).toBe('true');
    // Xóa lọc owns every local param it guards, including the new one.
    expect(source).toContain("'status'");
  });

  it('readiness counts wear semantic pills: amber Chờ điều xe, info Chờ đối soát', async () => {
    apiGet.mockResolvedValue(listResponse(tabbedItems));
    renderPage();
    await screen.findByRole('tablist', { name: 'Trạng thái lô hàng' });
    const tabsCss = readFileSync(resolve(process.cwd(), 'src/design-system/Tabs.css'), 'utf8');
    expect(tabsCss).toMatch(/\.ds-tabs__count--warning/);
    expect(tabsCss).toMatch(/\.ds-tabs__count--info/);
    // The page binds the tones: amber on Chờ điều xe, info on Chờ đối soát.
    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
    expect(pageSource).toMatch(/id: 'needsVehicle',[\s\S]{0,220}?countTone: 'warning'/);
    expect(pageSource).toMatch(/id: 'waitingAccounting',[\s\S]{0,220}?countTone: 'info'/);
  });
});


describe('Card 20260926_48 — Row 2: compact filter toolbar + date-range + chips + Kế hoạch', () => {
  it('renders one uniform toolbar: search + two date fields + presets + inline criteria', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderPage();
    await screen.findByRole('table');
    // Row 2 IS the shared ListFilterBar (card 20260927_152) — one bar layout
    // for every list page, so this toolbar can never drift again.
    expect(document.querySelector('.cus-workspace .filter-bar.list-filter-bar')).toBeTruthy();
    // Search: placeholder per spec. No shortcut badge renders (CHIEF
    // 2026-09-27: no control may print shortcut key text).
    const search = screen.getByLabelText('Tìm lô hàng') as HTMLInputElement;
    expect(search.placeholder).toBe('Bill, Book, Cont, Tờ khai...');
    expect(document.querySelector('.shipments-control__kbd')).toBeNull();
    // Dates: two INDEPENDENT Từ ngày / Đến ngày fields (CHIEF 2026-09-27:
    // "I dont want daterangepicker" — no merged trigger, no dual-calendar
    // popover), plus the quick ranges as a visible segmented control.
    expect(screen.getByRole('group', { name: 'Khoảng ngày giao' })).toBeTruthy();
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hôm nay' })).toBeTruthy();
    // The quick ranges ride the bar's own `presets` slot, not the page's.
    expect(document.querySelector('.filter-bar__presets .shipments-control__date-presets')).toBeTruthy();
    // Chip selects: label inside, defaults per spec — INLINE, because the
    // measured mode only folds them when the strip cannot hold two rows.
    expect(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Loại: Tất cả' })).toBeTruthy();
    // Kế hoạch combobox present (multi-select with chips).
    expect(document.querySelector('.shipments-control__plan button[aria-haspopup]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
    // Xóa lọc hidden while filters are default.
    expect(screen.queryByRole('button', { name: 'Xóa lọc' })).toBeNull();
    // The page contributes sizes only — the bar owns the layout.
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
    expect(css).not.toMatch(/\.shipments-control__row--filters/);
    expect(css).not.toMatch(/\.shipments-control__search/);
    // Card 20260927_152: the page declares ONE filter width (the combobox cap);
    // the from/to group and the chip floors moved into the shared sheets.
    expect(css).not.toMatch(/\.shipments-control__range\s*\{/);
    expect(css).not.toMatch(/\.shipments-control__chip\s*\{/);
    expect(css).toMatch(/\.shipments-control__plan\s*\{[^}]*max-width:\s*320px/);
  });

  it('the four 1-click ranges are visible controls and apply one range to the URL', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderPage();
    await screen.findByRole('table');
    // No popover: the presets are buttons on the toolbar itself.
    expect(screen.queryByRole('dialog', { name: 'Khoảng ngày giao' })).toBeNull();
    for (const label of ['Hôm nay', 'Hôm qua', '7 ngày qua', 'Tháng này']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    // One click = both URL params, ordered, page reset.
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm nay' }));
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await waitFor(() => {
      const url = String(apiGet.mock.lastCall?.[0] ?? '');
      expect(url).toContain(`transportDateFrom=${iso}`);
      expect(url).toContain(`transportDateTo=${iso}`);
    });
  });

  it('direction and kind ride the inline-label chips into the URL', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Xuất' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));
    expect(screen.getByRole('button', { name: 'Xuất / Nhập: Xuất' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loại: Tất cả' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lệnh chạy ngoài' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('isAdHoc=true')));
    expect(screen.getByRole('button', { name: 'Loại: Lệnh chạy ngoài' })).toBeTruthy();
  });

  it('Kế hoạch combobox: one bucket filters server-side; two buckets turn the lens on', async () => {
    // The base row sits in PENDING_LOCK; a second row lives in NEW so the
    // lens has something to keep and something to cut.
    const newRow: ShipmentCusWorkspaceListItem = { ...row, id: 9, bucket: ShipmentCusBucket.NEW, bucketLabel: 'Mới tạo' };
    apiGet.mockResolvedValue(listResponse([row, newRow]));
    renderTabsPage();
    await screen.findByRole('table');
    const trigger = document.querySelector('.shipments-control__plan button[aria-haspopup]') as HTMLButtonElement;
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Mới tạo' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('bucket=NEW')));
    // Second selection (the multi popover stays open): the URL carries the
    // full set. The single-valued API keeps serving its cached page and the
    // client lens slices it — the PENDING_LOCK row drops out of view.
    fireEvent.click(await screen.findByRole('option', { name: 'Đã khóa' }));
    await waitFor(() => {
      expect(document.querySelector('[data-testid="url-probe"]')?.getAttribute('data-search')).toContain('bucket=NEW');
    });
    expect(document.querySelector('[data-testid="url-probe"]')?.getAttribute('data-search')).toContain('bucket=LOCKED');
    const bodyRows = document.querySelectorAll('tr.cus-dashboard-row');
    expect(bodyRows.length).toBe(1);
    expect(within(screen.getByRole('listbox', { name: 'Danh sách kế hoạch' })).getByRole('option', { name: 'Mới tạo' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Xóa lọc appears only when filters deviate and clears the whole toolbar', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderPage('/shipments?direction=EXPORT');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Xóa lọc' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lọc' }));
    await waitFor(() => {
      const url = String(apiGet.mock.lastCall?.[0] ?? '');
      expect(url).not.toContain('direction=');
    });
  });
});


describe('Card 20260926_49 — Grid polish + keyboard nav', () => {
  it('sticky header pins at the 104px budget with the neutral-200 hairline', () => {
    // The page declares its sticky-base variable explicitly; the thead pins
    // flush (rows never peek) and carries the 1px neutral-200 bottom hairline.
    expect(css).toMatch(/\.shipments-page--worksheet\s*\{[^}]*--sticky-thead-top:\s*calc\(var\(--app-topbar-h[^(]*\)\s*\*?\s*-1\)|--sticky-thead-top:\s*-24px/);
    expect(css).toMatch(/\.cus-dashboard-table thead th\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);/);
    // z-index guard so dropdowns/portals still ride above the pinned header.
    expect(css).toMatch(/\.cus-dashboard-table thead th\s*\{[^}]*z-index:\s*3;/);
  });

  it('rows compact to the 36-40px law: 40px floor, py 6-8px', () => {
    expect(css).toMatch(/\.cus-dashboard-table tbody > tr > th,\n\s*\.cus-dashboard-table tbody > tr > td\s*\{[^}]*height:\s*40px;/);
    expect(css).toMatch(/\.cus-dashboard-table tbody > tr > th,\n\s*\.cus-dashboard-table tbody > tr > td\s*\{[^}]*padding:\s*[6-8]px 10px;/);
  });

  it('codes and dates ride the data (mono) face: Bill/Book, tờ khai, schedule dates', () => {
    // Chứng từ cell keeps its mono class in the row feature.
    expect(rowSource).toContain('cus-multiline-cell--mono');
    // The lot-level schedule datetime gains the data face via page CSS (the
    // appointment-group lines mix date + factory + container text in one
    // span, so the data face applies only to the pure datetime span).
    expect(css).toMatch(/\.cus-dashboard-table \.cus-schedule-lot-fallback\s*\{[^}]*font-family:\s*var\(--font-data\);/);
    expect(css).toMatch(/\.cus-dashboard-table \.cus-multiline-cell--mono\s*\{[^}]*font-family:\s*var\(--font-data\);/);
  });

  it("keyboard: '/' focuses search, Esc clears it, Alt+N opens Tạo lô mới", async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderTabsPage();
    await screen.findByRole('table');
    // '/' from nowhere focuses the search field.
    fireEvent.keyDown(window, { key: '/', bubbles: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Tìm lô hàng'));
    // Typing then Esc clears the draft (and the debounce never applies it).
    fireEvent.change(screen.getByLabelText('Tìm lô hàng'), { target: { value: 'BILL' } });
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect((screen.getByLabelText('Tìm lô hàng') as HTMLInputElement).value).toBe('');
    // The placeholder title carries the documented shortcuts (the create
    // button drops its title attr, and the badge that used to carry them is
    // gone per the 2026-09-27 no-shortcut-text ruling).
    expect(screen.getByLabelText('Tìm lô hàng').getAttribute('title')).toContain('/');
    // Alt+N navigates to the create route — last, it unmounts the list.
    fireEvent.keyDown(window, { key: 'n', altKey: true, bubbles: true });
    expect(await screen.findByTestId('shipment-create-page')).toBeTruthy();
  });

  it('hotkeys stay quiet while typing or when the drawer owns the screen', async () => {
    apiGet.mockResolvedValue(listResponse([row]));
    renderTabsPage();
    await screen.findByRole('table');
    // Typing '/' inside a focused search field must NOT steal focus away.
    const search = screen.getByLabelText('Tìm lô hàng') as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: 'A' } });
    fireEvent.keyDown(search, { key: '/', bubbles: true });
    expect(document.activeElement).toBe(search);
    // The guard exists in source: field-focused keys and open-drawer keys are ignored.
    expect(source).toMatch(/isTextField|closest\('input/);
    expect(source).toMatch(/drawerId != null/);
  });

  describe('SIL-633 (id 737) — shipments overview typography scale and row height laws', () => {
    it('enforces intrinsic auto-height on desktop schedule cell triggers to prevent row overflow', () => {
      const schedBlock = css.match(
        /\.cus-dashboard-table td\[data-label=['"]Lịch trình & điều xe['"]\] > \.cus-inline-trigger,\s*\.cus-dashboard-table td\[data-label=['"]Lịch trình & điều xe['"]\] \.cus-inline-trigger\s*\{([^}]*)\}/,
      )?.[1] ?? '';
      expect(schedBlock, 'desktop schedule trigger rule exists').not.toBe('');
      expect(schedBlock).toMatch(/height:\s*auto;/);
      expect(schedBlock).toMatch(/min-height:\s*100%;/);
      expect(schedBlock).toMatch(/overflow:\s*visible;/);

      const tdSched = css.match(
        /\.cus-dashboard-table td\[data-label=['"]Lịch trình & điều xe['"]\]\s*\{([^}]*)\}/,
      )?.[1] ?? '';
      expect(tdSched, 'td schedule rule exists').not.toBe('');
      expect(tdSched).toMatch(/vertical-align:\s*top;/);
      expect(tdSched).toMatch(/overflow:\s*visible;/);
    });

    it('enforces line-height 1.35 on schedule groups and status rows to protect Vietnamese diacritics', () => {
      const groupRule = css.match(/\.cus-schedule-group\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(groupRule).toMatch(/line-height:\s*var\(--ops-table-supporting-line-height,\s*1\.35\);/);

      const groupSpan = css.match(/\.cus-schedule-group > span\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(groupSpan).toMatch(/line-height:\s*var\(--ops-table-supporting-line-height,\s*1\.35\);/);

      const statusRow = css.match(/\.cus-schedule-status-row\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(statusRow).toMatch(/line-height:\s*var\(--ops-table-supporting-line-height,\s*1\.35\);/);
    });

    it('enforces NO TRUNCATE on schedule cell facts', () => {
      const groupSpan = css.match(/\.cus-schedule-group > span\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(groupSpan).toMatch(/white-space:\s*normal;/);
      expect(groupSpan).toMatch(/overflow-wrap:\s*anywhere;/);
      expect(groupSpan).toMatch(/text-overflow:\s*clip;/);
      expect(groupSpan).not.toMatch(/text-overflow:\s*ellipsis;/);
    });

    it('enforces card eyebrow typography in mobile breakpoint', () => {
      const triggerBefore = css.match(
        /@media \(max-width:\s*999px\)\s*\{[\s\S]*?\.cus-dashboard-table \.cus-inline-trigger::before\s*\{([^}]*)\}/,
      )?.[1] ?? '';
      expect(triggerBefore, 'card trigger eyebrow rule exists').not.toBe('');
      expect(triggerBefore).toContain('font-size: var(--text-label-size)');
      expect(triggerBefore).toContain('font-weight: var(--fw-bold)');
      expect(triggerBefore).toContain('letter-spacing: 0.04em');
      expect(triggerBefore).toContain('text-transform: uppercase');
      expect(triggerBefore).toContain('line-height: var(--ops-table-header-line-height, 1.35)');
    });
  });

  // K1.32 (SIL-1078) — Back giữ cả vị trí cuộn: URL + bộ lọc + trang đã giữ
  // đúng, nhưng MAIN.app-body (the persistent shell scrollport the page
  // reaches by its #main-content id — Layout mounts it outside this route
  // tree, so the test hosts a stand-in with the same id) reset scrollTop về
  // 0. The hook saves the depth when the list unmounts and restores it once
  // the query cache paints rows.
  describe('K1.32 scroll restore', () => {
    let scrollHost: HTMLDivElement | null = null;
    let scrollHeightSpy: MockInstance<() => number> | null = null;
    let clientHeightSpy: MockInstance<() => number> | null = null;

    beforeEach(() => {
      authState.user.role = Role.CUS;
      apiGet.mockReset();
      apiPost.mockReset();
      apiPut.mockReset();
      downloadCSV.mockReset();
      window.localStorage.clear();
      sessionStorage.clear();
      mockDrawerRoutes(detail, listResponse());
      apiPost.mockResolvedValue({ replayed: false });
      apiPut.mockResolvedValue({ ...row, version: 4 });
      scrollHost = document.createElement('div');
      scrollHost.id = 'main-content';
      document.body.appendChild(scrollHost);
      scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(3000);
      clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    });

    afterEach(() => {
      scrollHeightSpy?.mockRestore();
      clientHeightSpy?.mockRestore();
      scrollHost?.remove();
      scrollHost = null;
    });

    async function openAndWait(path: string) {
      const view = renderPage(path);
      await screen.findByRole('table');
      return view;
    }

    it('restores the saved .app-body depth on Back to the same URL', async () => {
      const first = await openAndWait('/shipments?page=2&searchSuffix=QA5D-R2');
      expect(scrollHost!.scrollTop).toBe(0);
      scrollHost!.scrollTop = 800; // the user scrolled the list

      first.unmount(); // navigate to /shipments-detail
      expect(sessionStorage.getItem('app-body-scroll:/shipments?page=2&searchSuffix=QA5D-R2')).toBe('800');

      const second = await openAndWait('/shipments?page=2&searchSuffix=QA5D-R2'); // Back
      await waitFor(() => expect(scrollHost!.scrollTop).toBe(800));
      // the entry is consumed: leaving again saves the CURRENT depth, so a
      // third visit only starts at the top when the user left from the top
      scrollHost!.scrollTop = 0;
      second.unmount();
      const third = await openAndWait('/shipments?page=2&searchSuffix=QA5D-R2');
      await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
      expect(scrollHost!.scrollTop).toBe(0);
      third.unmount();
    });

    it('never applies a foreign depth when Back lands on a different filter state', async () => {
      const first = await openAndWait('/shipments?page=2&searchSuffix=QA5D-R2');
      scrollHost!.scrollTop = 800;
      first.unmount();
      // the persistent shell scrollport resets with the route change
      scrollHost!.scrollTop = 0;

      const other = await openAndWait('/shipments?page=1&searchSuffix=QA5D-R2');
      await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
      expect(scrollHost!.scrollTop).toBe(0);
      other.unmount();
    });
  });
});

// QA 28/11 T8 — the /shipments table page sweep: the row status strip lost its
// left half to the viewport's clip edge, and the packed tablet row crushed the
// from/to date pair below its content width so the Đến DD/MM/YYYY run painted
// under the absolute trailing calendar icon (measured on the real toolbar:
// +4px at 900, 0px at 1024). The money cell keeps the house "3.952.000 ₫"
// shape via the shared formatter.
describe('QA 28/11 T8 — table container inset + date-pair floor + money suffix', () => {
  const css = () => readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

  it('walks the status strip off the viewport clip edge (pl-2 inset)', () => {
    expect(css()).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*padding-inline-start:\s*8px;/);
  });

  it('floors the from/to date pair at its content width in the prefix-visible band (≥768)', () => {
    expect(css()).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*\.shipments-page \.list-filter-bar > \.date-range-fields\s*\{[^}]*min-width:\s*338px;/,
    );
  });

  it('the revenue cell prints the currency suffix through the shared formatter', () => {
    expect(rowSource).toContain('{formatMoney(item.finance.customerNoInvoiceTotal)} ₫');
  });
});
