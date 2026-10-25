import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// FB-086 R29 remainder: the quick-edit modal presentation lives in the shared
// component now (hosted by both the Tổng quan grid and the lot detail page).
const quickEditModalSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/ShipmentQuickEditModal.tsx'), 'utf8');
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

describe('ShipmentsPage — CUS closeout workspace', () => {
  // Card 20260923_1 (operator ruling): the row carries a text-only "Chi tiết"
  // link — no chevron icon, and the lot-delete affordance leaves the row
  // entirely (it moves into the drawer header).
  it('row actions: text "Chi tiết" without an icon; no trash on the row', async () => {
    renderPage();
    await screen.findByRole('table');
    const row = masterRow();
    const detailButton = within(row).getByRole('button', { name: /Mở chi tiết lô hàng/ });
    expect(detailButton.textContent).toContain('Chi tiết');
    expect(detailButton.querySelector('svg')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Xóa lô hàng/ })).toBeNull();

    // The label the operator reads lives in UUIButton's `[data-text]` span —
    // an icon-only override on it would render an EMPTY box (textContent still
    // reads "Chi tiết", which is why this asserts the shipped stylesheet).
    expect(detailButton.querySelector('[data-text]')?.textContent).toBe('Chi tiết');
    expect(css).not.toMatch(/\.cus-dashboard-detail[^{]*\[data-text\][^{]*\{[^}]*display:\s*none/);
    // House link style (ruling: no pill, no border) — the rule carries no
    // border/background chrome of its own.
    const detailRule = css.match(/\.cus-dashboard-detail\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(detailRule).not.toMatch(/border|background/);
  });

  beforeEach(() => {
    authState.user.role = Role.CUS;
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    downloadCSV.mockReset();
    window.localStorage.clear();
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
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
    expect(screen.queryByText('Hóa đơn kết hợp')).toBeNull();
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

  it('QA-AUDIT-UI-08 distinguishes descriptive missing-container text from an ISO identifier', async () => {
    apiGet.mockImplementation((url: string) => url === '/shipments/cus-workspace/1'
      ? Promise.resolve({ ...detail, containers: [{ ...detail.containers[0], containerNumber: null }] })
      : Promise.resolve(listResponse()));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
    // SIL-485 view sheet: the SỐ CONTAINER cell says what is missing in words
    // — a descriptive phrase, never an ISO-identifier-shaped placeholder.
    expect(await screen.findByText('Chưa có số cont')).toBeTruthy();
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
    // Per-container appointment groups: one line per distinct close/return
    // datetime, with the container-type mix of that group.
    expect(surface.getByText('09:30 12/08/2026 · Nhà máy ABC · 1x40HC')).toBeTruthy();
    expect(surface.getByText('16:30 12/08/2026 · Nhà máy ABC · 1x20GP')).toBeTruthy();
    expect(masterRowDetailButton().textContent).toContain('Chi tiết');
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn cột hiển thị' })).toBeNull();

    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    // SIL-485: the drawer review opens on the read-only cards — Nhận diện lô
    // first, the container sheet carrying the lot's rows.
    expect(within(dialog).getByRole('heading', { name: 'Nhận diện lô' })).toBeTruthy();
    expect(within(dialog).getAllByText('MSKU1234567').length).toBeGreaterThan(0);
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
  });

  // Card 091026164530: the lot quick-view dialog ('Mở chi tiết lô hàng') was
  // reported to show a 'Tổng quan'/'Chi tiết' tablist on the first open and no
  // tablist on later opens. Verified against the design and on staging: the
  // drawer is a single-view surface (lot bar → Chi tiết container → Trạng thái
  // lô, the SIL-483 create-form section order) that carries NO tablist at any
  // width, and its content must be identical on every open of the same lot. Pin that consistency contract:
  // three open/close cycles, byte-identical dialog content, no tablist ever —
  // any reopen-divergent render state (a flag not reset on close, a
  // condition keyed to the detail cache) turns this red.
  it('quick-view dialog renders identical content with no tablist on every reopen (card 091026164530)', async () => {
    const lclRow = { ...row, cargoMode: 'LCL' as const, customerName: 'TEST-LCL-362' };
    const lclDetail = { ...detail, summary: lclRow, containers: [] };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(lclDetail) : Promise.resolve(listResponse([lclRow]))
    ));
    renderPage();
    await screen.findByRole('table');

    const opens: string[] = [];
    for (let open = 1; open <= 3; open++) {
      fireEvent.click(masterRowDetailButton());
      const dialog = await screen.findByRole('dialog');
      // The drawer body settles on the SIL-485 review cards — for an LCL lot
      // with no containers the sheet reads its empty note.
      await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Thông tin hàng' })).toBeTruthy());
      expect(within(dialog).getByText('Chưa có container trong lô.')).toBeTruthy();
      // Design truth pinned per the card's consistency AC: the dialog is not a
      // tabbed surface — no tablist inside it, ever.
      expect(dialog.querySelectorAll('[role="tablist"], [role="tab"]')).toHaveLength(0);
      opens.push(dialog.textContent ?? '');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(new Set(opens).size).toBe(1);
  });

  it('opens straight into the content — stepper, chips and cards, no tabs (SIL-485)', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
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
    // + the operational signals).
    expect(within(drawer).getByText('Hàng FCL')).toBeTruthy();
    // Body order: the stepper leads, Nhận diện lô precedes Thông tin hàng.
    const stepper = within(drawer).getByLabelText('Tiến trình lô hàng');
    const identity = within(drawer).getByRole('heading', { name: 'Nhận diện lô' });
    const cargo = within(drawer).getByRole('heading', { name: 'Thông tin hàng' });
    expect(stepper.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(identity.compareDocumentPosition(cargo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The stepper reads this lot at its last step — lịch đã chốt, xe đã phân,
    // đối soát đã xác nhận; Khóa lô is the first unfinished step (current).
    const currentStep = stepper.querySelector('.cus-lot-stepper__step--current');
    expect(currentStep?.textContent).toContain('Khóa lô');
  });

  it('does not repeat the shipment-level closing or return date before container appointments', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, transportDate: '2026-08-19' }]));
    renderPage();

    const scheduleCell = (await screen.findByText('09:30 12/08/2026 · Nhà máy ABC · 1x40HC')).closest('td');
    expect(scheduleCell).toBeTruthy();
    expect(within(scheduleCell!).queryByText('19/8/2026')).toBeNull();
    expect(within(scheduleCell!).getByText('09:30 12/08/2026 · Nhà máy ABC · 1x40HC')).toBeTruthy();
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

  it('keeps the approved Cont/Lẻ cargo label in the XLSX export only, not as a table pill', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'FCL' }, { ...row, id: 2, cargoMode: 'LCL', containerSummary: '4 Pallet' }]));
    renderPage();
    const table = await screen.findByRole('table');
    // The cargo overview cell states the mode through its own content
    // (composition lines vs kiện/CBM metrics) — no redundant Cont/Lẻ pill.
    expect(within(table).queryByText('Cont')).toBeNull();
    expect(within(table).queryByText('Lẻ')).toBeNull();

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
    expect(within(statusCell!).getByRole('button', { name: /Mở chi tiết lô hàng BILL-12345/ }).textContent).toContain('Chi tiết');
    expect(css).toContain('.cus-dashboard-detail {');
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
    const firstType = await screen.findByText('1x40HC');
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

    const notes = await screen.findByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' });
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
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
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
    // The label no longer owns a box of its own (measured 2026-09-28 at
    // 390px: a label column gave it ~70px and left the value a ~100px strip,
    // so "Chưa có Bill/Book" wrapped to two lines). It is an inline run in
    // the cell's own text flow, the shape the shared record-table card band uses.
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*display\s*:\s*inline\s*;[^}]*width\s*:\s*auto\s*;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger\[data-cell-short\]::before\s*\{[^}]*content:\s*attr\(data-cell-short\);/);
    // The ` · ` join is now UNCONDITIONAL in the phone card: the
    // `data-facts="inline"` markup flag is gone from every source file (the
    // card always joins), and the separator is stated for the trigger's direct
    // children too, because the schedule cell paints its facts straight into
    // the trigger without a `.cus-multiline-cell` wrapper.
    // Card c6b02380 REPLACED the ` · ` join at phone widths, and this pin used
    // to assert the join's presence — so it went red on correct code and
    // nobody could tell a real regression from the intended change. The new
    // contract is the opposite shape: in the phone card the LABEL
    // (`.cus-inline-trigger::before`) shares a line with the FIRST fact, and
    // every later fact takes its own line as a block. There is deliberately no
    // separator glyph, because nothing is trying to share a line after the
    // first, so there is no "where does one fact end" question to mark and no
    // glyph to strand on a narrow screen.
    //
    // Pinned on the behaviour that replaced the join, not merely dropped:
    //   - the stack is an inline run, so the label and first fact stay together
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
    expect(css).toMatch(/\.cus-quick-edit-modal__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    // FB-086 R29 remainder: the modal presentation moved verbatim into the
    // shared ShipmentQuickEditModal (the lot detail page opens the same
    // editor) — the source contract follows it there.
    expect(quickEditModalSource).toMatch(/<Modal[\s\S]*?maxWidth=\{480\}[\s\S]*?cus-quick-edit-modal/);
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
    expect(await screen.findByText('Chưa chốt ngày')).toBeTruthy();
    expect(masterRow().classList.contains('cus-dashboard-row--waiting')).toBe(true);
    expect(within(masterRow()).getAllByText('Chưa chốt ngày')).toHaveLength(1);
    expect(within(masterRow()).queryByText('Chờ chốt lịch')).toBeNull();
    expect(within(masterRow()).getByText('Sẵn sàng điều xe')).toBeTruthy();
    expect(screen.queryByText('Cần kiểm tra')).toBeNull();
    // The attention signal is the CELL'S TEXT, not a colour field. This sheet
    // once tinted the whole schedule cell cream; when nearly every row is
    // waiting — which is the unfiltered default — the tint covered 100% of the
    // column, signalled nothing, and became a solid beige band the full height
    // of the table. §10 is the same rule from the parity side: a status is the
    // 3×20px strip, never a full-height fill. "Chưa chốt ngày" carries it in
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
    expect(record.getAllByText('Chưa chốt ngày')).toHaveLength(1);
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
    // Six groups render instead of seven, and no column is left dangling.
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
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
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  it('CUS-OVERVIEW-04 keeps empty notes addable through the existing named edit action', async () => {
    // The column hides by DEFAULT while it is empty (previous case), so this
    // reaches the action the way an operator does — with the column shown by an
    // explicit choice. The action itself is unchanged.
    localStorage.setItem('cus-lots-hidden-cols', '[]');
    apiGet.mockResolvedValue(listResponse([noteLessRow()]));
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' });
    expect(trigger.textContent).toBe('Thêm ghi chú');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Ghi chú' });
    expect((within(dialog).getByLabelText('Ghi chú cho khách hàng') as HTMLTextAreaElement).value).toBe('');
    expect((within(dialog).getByLabelText('Ghi chú cho lái xe') as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Ghi chú' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(apiPut).not.toHaveBeenCalled();
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

  it('edits schedule and notes from their cells with partial optimistic-version updates', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'LCL', version: apiPut.mock.calls.length > 0 ? 4 : 3 }]))
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    fireEvent.change(screen.getByLabelText('Ngày đóng/trả'), { target: { value: '20/08/2026' } });
    fireEvent.change(screen.getByLabelText('Giờ'), { target: { value: '09:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3,
      expectedDeliveryDate: '2026-08-20',
      plannedReturnAt: '2026-08-20T09:15:00+07:00',
    })));
    expect(apiPut.mock.calls.at(-1)?.[1]).not.toHaveProperty('customerNotes');
    expect(await screen.findByText('Đã cập nhật lịch đóng/trả.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' }));
    fireEvent.change(screen.getByLabelText('Ghi chú cho khách hàng'), { target: { value: 'LƯU CA SÁNG' } });
    fireEvent.change(screen.getByLabelText('Ghi chú cho lái xe'), { target: { value: 'Ưu tiên cổng số 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/shipments/1', {
      expectedVersion: 4,
      driverNotes: 'Ưu tiên cổng số 2',
      customerNotes: 'LƯU CA SÁNG',
    }));
    expect(await screen.findByText('Đã cập nhật ghi chú lô hàng.')).toBeTruthy();
  });

  it('FB-002 round 22: typed giờ + Enter saves the schedule quick-edit even with the picker open from the focusing click', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'LCL', version: 3 }]))
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Lịch trình' });
    const time = within(dialog).getByLabelText('Giờ');
    // The focusing CLICK opens the picker — the QA flow that kept a dead key:
    // Enter's first press used to only close the picker (0 saves, no error).
    fireEvent.click(time);
    expect(document.querySelector('.time-picker__popup')).not.toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Ngày đóng/trả'), { target: { value: '20/08/2026' } });
    fireEvent.change(time, { target: { value: '14:30' } });
    fireEvent.keyDown(time, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3,
      expectedDeliveryDate: '2026-08-20',
      plannedReturnAt: '2026-08-20T14:30:00+07:00',
    })));
    expect(await screen.findByText('Đã cập nhật lịch đóng/trả.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Lịch trình' })).toBeNull();
  });

  it('FB-030/075: completing a typed giờ in the schedule quick-edit advances focus to the Ngày day segment', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'LCL' }]))
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Lịch trình' });
    const time = within(dialog).getByLabelText('Giờ');
    fireEvent.change(time, { target: { value: '1430' } });
    expect(time).toHaveValue('14:30');
    // The single-box analog of the segmented fields' complete-segment
    // advance: giờ done → focus lands on the Ngày đóng/trả day segment
    // (prefilled with the row's current date — type-over ready on select).
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Ngày đóng/trả')));
    expect((document.activeElement as HTMLInputElement).getAttribute('data-seg')).toBe('dd');
  });

  it('edits the import Bill and declaration from the Chứng từ cell in one save', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, version: apiPut.mock.calls.length > 0 ? 4 : 3 }]))
    ));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Chứng từ' });
    expect(within(dialog).getByLabelText('Số Bill')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Số Booking')).toBeNull();
    expect((within(dialog).getByLabelText('Số tờ khai') as HTMLInputElement).value).toBe('TK-54321');

    fireEvent.change(within(dialog).getByLabelText('Số tờ khai'), { target: { value: 'TK-99999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3,
      blNumber: 'BILL-12345',
      bookingRef: null,
    })));
    // Existing declaration (fixture declarationId 9) is updated in place with
    // its scope resent verbatim so the whole-row PUT keeps the metadata.
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1/declarations/9', {
      declarationNumber: 'TK-99999',
      issuedAt: null,
      scope: 'SINGLE',
      note: null,
    }));
    expect(await screen.findByText('Đã cập nhật chứng từ lô hàng.')).toBeTruthy();
  });

  it('creates a declaration when the shipment has none yet', async () => {
    const noDeclaration: ShipmentCusWorkspaceListItem = {
      ...row,
      declarationNumber: null,
      raw: { ...row.raw, declarationNumber: null, declarationId: null, declarationScope: null, declarations: [] },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([noDeclaration]))
    ));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Chứng từ' });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Thêm tờ khai' }));
    fireEvent.change(within(dialog).getByLabelText('Số tờ khai'), { target: { value: 'TK-NEW-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/1/declarations', {
      declarationNumber: 'TK-NEW-1',
      issuedAt: null,
      note: null,
    }));
    expect(apiPut).not.toHaveBeenCalledWith(expect.stringContaining('/declarations'));
    expect(await screen.findByText('Đã cập nhật chứng từ lô hàng.')).toBeTruthy();
  });

  // FB-002 (round-17 sweep): the quick-edit modal's save button lives in the
  // modal FOOTER — outside the <form> — so browser implicit submission never
  // fired for multi-field modes and Enter went dead. The form answers Enter
  // itself through the footer button's exact submit path.
  it('saves the documents quick-edit on Enter and keeps Shift+Enter inert (FB-002)', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, version: 3 }]))
    ));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Chứng từ' });
    const bill = within(dialog).getByLabelText('Số Bill') as HTMLInputElement;
    fireEvent.change(bill, { target: { value: 'BILL-ENTER' } });

    // Shift+Enter never saves (the multiline-adjacent combo law).
    fireEvent.keyDown(bill, { key: 'Enter', shiftKey: true });
    expect(apiPut).not.toHaveBeenCalled();

    fireEvent.keyDown(bill, { key: 'Enter' });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3,
      blNumber: 'BILL-ENTER',
    })));
    expect(await screen.findByText('Đã lưu ô dữ liệu lô hàng.')).toBeTruthy();
  });

  it('keeps bare Enter as a newline in the notes quick-edit; Ctrl+Enter saves (FB-002)', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([{ ...row, version: 3 }]))
    ));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' }));
    const notes = await screen.findByLabelText('Ghi chú cho khách hàng');
    fireEvent.change(notes, { target: { value: 'Dòng một' } });

    fireEvent.keyDown(notes, { key: 'Enter' });
    expect(apiPut).not.toHaveBeenCalled();
    // The help copy names the combo that does save.
    expect(screen.getByText('Enter để xuống dòng; Ctrl/Cmd+Enter để lưu.')).toBeTruthy();

    fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      customerNotes: 'Dòng một',
    })));
  });

  it('joins every declaration number in the Chứng từ cell, XLSX-style', async () => {
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

    const cell = screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' });
    expect(cell.textContent).toContain('TK-54321, TK-77777');
  });

  it('saves only the declaration when bill and booking are read-only', async () => {
    const declarationOnlyRow: ShipmentCusWorkspaceListItem = {
      ...row,
      fieldAccess: {
        ...row.fieldAccess,
        blNumber: { mode: 'READ_ONLY', reason: 'Chỉ CUS được sửa bill.' },
        bookingRef: { mode: 'READ_ONLY', reason: 'Chỉ CUS được sửa booking.' },
      },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(detail)
        : Promise.resolve(listResponse([declarationOnlyRow]))
    ));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Chứng từ' });
    expect((within(dialog).getByLabelText('Số Bill') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Số tờ khai'), { target: { value: 'TK-ONLY-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1/declarations/9', expect.objectContaining({
      declarationNumber: 'TK-ONLY-1',
    })));
    expect(apiPut).not.toHaveBeenCalledWith('/shipments/1', expect.anything());
    expect(await screen.findByText('Đã cập nhật chứng từ lô hàng.')).toBeTruthy();
  });

  describe('quick bubble dismissal', () => {
    async function openDocumentsBubble() {
      renderPage();
      await screen.findByRole('table');
      fireEvent.click(screen.getByRole('button', { name: 'Sửa ô chứng từ BILL-12345' }));
      return await screen.findByRole('dialog', { name: 'Chỉnh sửa Chứng từ' });
    }

    it('closes on outside pointerdown', async () => {
      await openDocumentsBubble();
      fireEvent.pointerDown(document.body);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).toBeNull());
    });

    it('closes on global Escape', async () => {
      await openDocumentsBubble();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).toBeNull());
    });

    it('stays open when the press lands inside the form', async () => {
      const dialog = await openDocumentsBubble();
      fireEvent.pointerDown(within(dialog).getByLabelText('Số Bill'));
      expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).not.toBeNull();
    });

    it('stays open when the press lands on the Modal footer save button (outside the form ref)', async () => {
      const dialog = await openDocumentsBubble();
      // The whole .modal__content counts as inside: the footer buttons live
      // outside the form ref, and cancelling on pointerdown would kill the
      // click that follows.
      fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
      expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).not.toBeNull();
    });

    it('stays open while a save is in flight', async () => {
      apiPut.mockImplementation(() => new Promise(() => {}));
      const dialog = await openDocumentsBubble();
      fireEvent.change(within(dialog).getByLabelText('Số tờ khai'), { target: { value: 'TK-HANGING' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).not.toBeNull();
    });

    it('ignores presses inside the portaled react-aria popover', async () => {
      await openDocumentsBubble();
      const portal = document.createElement('div');
      portal.className = 'react-aria-Popover';
      document.body.appendChild(portal);
      try {
        fireEvent.pointerDown(portal);
        expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Chứng từ' })).not.toBeNull();
      } finally {
        portal.remove();
      }
    });
  });

  it('opens one compact edit dialog from the cell control and reserves the drawer for Chi tiết', { timeout: 15000 }, async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: { ...detail.summary, cargoMode: 'LCL' } })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'LCL' }]))
    ));
    renderPage();
    const table = await screen.findByRole('table');
    const rowElement = masterRow();
    const scheduleButton = within(rowElement).getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' });
    const scheduleCell = scheduleButton.closest('td');
    expect(scheduleCell).toBeTruthy();
    expect(within(scheduleCell!).getAllByRole('button')).toEqual([scheduleButton]);

    fireEvent.click(scheduleButton);
    expect((await screen.findByRole('dialog', { name: 'Chỉnh sửa Lịch trình' })).contains(screen.getByLabelText('Ngày đóng/trả'))).toBe(true);
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    fireEvent.keyDown(document, { key: 'Escape' });
    const notesButton = within(rowElement).getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' });
    const notesCell = notesButton.closest('td');
    expect(notesCell).toBeTruthy();
    expect(within(notesCell!).getAllByRole('button')).toEqual([notesButton]);

    fireEvent.click(notesButton);
    expect((await screen.findByRole('dialog', { name: 'Chỉnh sửa Ghi chú' })).contains(screen.getByLabelText('Ghi chú cho khách hàng'))).toBe(true);
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(rowElement).getByRole('button', { name: 'Sửa ô khách hàng và nhà máy BILL-12345' }));
    expect(screen.getByLabelText('Nhà máy')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Chỉnh sửa Khách hàng & nhà máy' })).toBeTruthy();
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');
    // Customer name is rendered as a full-width read-only block so long
    // Vietnamese company names never get clipped by the column layout.
    const dialog = screen.getByRole('dialog', { name: 'Chỉnh sửa Khách hàng & nhà máy' });
    const customerBlock = dialog.querySelector('.cus-quick-edit-modal__readonly');
    expect(customerBlock).toBeTruthy();
    expect(customerBlock?.textContent).toBe('Công ty Silver Sea');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(masterRowDetailButton());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
    expect(within(table).getByText('Công ty Silver Sea')).toBeTruthy();
  });

  it('UI-CD-12 opens the per-container factory workspace for FCL instead of a parent text editor', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'FCL' }]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: 'Sửa ô khách hàng và nhà máy BILL-12345' }));
    expect(await screen.findByTestId('container-detail-page')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Khách hàng & nhà máy' })).toBeNull();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('renders the lot-level schedule line when a lot has no container appointment groups (card 20260915_35)', async () => {
    // Lead ruling fork (a): the "Chỉnh sửa Lịch trình" dialog writes the
    // shipment-level closingAt/plannedReturnAt, but for FCL lots the readiness
    // rule counts only per-container appointments — the cell must still SHOW
    // the saved lot-level schedule instead of leaving "Chưa chốt ngày" alone.
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: { ...detail.summary, cargoMode: 'FCL' } })
        : Promise.resolve(listResponse([{ ...row, appointmentGroups: [], plannedReturnAt: '2026-09-19T13:03:00.000Z' }]))
    ));
    renderPage();
    await screen.findByRole('table');
    expect(await within(masterRow()).findByText('20:03 19/09/2026')).toBeTruthy();
  });

  it('keeps the schedule dialog open when the desktop time-picker panel is clicked (card 20260915_6)', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: { ...detail.summary, cargoMode: 'LCL' } })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'LCL' }]))
    ));
    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    fireEvent.click(await within(rowElement).findByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa Lịch trình' });
    fireEvent.click(within(dialog).getByLabelText('Giờ'));

    const panel = await waitFor(() => {
      const el = document.querySelector('.time-picker__popup');
      if (!el) throw new Error('panel not mounted yet');
      return el;
    });
    fireEvent.pointerDown(panel);
    expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Lịch trình' })).not.toBeNull();
    expect(within(dialog).getByLabelText('Giờ')).toBeTruthy();
  });



  // 15s, not the 5s default (card 20260928_196). This is the slowest test in
  // the file and it was never flaky — it is deterministically over the default
  // when run alone, and only passes at 5s when earlier tests in the same file
  // have already paid the first-render cost. Measured: 8.53s of test time with
  // `--testTimeout=90000`, against a 1.2s average for the file's 120 tests.
  //
  // The cost is honest work, not a hang: the loop below opens SIX dialogs, and
  // each one pays a findByRole plus two waitFor cycles (close, then focus
  // restore) before the next cell is touched. Six modal lifecycles in jsdom do
  // not fit in 5s.
  //
  // Raising the ceiling, not the work: every assertion below is unchanged, and
  // a genuine hang still fails — at 15s instead of 5s. Matches the two
  // `{ timeout: 15000 }` cases already in this file (lines ~2003, ~2029).
  it('uses exactly one full-cell button to open the matching edit dialog', { timeout: 15000 }, async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    const cells: Array<{ button: string; dialog: string }> = [
      { button: 'Sửa ô khách hàng và nhà máy BILL-12345', dialog: 'Chỉnh sửa Khách hàng & nhà máy' },
      { button: 'Sửa ô chứng từ BILL-12345', dialog: 'Chỉnh sửa Chứng từ' },
      { button: 'Sửa ô phân loại và hãng tàu BILL-12345', dialog: 'Chỉnh sửa Phân loại & hãng tàu' },
      { button: 'Sửa ô tổng quan hàng hóa BILL-12345', dialog: 'Chỉnh sửa Tổng quan hàng hóa' },
      { button: 'Sửa ô lịch trình lô hàng BILL-12345', dialog: 'Chỉnh sửa Lịch trình' },
      { button: 'Sửa ô ghi chú lô hàng BILL-12345', dialog: 'Chỉnh sửa Ghi chú' },
    ];

    for (const { button, dialog } of cells) {
      const trigger = within(rowElement).getByRole('button', { name: button });
      const cell = trigger.closest<HTMLElement>('th, td');
      expect(cell).toBeTruthy();
      expect(within(cell!).getAllByRole('button')).toEqual([trigger]);
      // fireEvent.click does not apply the browser's native pointer-focus step.
      // Model it so this verifies that opening never refocuses the clicked cell.
      trigger.focus();
      const focus = vi.spyOn(trigger, 'focus');
      fireEvent.click(trigger);
      expect(await screen.findByRole('dialog', { name: dialog })).toBeTruthy();
      expect(screen.getAllByRole('dialog', { name: dialog })).toHaveLength(1);
      expect(focus).not.toHaveBeenCalled();
      focus.mockRestore();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: dialog })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
    expect(source).not.toContain('openQuickEditFromCell');
    expect(source).not.toContain('ReactMouseEvent');
    expect(rowSource).toContain('data-cell-label="Chứng từ"');
    expect(css).toMatch(/\.cus-dashboard-cell--editable\s*\{[^}]*padding:\s*0 !important;/);
    expect(css).toMatch(/\.cus-dashboard-cell--readonly\s*\{[^}]*padding:\s*0 !important;/);
    expect(css).toMatch(/\.cus-dashboard-cell--editable > \.cus-inline-trigger,\s*\.cus-dashboard-cell--readonly > \.cus-inline-trigger\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100%;/);
    // Read-only FCL schedule cells fill their row and stay visually inert:
    // the transparent background/border must be locked so neither the
    // trigger-hover rule nor the td:hover rule can repaint them.
    expect(css).toMatch(/\.cus-dashboard-cell--readonly > \.cus-inline-trigger\s*\{[^}]*cursor:\s*default;[^}]*background:\s*transparent !important;[^}]*border-color:\s*transparent !important;/);
    expect(recordCss).toMatch(/tbody > tr > td::before\s*\{\s*display:\s*none;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*content:\s*attr\(data-cell-label\);/);
  });

  it('persists classification and cargo cells through one-field-authority shipment patches', async () => {
    // Card 20260922_41: the FCL cargo cell opens the lot's "Quản lý container"
    // dialog (composition at lot level) — the lot-cargo quick-edit lives on
    // for LCL only (non-goal), so its save contract is pinned on an LCL row.
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa ô phân loại và hãng tàu BILL-12345' }));
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'ONE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3, tradeDirection: 'IMPORT', shippingLineName: 'ONE',
    })));

    fireEvent.click(await screen.findByRole('button', { name: 'Sửa ô tổng quan hàng hóa BILL-12345' }));
    fireEvent.change(screen.getByLabelText('Số kiện'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/shipments/1', expect.objectContaining({
      expectedVersion: 3, packageCount: 24,
    })));
  });

  it('opens the lot container dialog from the FCL cargo cell without navigating (card 20260923_1)', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve(manageDetail)
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'FCL' }]))
    ));
    renderPage();
    await screen.findByRole('table');

    // Card 20260923_1: container composition lives in the drawer; the FCL
    // cargo cell returns to quick-edit (the dialog is gone).
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: 'Sửa ô tổng quan hàng hóa BILL-12345' }));
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa Tổng quan hàng hóa' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /Quản lý container/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chỉnh sửa Tổng quan hàng hóa' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa Tổng quan hàng hóa' })).toBeNull());

    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
    // SIL-485: the drawer shows the read-only review sheet; editing leaves the
    // drawer entirely (footer "Sửa" navigates), so no container add/remove
    // affordance exists here anymore.
    await within(await screen.findByRole('dialog')).findByText('MSKU1234567');
    expect(screen.queryByRole('button', { name: 'Thêm container' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa container MSKU1234567' })).toBeNull();
  });

  it('allows Xóa lô directly when deletable=true even with containers remaining, resolving Catch-22 deadlock (cards 351, 352)', { timeout: 15000 }, async () => {
    // Cards 351 & 352: Previously, "Xóa lô" required deleting all containers first,
    // but deleting the last container was blocked by "Lô hàng phải có ít nhất một container".
    // Now, clicking "Xóa lô" on a deletable lot immediately opens the confirmed delete modal
    // (cascading all containers), eliminating the deadlock.
    const containers = manageDetail.containers.map((line) => ({ ...line, tripId: null, tripStatus: null }));
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...manageDetail, containers })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'FCL', operational: { ...row.operational, deletable: true } }]))
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
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
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...manageDetail, containers: [] })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]))
    ));
    authState.user.role = Role.CUS;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
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
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...manageDetail, containers: [] })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]))
    ));
    authState.user.role = Role.ADMIN;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;
    expect(within(drawer).getByRole('button', { name: 'Xóa lô' })).toBeTruthy();
  });

  it('hides the lot-delete affordance from roles the delete route refuses (card 071026204710)', async () => {
    // The point of gating on the role rather than on `operational.deletable`
    // alone: that flag is a data-state check (no live trip left on the lot) and
    // carries no role, so an unlisted role must not be offered the action.
    const deletable = { ...row.operational, deletable: true };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...manageDetail, containers: [] })
        : Promise.resolve(listResponse([{ ...row, cargoMode: 'FCL', operational: deletable }]))
    ));
    authState.user.role = Role.ACCOUNTANT;
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
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
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...manageDetail, containers: [] })
        : Promise.resolve(listResponse([dispatchedRow]))
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
    await screen.findByRole('dialog');
    const drawer = document.querySelector('.cus-shipment-drawer') as HTMLElement;

    fireEvent.click(within(drawer).getByRole('button', { name: 'Xóa lô' }));

    expect(await screen.findByText(/Không thể xóa lô hàng đã có container được điều xe/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });


  it('does not open edit dialogs or the drawer from locked shipment cells', async () => {
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
    apiGet.mockResolvedValue(listResponse([lockedRow]));

    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    for (const name of [
      'Sửa ô khách hàng và nhà máy BILL-12345',
      'Sửa ô chứng từ BILL-12345',
      'Sửa ô phân loại và hãng tàu BILL-12345',
      'Sửa ô tổng quan hàng hóa BILL-12345',
      'Sửa ô lịch trình lô hàng BILL-12345',
      'Sửa ô ghi chú lô hàng BILL-12345',
    ]) {
      const cell = within(rowElement).getByRole('button', { name }).closest('th, td');
      expect(cell).toBeTruthy();
      fireEvent.click(cell!);
    }

    expect(screen.queryByLabelText('Ngày đóng/trả')).toBeNull();
    expect(screen.queryByLabelText('Ghi chú cho khách hàng')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');
  });

  it('keeps the notes cell editable on locked lots while the schedule stays locked', async () => {
    const lockedFieldAccess = Object.fromEntries(Object.entries(row.fieldAccess).map(([key, access]) => [
      key,
      { ...access, mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
    ])) as typeof row.fieldAccess;
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      cargoMode: 'LCL',
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      fieldAccess: {
        ...lockedFieldAccess,
        customerNotes: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trường này.' },
        operationalNotes: { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trường này.' },
      },
      operational: { ...row.operational, transportDateEditable: false },
    };
    apiGet.mockResolvedValue(listResponse([lockedRow]));

    renderPage();
    await screen.findByRole('table');
    const rowElement = masterRow();
    const notesButton = within(rowElement).getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' });
    expect(notesButton).not.toBeDisabled();
    fireEvent.click(notesButton);
    expect(await screen.findByLabelText('Ghi chú cho khách hàng')).toBeTruthy();
    const scheduleButton = within(rowElement).getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' });
    expect(scheduleButton).toBeDisabled();
  });

  it('cancels a cell dialog with Escape without persisting', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    fireEvent.change(screen.getByLabelText('Ngày đóng/trả'), { target: { value: '2026-08-22' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByLabelText('Ngày đóng/trả')).toBeNull();
    expect(apiPut).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' })));
  });

  it('requires explicit save instead of saving when focus leaves the edit dialog', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    const dateInput = screen.getByLabelText('Ngày đóng/trả');
    const timeInput = screen.getByLabelText('Giờ');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeTruthy();

    fireEvent.change(dateInput, { target: { value: '21/08/2026' } });
    fireEvent.blur(dateInput, { relatedTarget: timeInput });
    expect(apiPut).not.toHaveBeenCalled();

    fireEvent.blur(timeInput, { relatedTarget: dateInput });
    expect(apiPut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({ expectedDeliveryDate: '2026-08-21' }));
    await waitFor(() => expect(screen.queryByLabelText('Ngày đóng/trả')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
  });

  it('keeps Shift+Enter as a note newline without saving the cell', async () => {
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' }));
    const notesInput = screen.getByLabelText('Ghi chú cho lái xe');
    fireEvent.change(notesInput, { target: { value: 'Dòng một\nDòng hai' } });
    fireEvent.keyDown(notesInput, { key: 'Enter', shiftKey: true });

    expect(apiPut).not.toHaveBeenCalled();
    expect((notesInput as HTMLTextAreaElement).value).toBe('Dòng một\nDòng hai');
    expect(screen.getByLabelText('Ghi chú cho lái xe')).toBeTruthy();
  });

  it('VID-CUS-15: quick-edit footer respects native date validity before saving', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, cargoMode: 'LCL' }]));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-12345' }));
    const date = screen.getByLabelText('Ngày đóng/trả') as HTMLInputElement;
    fireEvent.change(screen.getByLabelText('Giờ'), { target: { value: '16:17' } });
    // Partial typed text never emits the ISO contract, so the save cannot
    // reuse the previous date while the entry is incomplete.
    fireEvent.change(date, { target: { value: '23/09/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(apiPut).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Ngày đóng/trả')).toBeInTheDocument();
    fireEvent.change(date, { target: { value: '23/09/2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/shipments/1', expect.objectContaining({ expectedDeliveryDate: '2026-09-23' }));
  });

  it('deduplicates repeated keyboard saves while a cell update is in flight', async () => {
    let resolveUpdate: ((value: unknown) => void) | undefined;
    apiPut.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    apiGet.mockResolvedValue(listResponse([
      row,
      { ...row, id: 2, cargoMode: 'LCL', billOrBookNumber: 'BILL-22222' },
    ]));
    renderPage();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' }));
    const notesInput = screen.getByLabelText('Ghi chú cho lái xe');
    fireEvent.change(notesInput, { target: { value: 'Ưu tiên cổng số 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect((notesInput as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText('Ghi chú cho khách hàng') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByLabelText('Ghi chú cho lái xe')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sửa ô lịch trình lô hàng BILL-22222' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-22222' }) as HTMLButtonElement).disabled).toBe(true);
    resolveUpdate?.({ ...row, version: 4 });
    await waitFor(() => expect(screen.queryByLabelText('Ghi chú cho lái xe')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sửa ô ghi chú lô hàng BILL-12345' })));
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
    // SIL-485: the Đối soát card carries the finance pair; the custody select
    // retired with the ledger — PHƠI PHIẾU is a display fact now.
    expect(within(dialog).getByRole('heading', { name: 'Đối soát' })).toBeTruthy();
    expect(within(dialog).getByText('Chi phí')).toBeTruthy();
    expect(within(dialog).getByText('Tài chính')).toBeTruthy();
    expect(within(dialog).getByText('Phơi phiếu')).toBeTruthy();
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    // The workflow action rides the header as the ghost icon.
    expect(within(dialog).getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
  });

  it('states unavailable financial confirmation honestly instead of presenting it as pending', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      debitNote: {
        ...row.debitNote,
        billingDocumentId: null,
      },
      accountingConfirmation: {
        status: 'UNAVAILABLE' as const,
        billingDocumentId: null,
        confirmationId: null,
        checksum: null,
        confirmedAt: null,
        confirmedByName: null,
      },
    }]));

    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    expect(within(await screen.findByRole('dialog')).getByText('Chưa đủ dữ liệu đối soát')).toBeTruthy();
    expect(screen.queryByText('Chờ xác nhận')).toBeNull();
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

  it('loads the lot detail lazily when the drawer opens and reads the review cards', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    fireEvent.click(masterRowDetailButton());
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const dialog = await screen.findByRole('dialog');
    // SIL-485: the container sheet carries the lot's rows — read-only, no
    // editors, no finance entry surfaces here.
    const sheet = await within(dialog).findByText('MSKU1234567');
    expect(sheet).toBeTruthy();
    expect(within(dialog).getByRole('columnheader', { name: 'Nhà xe / BKS' })).toBeTruthy();
    expect(within(dialog).getByText('Nhà xe An Phát · 15C-123.45')).toBeTruthy();
    // NHÀ MÁY resolves the line's site id through the detail's own catalog —
    // the same name the CẦNG NÂNG cell shows from its label column.
    expect(within(dialog).getAllByText('Cảng Đình Vũ').length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText('Đã tạo chuyến')).toBeTruthy();
    // Đối soát card values come from the finance derivation, not placeholders.
    expect(within(dialog).getByText(/Lỗ /)).toBeTruthy();
    expect(within(dialog).getByText(/Đã đối soát/)).toBeTruthy();
    expect(within(masterRow()).getByText('Maersk')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Đối soát' })).toBeTruthy();
    expect(screen.queryByText('Cước đầu ra')).toBeNull();
    expect(screen.queryByText('Cước đầu vào')).toBeNull();
    expect(screen.queryByText('Phí chi hộ')).toBeNull();
    expect(screen.queryByText('Chưa thu hồi sửa chữa')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
  });

  it('keeps a clear empty state when a shipment has no container rows', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, containers: [] })
        : Promise.resolve(listResponse())
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    const emptyState = await screen.findByText('Chưa có container trong lô.');
    const dialog = emptyState.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).queryByText(/Chi phí không nhập tại đây/)).toBeNull();
  });

  it('shows the drawer schedule only from its container appointments', async () => {
    const waitingRow = {
      ...row,
      transportDate: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const, transportDateEditable: true },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: waitingRow })
        : Promise.resolve(listResponse([waitingRow]))
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Ngày giao hàng')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Chốt lịch' })).toBeNull();
    expect(within(dialog).getByText('Lịch cont')).toBeTruthy();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('renders locked container detail without active inputs or save controls', async () => {
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      activeLock: {
        id: 91,
        billingDocumentId: 44,
        activatedAt: '2026-08-12T02:00:00.000Z',
        activatedByName: 'CUS',
        reason: 'Đã chốt lô',
      },
      action: { kind: 'REQUEST_REOPEN', label: 'Đề nghị điều chỉnh', enabled: true, disabledReason: null },
    };
    const lockedDetail = {
      ...detail,
      summary: lockedRow,
      containers: detail.containers.map((line) => ({
        ...line,
        permissions: Object.fromEntries(Object.keys(line.permissions).map((key) => [key, false])) as typeof line.permissions,
      })),
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(lockedDetail) : Promise.resolve(listResponse([lockedRow]))
    ));

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    // SIL-485: the whole review is read-only — the sheet renders text cells,
    // not editors; the lot's carrier data stays visible.
    expect(await within(dialog).findByText('Nhà xe An Phát · 15C-123.45')).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
    // The reopen request rides the header icon; the footer "Sửa" is disabled
    // with the accounting-lock reason beside it.
    expect(within(dialog).getByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeTruthy();
    const edit = within(dialog).getByRole('button', { name: 'Sửa' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(within(dialog).getByText('Lô đã khóa kế toán — dữ liệu chỉ đọc.')).toBeTruthy();
  });

  it('navigates to the edit workspace from the drawer footer and gates it by role', async () => {
    // SIL-485: editing leaves the drawer — "Sửa" rides /shipments/:id/edit
    // where ShipmentCreateWorkspace owns the form. The affordance exists only
    // for the intake-mutation roles the edit route guard admits.
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(within(masterRow()).getByRole('button', { name: /Mở chi tiết lô hàng/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sửa' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('shipment-edit-page')).toBeTruthy();

    // A viewer the edit route refuses (ACCOUNTANT) never sees the button.
    authState.user.role = Role.ACCOUNTANT;
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const secondDialog = await screen.findByRole('dialog');
    expect(within(secondDialog).queryByRole('button', { name: 'Sửa' })).toBeNull();
    authState.user.role = Role.CUS;
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
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    apiPost.mockRejectedValueOnce(new Error('Mất kết nối'));

    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const firstKey = (apiPost.mock.calls[0]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(firstKey).toBe('00000000-0000-4000-8000-000000000001');
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
    expect(thirdKey).toBe('00000000-0000-4000-8000-000000000002');
    expect(thirdKey).not.toBe(firstKey);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    randomUUID.mockRestore();
  });

  it('uses an unbounded, sticky, keyboard-focusable dashboard without horizontal overflow', () => {
    expect(css).toMatch(/\.cus-dashboard-viewport\s*\{[^}]*overflow-x:\s*clip;/);
    // Re-measured 2026-09-28 at 1440px: the split follows what each column
    // actually holds, but the contract is unchanged — all seven columns pin an
    // explicit percentage (table-layout: fixed only measures from the FIRST
    // rendered row, so an `auto` column clips real names on later rows) and the
    // seven shares still sum to 100%.
    const columnWidths = [...css.matchAll(/col\.cus-dashboard-col--[a-z]+\s*\{[^}]*width:\s*(\d+)%\s*;/g)]
      .map(([, percent]) => Number(percent));
    // The contract is structural, not numeric: all seven columns pin an
    // explicit percentage and the seven shares sum to 100%. The individual
    // percentages follow what each column actually holds and are re-measured
    // as the data shape moves (2026-09-28: classification 9%→13%, notes
    // 14%→10% after the header wrapped to four lines and the notes column
    // printed "Thêm ghi chú" on nearly every row).
    expect(columnWidths).toHaveLength(7);
    expect(columnWidths.reduce((sum, percent) => sum + percent, 0)).toBe(100);
    expect(css).not.toMatch(/\.cus-dashboard-viewport\s*\{[^}]*max-height/);
    expect(css).toMatch(/\.cus-dashboard-table\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-dashboard-table thead th\s*\{[\s\S]*?position:\s*sticky;/);
    expect(recordCss).not.toMatch(/grid-template-columns:\s*(?:76px|98px|minmax\(112px)/);
    expect(responsiveCss).not.toContain('#root .cus-dashboard-table');
    expect(css).toMatch(/\.cus-quick-edit-modal__fields input:not\(\[data-uui-control\] > input\),[\s\S]*?min-height:\s*38px;/);
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
    expect(source).toContain("placeholder: 'Bill, Book, Mã lô, Cont, Tờ khai, khách hàng...'");
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
    expect(css).toMatch(/\.cus-quick-edit-modal__fields input:not\(\[data-uui-control\] > input\),[\s\S]*?\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.cus-quick-edit-modal__fields input:not\(\[data-uui-control\] > input\),[\s\S]*?\{[^}]*box-sizing:\s*border-box;/);
    expect(css).toMatch(/\.cus-quick-edit-modal__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-quick-edit-modal__help\s*\{[^}]*font-size:\s*var\(--text-caption-size\);/);
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

  it('renders the classification quick-edit select in the modal field system', () => {
    const quickEdit = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusQuickEdit.tsx'), 'utf8');
    const classificationSelect = quickEdit.match(/<UuiSelectField[\s\S]*?label="Xuất \/ Nhập"[\s\S]*?\/>/)?.[0] ?? '';
    expect(classificationSelect).toContain('label="Xuất / Nhập"');
    // `inline` is the filter-toolbar layout; inside a half-width modal column
    // it crushed the label into a wrap.
    expect(classificationSelect).not.toContain('inline');
    // The vendored trigger carries its own Tailwind skin (the shared boundary
    // selectors match markup this Select never renders), so the modal conforms
    // label + trigger metrics locally instead of via UuiSelectField.css.
    expect(css).toMatch(/\.cus-quick-edit-modal__fields \.ds-uui-select label\s*\{[^}]*color:\s*var\(--ink-2\);[^}]*font-size:\s*var\(--text-label-size\);[^}]*font-weight:\s*var\(--fw-semibold\);/);
    // 8px, not 7px: commit cd862de4 moved the app-wide control radius to 8px
    // as the design-system standard (7px survives only in utilities.css).
    expect(css).toMatch(/\.cus-quick-edit-modal__fields \.ds-uui-select button\s*\{[^}]*min-height\s*:\s*38px\s*;[^}]*border-radius\s*:\s*8px\s*;[^}]*font-size\s*:\s*var\(--control-field-font-size\)\s*;/);
    expect(css).toMatch(/\.cus-quick-edit-modal__fields \{ grid-template-columns:\s*1fr; \}[\s\S]*?\.cus-quick-edit-modal__fields \.ds-uui-select button\s*\{[^}]*min-height:\s*var\(--control-max-h\);/);
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

  it('clamps identity factory/route lines at two lines with the full name accessible (card 191026181942)', () => {
    // Clamped at 2 lines so free wrap cannot stretch rows raggedly taller
    // than neighbors; the sanctioned §4 fallback keeps the full value
    // reachable — now through the shared NameCell (title + aria-label +
    // focusable reveal), not a bare title attribute.
    expect(css).toMatch(/\.cus-dashboard-cell--identity \.cus-multiline-cell span\s*\{[^}]*-webkit-line-clamp:\s*2;/);
    expect(css).toMatch(/\.cus-dashboard-cell--identity \.cus-multiline-cell span\s*\{[^}]*overflow:\s*hidden;/);
    const row = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusShipmentRow.tsx'), 'utf8');
    expect(row).toMatch(/<NameCell name=\{item\.factoryName\} \/>/);
    expect(row).toMatch(/<NameCell name=\{item\.routeName \|\| item\.deliveryLocation\} \/>/);
  });

  it('CUS-OVERVIEW-01 rides the label on the value line and wraps complete identifiers without inherited fixed columns', () => {
    // The dense rework (operator 2026-09-27) makes the trigger a single inline
    // fact run: the label flows in the text BEFORE the first value
    // ("Hàng hóa  Chưa có hàng hóa"), one line saved per cell. The
    // `grid-template-columns: auto minmax(0, 1fr)` label/value grid it
    // replaced is gone for good — re-measured 2026-09-28 at 390px it gave the
    // label ~70px and left the value a ~100px strip, so "Chưa có Bill/Book"
    // wrapped to two lines and the card measured 241px.
    expect(recordCss).not.toMatch(/\.cus-inline-trigger:has\(\.cus-multiline-cell\)/);
    // The fact stack is inline too, so a second fact continues on the SAME
    // line as the label instead of starting one (`display: grid` here is what
    // kept every card two lines taller than the text needs).
    expect(recordCss).toMatch(/\.cus-dashboard-table \.cus-multiline-cell\s*\{[^}]*display\s*:\s*inline\s*;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*display\s*:\s*inline\s*;[^}]*width\s*:\s*auto\s*;[^}]*margin\s*:\s*0 6px 0 0\s*;[^}]*content\s*:\s*attr\(data-cell-label\)\s*;/);
    expect(recordCss).toMatch(/\.cus-multiline-cell span\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(recordCss).not.toMatch(/grid-template-columns:\s*(?:76px|98px|minmax\(112px)/);
    expect(responsiveCss).not.toContain('#root .cus-dashboard-table');
  });

  it('renders giờ before ngày in schedule quick-edit fields with 24h format', () => {
    const quickEdit = readFileSync(resolve(process.cwd(), 'src/features/shipments/cus/CusQuickEdit.tsx'), 'utf8');
    const scheduleBlock = quickEdit.match(/draft\.field === 'schedule' && <>([\s\S]*?)<\/>/)?.[1] ?? '';
    const timeIndex = scheduleBlock.indexOf('<TimeInput');
    const dateIndex = scheduleBlock.indexOf('<BufferedUuiDateInput');
    expect(timeIndex).toBeGreaterThan(-1);
    expect(dateIndex).toBeGreaterThan(-1);
    expect(timeIndex).toBeLessThan(dateIndex);
    expect(scheduleBlock).not.toContain('type="time"');
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
    expect(search.placeholder).toBe('Bill, Book, Mã lô, Cont, Tờ khai, khách hàng...');
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
});
