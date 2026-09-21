import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
// 2026-09-19: the flat filter rail wave extracted the filter controls into
// the shared WorkboardFilters component — source assertions follow the markup into that file.
const filtersSource = readFileSync(resolve(process.cwd(), 'src/components/WorkboardFilters.tsx'), 'utf8');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const recordCss = css.slice(css.indexOf('@media (max-width: 999px)'), css.indexOf('@media (max-width: 620px)'));
const filterCss = css.slice(css.indexOf('@container cus-workboard'));
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
    declarations: [{ id: 9, declarationNumber: 'TK-54321', channel: null, issuedAt: null, scope: 'SINGLE', note: null }],
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

function listResponse(items = [row]) {
  return {
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    pageSummary: {
      needsSchedule: items.filter((item) => item.operational.scheduleReadiness === 'WAITING_DATE').length,
      needsVehicle: items.filter((item) => ['WAITING_CARRIER', 'WAITING_PLATE'].includes(item.operational.vehicleReadiness)).length,
      waitingAccounting: items.filter((item) => (
        item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE'
      )).length,
      readyToLock: items.filter((item) => item.action.kind === 'LOCK' && item.action.enabled).length,
      needsAttention: items.filter((item) => item.finance.isLoss || item.finance.hasPendingRecovery).length,
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

function masterRowDetailButton(): HTMLButtonElement {
  const element = document.querySelector('button.cus-dashboard-detail');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment detail button not rendered');
  return element;
}

describe('ShipmentsPage — CUS closeout workspace', () => {
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
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Hóa đơn kết hợp')).toBeNull();
    expect(screen.getByLabelText('Bill/Book hoặc tờ khai').getAttribute('inputmode')).toBe('text');
  });

  it('surfaces API-backed operational priorities before the detailed shipment table', async () => {
    const priorityRow = {
      ...row,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const, vehicleReadiness: 'WAITING_PLATE' as const },
      accountingConfirmation: { ...row.accountingConfirmation, status: 'PENDING' as const },
    };
    apiGet.mockResolvedValue(listResponse([priorityRow]));

    renderPage();

    const summary = await screen.findByRole('region', { name: 'Tóm tắt ưu tiên xử lý' });
    expect(within(summary).getByText('Lô phù hợp')).toBeTruthy();
    expect(within(summary).getByText('Chưa chốt lịch')).toBeTruthy();
    expect(within(summary).getByText('Chờ điều xe')).toBeTruthy();
    expect(within(summary).getByText('Chờ đối soát')).toBeTruthy();
    expect(within(summary).getAllByText('1')).toHaveLength(4);
    expect(summary.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // 2026-09-18: the bar applies live (one apply model); an invalid draft is
  // never sent, and Enter/submit is what surfaces the validation message.
  it('applies a valid suffix as typed and rejects an invalid draft on submit', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Bill/Book hoặc tờ khai');

    fireEvent.change(input, { target: { value: 'A12' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert').textContent).toContain('Nhập một phần số Bill/Book, container hoặc tờ khai');
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('searchSuffix=A12'));

    fireEvent.change(input, { target: { value: 'AB$1' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert').textContent).toContain('Nhập một phần số Bill/Book, container hoặc tờ khai');

    fireEvent.change(input, { target: { value: 'aB12C' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=aB12C')));
  });

  it('accepts the full Bill/Booking number, not only a 4-5 char suffix (2026-09-09 report)', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Bill/Book hoặc tờ khai');

    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=MSCU6639870')));
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
    expect(surface.getAllByText(/12\/8\/2026/).length).toBeGreaterThan(0);
    // The overview only shows explicit container appointments; it must not
    // repeat the nearest closing/return time from plannedReturnAt.
    expect(surface.queryByText('17:00 · trả hàng')).toBeNull();
    // Per-container appointment groups: one line per distinct close/return
    // datetime, with the container-type mix of that group.
    expect(surface.getByText('09:30 12/8/2026 · Nhà máy ABC · 1x40HC')).toBeTruthy();
    expect(surface.getByText('16:30 12/8/2026 · Nhà máy ABC · 1x20GP')).toBeTruthy();
    expect(masterRowDetailButton().textContent).toContain('Chi tiết');
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn cột hiển thị' })).toBeNull();

    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Trạng thái lô' })).toBeTruthy();
    expect(within(dialog).getByRole('row', { name: 'MSKU1234567' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
  });

  it('does not repeat the shipment-level closing or return date before container appointments', async () => {
    apiGet.mockResolvedValue(listResponse([{ ...row, transportDate: '2026-08-19' }]));
    renderPage();

    const scheduleCell = (await screen.findByText('09:30 12/8/2026 · Nhà máy ABC · 1x40HC')).closest('td');
    expect(scheduleCell).toBeTruthy();
    expect(within(scheduleCell!).queryByText('19/8/2026')).toBeNull();
    expect(within(scheduleCell!).getByText('09:30 12/8/2026 · Nhà máy ABC · 1x40HC')).toBeTruthy();
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
    expect(statusCell?.querySelector('.cus-row-actions__summary')).toBeTruthy();
    expect(within(statusCell!).getByRole('button', { name: /Mở chi tiết lô hàng BILL-12345/ }).textContent).toContain('Chi tiết');
    expect(css).toContain('.cus-dashboard-detail {');
    expect(recordCss).toMatch(/\.cus-row-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*space-between;/);
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
    expect(within(masterRow()).getByText('25.000 kg · 52,5 CBM')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Xuất \/ Nhập/i }));
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

  it('clears an applied suffix immediately from the search-field control', async () => {
    renderPage('/shipments?searchSuffix=AB12');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));

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
    expect(recordCss).toMatch(/\.cus-dashboard-table tbody > tr > td\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(recordCss).toMatch(/td\[data-label='Phân loại & hãng tàu'\],[\s\S]*?td\[data-label='Tổng quan hàng hóa'\]\s*\{[^}]*grid-column:\s*auto;/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/\.cus-quick-edit-modal__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(source).toMatch(/<Modal[\s\S]*?maxWidth=\{480\}[\s\S]*?cus-quick-edit-modal/);
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
    expect(css).toMatch(/\.cus-dashboard-table tbody > tr\.cus-dashboard-row--waiting > td\[data-label='Lịch trình & điều xe'\]\s*\{[^}]*background:/);
    expect(css).not.toMatch(/\.cus-dashboard-table tbody > tr\.cus-dashboard-row--waiting > th\s*\{/);
    expect(css).toMatch(/--waiting > td\[data-label='Lịch trình & điều xe'\] \.cus-inline-trigger:not\(:disabled\):hover\s*\{[^}]*background:\s*color-mix/);
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

  it('CUS-OVERVIEW-04 keeps empty notes addable through the existing named edit action', async () => {
    apiGet.mockResolvedValue(listResponse([{
      ...row,
      customerNotes: null,
      operationalNotes: null,
      raw: { ...row.raw, customerNotes: null, operationalNotes: null },
    }]));
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

  it('CUS-OVERVIEW-02 links the compact filter toggle to its panel and preserves chosen criteria across collapse', async () => {
    renderPage();
    await screen.findByRole('table');
    const toggle = screen.getByRole('button', { name: /^Bộ lọc nâng cao/ });
    expect(toggle.textContent).toContain('Bộ lọc');
    expect(toggle.textContent).not.toContain('nâng cao');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controlledId = toggle.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    const panel = document.getElementById(controlledId!);
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('data-open')).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hasAttribute('data-open')).toBe(true);
    fireEvent.click(within(panel!).getByRole('button', { name: /Xuất \/ Nhập/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Xuất' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Điều kiện đang áp dụng').textContent).toContain('Xuất');
    fireEvent.click(toggle);
    expect(within(panel!).getByRole('button', { name: /Xuất \/ Nhập/ }).textContent).toContain('Xuất');
    expect(panel?.hasAttribute('data-open')).toBe(true);
    expect(String(apiGet.mock.calls.at(-1)?.[0])).toContain('direction=EXPORT');
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
      // Card _5: the body states the channel explicitly (null = cleared).
      channel: null,
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
      // Card _5: explicit channel (null when unset) rides the create body too.
      channel: null,
      issuedAt: null,
      note: null,
    }));
    expect(apiPut).not.toHaveBeenCalledWith(expect.stringContaining('/declarations'));
    expect(await screen.findByText('Đã cập nhật chứng từ lô hàng.')).toBeTruthy();
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

  it('opens one compact edit dialog from the cell control and reserves the drawer for Chi tiết', async () => {
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
    expect(await within(masterRow()).findByText('20:03 19/9/26')).toBeTruthy();
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



  it('uses exactly one full-cell button to open the matching edit dialog', async () => {
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

  it('opens the governed shipment controls from the row button', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Điều hành lô hàng')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Trạng thái lô' })).toBeTruthy();
    expect(within(dialog).getByText('Đối soát chi phí')).toBeTruthy();
    expect(within(dialog).queryByText('Hành động tiếp theo')).toBeNull();
    expect(within(dialog).getByText('Đối soát tài chính')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Phơi phiếu/i }));
    expect(screen.getByRole('option', { name: 'Chưa xác định' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
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
    const reason = within(dialog).getByText('Xác nhận Kế toán đã hết hiệu lực.');
    const action = within(dialog).getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement;
    expect(reason).toBeTruthy();
    expect(action.disabled).toBe(true);
    expect(action.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('loads operational container detail lazily and keeps finance entry outside the expansion', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    fireEvent.click(masterRowDetailButton());
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const ledger = await screen.findByLabelText('Chi tiết container');
    expect(within(ledger).getByText('MSKU1234567')).toBeTruthy();
    expect(within(ledger).getByRole('columnheader', { name: 'Container' })).toBeTruthy();
    expect(within(ledger).getByRole('columnheader', { name: 'Nhà xe' })).toBeTruthy();
    expect(within(ledger).getByText('Giờ hẹn đóng/trả')).toBeTruthy();
    expect(within(masterRow()).getByText('Maersk')).toBeTruthy();
    expect(within(ledger).queryByText('Maersk')).toBeNull();
    expect(within(ledger).getByText('Đã tạo chuyến')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tất' })).toBeTruthy();
    expect(screen.getByLabelText(/Biển số xe của container MSKU1234567/)).toBeTruthy();
    const containerType = within(ledger).getByRole('button', { name: 'Loại container MSKU1234567' });
    expect(containerType.textContent).toBe('40HC');
    expect(containerType.textContent).not.toContain('Container 40HC');
    expect(within(ledger).getByText('40HC', { selector: '.csc-container-cell__display' })).toBeTruthy();
    expect(within(ledger).getByText('Nhà xe An Phát', { selector: '.csc-container-cell__display' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
    expect(within(ledger).queryByText(/Chi phí không nhập tại đây/)).toBeNull();
    expect(screen.queryByText('Cước đầu ra')).toBeNull();
    expect(screen.queryByText('Cước đầu vào')).toBeNull();
    expect(screen.queryByText('Phí chi hộ')).toBeNull();
    expect(screen.queryByText('Chưa thu hồi sửa chữa')).toBeNull();
  });

  it('protects unsaved container changes when closing the drawer', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-888.88' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancels an individual container draft with Escape', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const plate = await screen.findByLabelText(/Biển số xe của container MSKU1234567/);
    fireEvent.change(plate, { target: { value: '15C-555.55' } });
    fireEvent.keyDown(plate, { key: 'Escape' });

    expect((screen.getByLabelText(/Biển số xe của container MSKU1234567/) as HTMLInputElement).value).toBe('15C-123.45');
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('asks before closing the mobile container drawer with unsaved changes', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-777.77' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bỏ thay đổi và đóng' })).toBeTruthy();

    window.ResizeObserver = originalResizeObserver;
  });

  it('keeps the mobile drawer open while a container save is in progress', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;
    let resolveSave: ((value: { line: typeof detail.containers[0] }) => void) | undefined;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-666.66' } });
    fireEvent.keyDown(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeNull();
    expect(screen.getByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeTruthy();
    resolveSave?.({ line: { ...detail.containers[0], plateNumber: '15C-666.66', shipmentVersion: 4 } });
    await waitFor(() => expect(screen.queryByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeNull());

    window.ResizeObserver = originalResizeObserver;
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

    const emptyState = await screen.findByText('Lô hàng chưa có dữ liệu container.');
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

  it.each(['appointment', 'plate'] as const)('VID-CUS-DRAWER keeps the save lifecycle mounted when %s moves its row out of the list', async (field) => {
    const waitingRow = { ...row, transportDate: null, appointmentGroups: [], customerAppointmentAts: [], operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const } };
    const waitingDetail = { ...detail, summary: waitingRow, containers: [{ ...detail.containers[0], customerAppointmentAt: null }] };
    let saved = false;
    apiGet.mockImplementation((url: string) => Promise.resolve(url === '/shipments/cus-workspace/1' ? waitingDetail : listResponse(saved ? [] : [waitingRow])));
    apiPost.mockImplementationOnce(async () => {
      saved = true;
      return { line: { ...waitingDetail.containers[0], shipmentVersion: 4, ...(field === 'appointment' ? { customerAppointmentAt: '2026-09-24T08:17:00.000Z' } : { plateNumber: '15C-666.66' }) } };
    });
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    await screen.findByLabelText('Chi tiết container');
    if (field === 'appointment') {
      fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả/ }));
      // Segmented pair: the first segment of each part distributes a full
      // pasted string across its segments.
      const hourInput = document.querySelector<HTMLInputElement>('[data-split-datetime] input[data-seg="hh"]')!;
      const dayInput = document.querySelector<HTMLInputElement>('[data-split-datetime] input[data-seg="dd"]')!;
      fireEvent.change(hourInput, { target: { value: '15:17' } });
      fireEvent.change(dayInput, { target: { value: '24/09/2026' } });
      fireEvent.keyDown(hourInput, { key: 'Enter' });
    } else {
      const plate = screen.getByLabelText(/Biển số xe của container MSKU1234567/);
      fireEvent.change(plate, { target: { value: '15C-666.66' } });
      fireEvent.keyDown(plate, { key: 'Enter' });
      await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace?page=1&limit=20')).toHaveLength(2));
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0][1]).toEqual(expect.objectContaining(field === 'appointment' ? { customerAppointmentAt: '2026-09-24T15:17:00+07:00' } : { plateNumber: '15C-666.66' }));
    expect(screen.queryByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeNull();
  });

  it('saves only the server-permitted container fields with optimistic versions', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        plateNumber: '15C-999.99',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    const plate = await screen.findByLabelText(/Biển số xe của container MSKU1234567/);
    expect(screen.getByLabelText(/Loại container MSKU1234567/)).toBeTruthy();
    fireEvent.change(plate, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: /Giờ hẹn đóng hoặc trả tại nhà máy của container MSKU1234567/ }));
    // Segmented pair — complete time + date text publishes the contract
    // (pasted into the first segment of each part).
    const hourInput = document.querySelector<HTMLInputElement>('[data-split-datetime] input[data-seg="hh"]')!;
    const dayInput = document.querySelector<HTMLInputElement>('[data-split-datetime] input[data-seg="dd"]')!;
    fireEvent.change(hourInput, { target: { value: '10:30' } });
    fireEvent.change(dayInput, { target: { value: '14/08/2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        plateNumber: '15C-999.99',
        // Naive popover drafts persist as Vietnam wall-clock (+07:00) — pinned,
        // not the test-runner timezone's UTC the old parse produced.
        customerAppointmentAt: '2026-08-14T10:30:00+07:00',
      }),
      expect.any(Object),
    ));
    const [, payload] = apiPost.mock.calls[0] ?? [];
    expect(payload.outboundCharges).toBeUndefined();
    expect(payload.inboundCharges).toBeUndefined();
    expect(await screen.findByText('Đã lưu dữ liệu container. Kế toán cần đối soát dữ liệu mới nhất trước khi khóa lô.')).toBeTruthy();
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace?page=1&limit=20').length).toBeGreaterThan(1));
  });

  it('saves the container route from the CUS dashboard ledger when the plan needs one', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        routeId: 9,
        routeName: 'Đình Vũ — Quốc lộ 5',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    const ledger = await screen.findByLabelText('Chi tiết container');
    expect(within(ledger).getByRole('columnheader', { name: 'Tuyến' })).toBeTruthy();
    fireEvent.click(within(ledger).getByRole('button', { name: /Tuyến đường của container MSKU1234567/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đình Vũ — Quốc lộ 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        routeId: 9,
      }),
      expect.any(Object),
    ));
  });

  // 2026-09-19 (card _D2 wave): this test flaked red once on FullStack's
  // parity run and passes isolated at the same sha — the default 5000ms
  // per-test timeout is tight for this 90-test suite on the slow-SSD
  // external-volume checkout (module graph cold-paging). 15000ms covers the
  // p95 without masking real hangs; scoped to this test, not blanket.
  it('keeps a sibling container draft while refreshing its shipment version after another save',
    { timeout: 15000 }, async () => {
    const secondLine = { ...detail.containers[0], id: 11, ordinal: 2, containerNumber: 'MSKU7654321', plateNumber: '15C-456.78' };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, containers: [detail.containers[0], secondLine] })
        : Promise.resolve(listResponse())
    ));
    apiPost
      .mockResolvedValueOnce({ line: { ...detail.containers[0], plateNumber: '15C-999.99', shipmentVersion: 4 } })
      .mockResolvedValueOnce({ line: { ...secondLine, plateNumber: '15C-888.88', shipmentVersion: 5 } });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    fireEvent.change(await screen.findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-999.99' } });
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU7654321/), { target: { value: '15C-888.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace?page=1&limit=20').length).toBeGreaterThan(1));
    fireEvent.click(masterRowDetailButton());
    expect(((await screen.findByLabelText(/Biển số xe của container MSKU7654321/)) as HTMLInputElement).value).toBe('15C-888.88');
  });

  // 2026-09-19 slow-SSD external-volume bump (BE dispatch, LEAD option a):
  // cold module-graph paging makes the 5s default structurally tight for this
  // suite; 15s covers p95 without masking real hangs. Live-flaked at 5334ms.
  it('creates a new external carrier through the container workflow', { timeout: 15000 }, async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        carrierName: 'Nhà xe Tân Cảng',
        plateNumber: '51D-888.99',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());

    fireEvent.click(await screen.findByRole('button', { name: 'Thêm nhà xe' }));
    fireEvent.change(screen.getByLabelText('Tên nhà xe mới'), { target: { value: 'Nhà xe Tân Cảng' } });
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '51D-888.99' } });
    fireEvent.keyDown(screen.getByLabelText(/Biển số xe của container MSKU1234567/), { key: 'Enter' });

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        carrierType: 'EXTERNAL',
        newExternalCarrier: {
          name: 'Nhà xe Tân Cảng',
          plateNumber: '51D-888.99',
        },
      }),
      expect.any(Object),
    ));
    const payload = apiPost.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.externalCarrierId).toBeUndefined();
    expect(payload.externalCarrierVehicleId).toBeUndefined();
    expect(payload.plateNumber).toBeUndefined();
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
    expect(await screen.findByText('15C-123.45')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
    expect(screen.queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
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
    expect(css).toMatch(/\.cus-dashboard-table col\.cus-dashboard-col--status\s*\{[^}]*width:\s*15%;/);
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
    expect(source + filtersSource).toContain('inputClassName="shipment-uui-control__input shipment-uui-control__input--search"');
    expect(source + filtersSource).not.toContain('className="cus-filter-field shipment-uui-field"');
    for (const label of ['Bill/Book hoặc tờ khai', 'Từ ngày giao', 'Đến ngày giao']) {
      expect(source + filtersSource).toMatch(new RegExp(`label="${label.replace('/', '\\/')}"\\s+size="sm"`));
    }
    for (const label of ['Xuất / Nhập', 'Kế hoạch']) {
      expect(source + filtersSource).toMatch(new RegExp(`label="${label.replace('/', '\\/')}"\\s+value=`));
    }
    expect(css).not.toMatch(/\.cus-worksheet-toolbar \.shipment-uui-field \[data-label\]\s*\{[^}]*margin-bottom:/);
    expect(css).toMatch(/\.shipment-uui-control__input--search\s*\{[^}]*padding-left:\s*32px;/);
    expect(css).not.toMatch(/\.shipment-uui-control__input\s*\{[^}]*(?:height|min-height):/);
    // 2026-09-18 flat filter rail: one self-sizing template for every filter,
    // the disclosure is not a layout box, and the page actions left the form.
    expect(css).toMatch(/\.cus-worksheet-toolbar__filters\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 150px\), 1fr\)\);/);
    expect(css).toMatch(/\.cus-worksheet-advanced\s*\{\s*display:\s*contents;\s*\}/);
    expect(css).not.toMatch(/\.cus-worksheet-advanced\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(120px/);
    expect(css).not.toContain('.cus-worksheet-toolbar__actions');
    expect(source).toMatch(/action=\{canCreateShipment && <UUIButton/);
    // Container codes: one line, never bold, copy icon in the ordinal slot
    // (user ruling 2026-09-18).
    expect(css).toMatch(/\.cus-container-cell--identity strong\s*\{[^}]*font-weight:\s*400;[^}]*white-space:\s*nowrap;/);
    // 2026-09-18 relocation ruling: the copy affordance replaces the ordinal on
    // hover — same top-right slot, never over the container number.
    expect(css).toMatch(/\.cus-container-row__copy\s*\{[^}]*left:\s*auto;[^}]*right:\s*12px;/);
    expect(source).toContain('cus-workspace-summary__export');
    expect(css).toMatch(/\.cus-worksheet-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    // CUS-OVERVIEW-02: search and disclosure share a row, while the revealed
    // criteria and their summary span the complete toolbar grid.
    expect(filterCss).toMatch(/\.cus-worksheet-toolbar__filters\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    // The wide rail's two-track search must not survive here: it collapsed the
    // auto track and pushed the disclosure onto a full-width row of its own.
    expect(filterCss).toMatch(/\.cus-search-field\s*\{\s*grid-column:\s*auto;\s*\}/);
    expect(filterCss).toMatch(/\.cus-worksheet-advanced\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(filterCss).toMatch(/\.cus-active-filter-summary\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/\.cus-multiline-cell--mono strong\s*\{[^}]*font-size:\s*var\(--ops-table-primary-size\);/);
    expect(rowSource).toContain('cus-cargo-summary__containers');
    expect(rowSource).toContain('kg ·');
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
    expect(css).toMatch(/@container shipment-drawer \(max-width: 700px\)[\s\S]*?\.cus-drawer-decision-grid\s*\{\s*grid-template-columns:\s*1fr 1fr;/);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.cus-drawer-decision-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('keeps the shipment drawer flat, compact, and honest about blocked actions', () => {
    expect(css).toMatch(/\.cus-shipment-drawer\s*\{[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.cus-container-table\s*\{[^}]*border-collapse:\s*collapse;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-drawer-workflow__action--blocked::before\s*\{[^}]*background:\s*var\(--warning\);/);
    expect(source).toContain("color={item.action.enabled ? 'primary' : 'secondary'}");
  });

  it('uses distinct semantic colors for running and locked shipments', () => {
    expect(cusUtilsSource).toMatch(/\[ShipmentCusBucket\.RUNNING\]:\s*'var\(--accent\)'/);
    expect(cusUtilsSource).toMatch(/\[ShipmentCusBucket\.LOCKED\]:\s*'var\(--slate-4\)'/);
    expect(css).toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*background:\s*var\(--slate-5\);[^}]*color:\s*var\(--slate-4\);/);
    // Base rule must precede the bucket modifiers or its border shorthand
    // overrides their border-color by source order.
    expect(css.indexOf('.cus-workflow-badge {')).toBeGreaterThan(-1);
    expect(css.indexOf('.cus-workflow-badge {')).toBeLessThan(css.indexOf('.cus-workflow-badge--new'));
    expect(css).toMatch(/\.cus-workflow-badge--new\s*\{[^}]*border-color:\s*var\(--line-2\);/);
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
    expect(css).toMatch(/\.cus-multiline-cell\.cus-classification\s*\{[^}]*grid-template-areas:[\s\S]*?"shipping-line shipping-line"[\s\S]*?"combined direction";[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.cus-classification \.cus-direction-badge\s*\{[^}]*grid-area:\s*direction;[^}]*align-self:\s*end;[^}]*justify-self:\s*end;/);
    expect(css).toMatch(/\.cus-direction-badge,[\s\S]*?\.cus-combined-tag\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*min-height:\s*22px;/);
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
    expect(css).toMatch(/\.cus-quick-edit-modal__fields \.ds-uui-select button\s*\{[^}]*min-height:\s*38px;[^}]*border-radius:\s*7px;[^}]*font-size:\s*var\(--control-field-font-size\);/);
    expect(css).toMatch(/\.cus-quick-edit-modal__fields \{ grid-template-columns:\s*1fr; \}[\s\S]*?\.cus-quick-edit-modal__fields \.ds-uui-select button\s*\{[^}]*min-height:\s*44px;/);
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

  it('keeps factory and route lines in the CUS identity cell readable without truncation', () => {
    expect(css).toMatch(/\.cus-dashboard-cell--identity \.cus-multiline-cell span\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
  });

  it('CUS-OVERVIEW-01 gives labels their own line and wraps complete identifiers without inherited fixed columns', () => {
    expect(recordCss).toMatch(/\.cus-inline-trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(recordCss).toMatch(/\.cus-inline-trigger::before\s*\{[^}]*position:\s*static;[^}]*white-space:\s*normal;/);
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
