import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatResponse, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { formatVietnamDateInput } from '../lib/shipment-operations';

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: apiPut },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, public readonly raw: unknown, message: string) { super(message); }
  },
}));

import { ApiError } from '../lib/api';
import ShipmentContainersPage from './ShipmentContainersPage';

const today = formatVietnamDateInput(new Date());
const tomorrow = formatVietnamDateInput(new Date(Date.now() + 86_400_000));
const directContainerAccess = {
  containerNumber: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  containerTypeId: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  cargoWeightKg: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  cargoVolumeCbm: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  routeId: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  liftSiteId: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  dropoffSiteId: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
};
const directShipmentAccess = Object.fromEntries([
  'customerId', 'factoryName', 'routeId', 'deliveryLocation', 'blNumber', 'bookingRef', 'declarationNumber', 'tradeDirection', 'shippingLineName',
  'packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm', 'customsCutoffAt', 'closingAt', 'plannedReturnAt', 'customerNotes', 'operationalNotes',
].map((key) => [key, { mode: 'DIRECT', reason: 'Có thể sửa.' }])) as ShipmentCusWorkspaceDetail['summary']['fieldAccess'];
const response: ShipmentCusContainerFlatResponse = {
  page: 1,
  limit: 20,
  total: 2,
  totalPages: 1,
  filterOptions: { customers: [{ id: 7, name: 'Công ty Silver Sea' }] },
  items: [
    {
      id: 11, shipmentId: 1, shipmentVersion: 4, ordinal: 1, customerId: 7, isAdHoc: false,
      customerName: 'Công ty Silver Sea', factoryName: 'Nhà máy Hải Phòng', routeName: 'Đình Vũ → Hải Phòng',
      billOrBookNumber: 'BILL-12345', declarationNumber: 'TK-001', shippingLineName: 'MSC', isCombined: true, classification: 'COMBINED', direction: 'IMPORT',
      containerNumber: 'CONT-001', containerTypeLabel: '40HC', dispatchStatus: 'AWAITING_VEHICLE', carrierName: 'SilverSea', plateNumber: '30H-123.45',
      liftSite: 'Bãi CY', dropoffSite: 'Nhà máy Hải Phòng', transportDate: today, closingAt: null, plannedReturnAt: `${today}T08:00:00.000Z`, customerAppointmentAt: null,
      customerNotes: 'Lưu ca sáng', operationalNotes: 'Ưu tiên cổng 2', shipmentScheduleEditable: false, shipmentNotesEditable: false,
      informationStatus: 'COMPLETE', missingFields: [],
      raw: { containerNumber: 'CONT-001', containerTypeId: 1, cargoWeightKg: '25000', cargoVolumeCbm: '52.5' }, fieldAccess: directContainerAccess,
      shipmentFieldAccess: directShipmentAccess,
      carrierEditable: false, plateEditable: false, liftSiteEditable: false, dropoffSiteEditable: false, routeEditable: false, customerAppointmentEditable: false, scheduleEditable: false,
    },
    {
      id: 12, shipmentId: 2, shipmentVersion: 7, ordinal: 1, customerId: 7, isAdHoc: false,
      customerName: 'Công ty Silver Sea', factoryName: 'Nhà máy Hưng Yên', routeName: 'Cảng → Hưng Yên',
      billOrBookNumber: 'BOOK-67890', declarationNumber: null, shippingLineName: 'CMA CGM', isCombined: false, classification: 'DOUBLE', direction: 'EXPORT',
      containerNumber: 'CONT-002', containerTypeLabel: '20DC', dispatchStatus: 'AWAITING_VEHICLE', carrierName: null, plateNumber: null,
      liftSite: null, dropoffSite: null, transportDate: null, closingAt: null, plannedReturnAt: null, customerAppointmentAt: null,
      customerNotes: null, operationalNotes: null, shipmentScheduleEditable: true, shipmentNotesEditable: true,
      informationStatus: 'MISSING', missingFields: [
        { code: 'TRANSPORT_DATE', label: 'Ngày vận chuyển' },
        { code: 'LIFT_SITE', label: 'Điểm nhận hàng' },
        { code: 'DROPOFF_SITE', label: 'Điểm trả hàng' },
        { code: 'APPOINTMENT', label: 'Lịch hẹn' },
      ],
      raw: { containerNumber: 'CONT-002', containerTypeId: 2, cargoWeightKg: null, cargoVolumeCbm: null }, fieldAccess: directContainerAccess,
      shipmentFieldAccess: directShipmentAccess,
      carrierEditable: true, plateEditable: true, liftSiteEditable: true, dropoffSiteEditable: true, routeEditable: true, customerAppointmentEditable: true, scheduleEditable: true,
    },
  ],
};

const detail = {
  summary: {
    id: 2, version: 7, transportDate: null, closingAt: null, plannedReturnAt: null,
    customerNotes: null, operationalNotes: null, operational: { transportDateEditable: true },
    raw: { customerId: 7, factoryName: 'Nhà máy Hưng Yên', routeId: 2, deliveryLocation: null, blNumber: null, bookingRef: 'BOOK-67890', declarationNumber: null, tradeDirection: 'EXPORT', shippingLineName: 'CMA CGM', packageCount: null, packageType: null, cargoWeightKg: null, cargoVolumeCbm: null, customsCutoffAt: null, closingAt: null, plannedReturnAt: null, customerNotes: null, operationalNotes: null, declarationId: null, declarationIssuedAt: null, declarationScope: null, declarationNote: null },
    fieldAccess: directShipmentAccess,
  },
  containers: [{
    id: 12, ordinal: 1, containerNumber: 'CONT-002', liftSiteId: 31, liftSite: 'Bãi CY', dropoffSiteId: 32, dropoffSite: 'Nhà máy Hưng Yên',
    externalCarrierId: null, externalCarrierVehicleId: null, plateNumber: null, customerAppointmentAt: null, shipmentVersion: 7,
    permissions: { carrierEditable: true, plateEditable: true, containerTypeEditable: true, liftSiteEditable: true, dropoffSiteEditable: true, customerAppointmentEditable: true },
    raw: { containerNumber: 'CONT-002', containerTypeId: 2, cargoWeightKg: null, cargoVolumeCbm: null },
    fieldAccess: { ...directContainerAccess, carrierType: { mode: 'DIRECT', reason: 'Có thể sửa.' }, externalCarrierId: { mode: 'DIRECT', reason: 'Có thể sửa.' }, externalCarrierVehicleId: { mode: 'DIRECT', reason: 'Có thể sửa.' }, plateNumber: { mode: 'DIRECT', reason: 'Có thể sửa.' }, liftSiteId: { mode: 'DIRECT', reason: 'Có thể sửa.' }, dropoffSiteId: { mode: 'DIRECT', reason: 'Có thể sửa.' }, customerAppointmentAt: { mode: 'DIRECT', reason: 'Có thể sửa.' } },
  }],
  selectors: {
    routes: [{ id: 2, name: 'Cảng → Hưng Yên', label: 'Cảng → Hưng Yên' }],
    operationalSites: [
      { id: 31, siteType: 'WAREHOUSE', code: 'CY', name: 'Bãi CY', label: 'CY · Bãi CY' },
      { id: 32, siteType: 'FACTORY', code: 'HY', name: 'Nhà máy Hưng Yên', label: 'HY · Nhà máy Hưng Yên' },
      { id: 33, siteType: 'WAREHOUSE', code: 'DV', name: 'Cảng Đình Vũ', label: 'DV · Cảng Đình Vũ' },
    ],
    externalCarriers: [{ id: 41, name: 'Nhà xe Bắc', shortName: null, label: 'Nhà xe Bắc' }],
    carrierVehicles: [{ id: 51, carrierId: 41, licensePlate: '15C-123.45', label: '15C-123.45' }],
    containerTypes: [],
    ports: [
      { id: 31, code: 'CY', name: 'Bãi CY', label: 'CY · Bãi CY' },
      { id: 32, code: 'HY', name: 'Cảng Hưng Yên', label: 'HY · Cảng Hưng Yên' },
      { id: 33, code: 'DV', name: 'Cảng Đình Vũ', label: 'DV · Cảng Đình Vũ' },
    ],
  },
} as unknown as ShipmentCusWorkspaceDetail;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
});

describe('ShipmentContainersPage — DOCX container workboard', () => {
  it('loads today by default and renders the seven multi-line groups with warning semantics', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    expect(await screen.findByText('CONT-001')).toBeTruthy();
    // Ghi chú is now BEFORE Trạng thái (customer feedback L2 — 24/08/2026,
    // re-applied after a rebase)
    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent);
    expect(headers).toEqual([
      'Khách hàng & lộ trình',
      'Chứng từ & hãng tàu',
      'Thông số container',
      'Địa điểm nâng / hạ',
      'Lịch trình',
      'Phân xe',
      'Ghi chú',
      'Trạng thái',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Trạng thái' })).toBeTruthy();
    // Dispatch status badge now lives in the Trạng thái column, not the container cell
    const awaitingRow = screen.getByText('CONT-001').closest('tr');
    expect(awaitingRow).toBeTruthy();
    if (!awaitingRow) throw new Error('Expected CONT-001 row to be present');
    const statusCell = awaitingRow.querySelector('td[data-label="Trạng thái"]');
    expect(statusCell).toBeTruthy();
    expect(statusCell?.textContent).toContain('Chờ phân xe');
    // The container cell no longer carries the dispatch status badge
    const containerCell = awaitingRow.querySelector('td[data-label="Thông số container"]');
    expect(containerCell?.querySelector('.shipment-container-ledger__dispatch-badge')).toBeNull();
    expect(containerCell?.querySelector('.shipment-container-ledger__container-classification')?.textContent).toBe('Kết hợp');
    const unassignedRow = screen.getByText('CONT-002').closest('tr');
    const unassignedContainerCell = unassignedRow?.querySelector('td[data-label="Thông số container"]');
    expect(unassignedContainerCell?.querySelector('.shipment-container-ledger__container-classification')?.textContent).toBe('Kẹp');
    expect(screen.getByText('TK-001')).toBeTruthy();
    const documentsCell = screen.getByRole('button', { name: /^Chỉnh sửa ô chứng từ và hãng tàu CONT-001/ });
    expect(documentsCell.textContent).toContain('Nhập');
    expect(documentsCell.textContent).toContain('MSC');
    expect(documentsCell.querySelector('[data-icon]')).toBeNull();
    const documentsTableCell = documentsCell.closest('td');
    expect(documentsTableCell).toBeTruthy();
    expect(documentsTableCell?.classList.contains('shipment-container-ledger__editable-cell')).toBe(true);
    expect(within(documentsTableCell!).getAllByRole('button')).toEqual([documentsCell]);
    expect(screen.getByText('Đóng kết hợp')).toBeTruthy();
    expect(screen.getByText('Lưu ca sáng')).toBeTruthy();
    // The date gap is consolidated into the schedule column: the attention
    // stat and the missing-transport-date chip both carry the same label.
    expect(screen.getAllByText('Thiếu ngày vận chuyển').length).toBeGreaterThanOrEqual(2);
    const identityCell = screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-001/ });
    expect(identityCell.textContent).toContain('Công ty Silver Sea');
    const missingDateIdentityCell = screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ });
    // Missing-data summary stays compact: the full list collapses behind a
    // count disclosure; expanding reveals jump-to-editor items in list order.
    const warningToggle = screen.getByRole('button', { name: /Thiếu 4 thông tin/ });
    const rowWarning = warningToggle.closest<HTMLElement>('.shipment-container-ledger__row-warning');
    expect(rowWarning).toBeTruthy();
    if (!rowWarning) throw new Error('Expected the missing-fields warning wrapper');
    expect(warningToggle.classList.contains('shipment-container-ledger__missing-fields-toggle')).toBe(true);
    expect(warningToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Điểm nhận hàng')).toBeNull();
    fireEvent.click(warningToggle);
    expect(warningToggle.getAttribute('aria-expanded')).toBe('true');
    const missingFieldsList = rowWarning.querySelector('.shipment-container-ledger__missing-fields-list');
    expect(missingFieldsList).toBeTruthy();
    expect(missingFieldsList?.getAttribute('aria-label')).toBe('Thông tin còn thiếu');
    expect(Array.from(missingFieldsList!.querySelectorAll('.shipment-container-ledger__missing-fields-item')).map((item) => item.textContent)).toEqual([
      'Ngày vận chuyển',
      'Điểm nhận hàng',
      'Điểm trả hàng',
      'Lịch hẹn',
    ]);
    expect(rowWarning.textContent).not.toContain(',');
    // The missing-fields warning lives in the multiline Trạng thái stack
    // (badge + warning), not in the identity cell.
    const missingDateStatusCell = unassignedRow!.querySelector('td[data-label="Trạng thái"]');
    expect(missingDateStatusCell?.contains(rowWarning)).toBe(true);
    expect(missingDateStatusCell?.querySelector('.shipment-container-ledger__multiline')?.lastElementChild).toBe(rowWarning);
    expect(missingDateIdentityCell.contains(rowWarning)).toBe(false);
    expect(identityCell.querySelector('[data-icon]')).toBeNull();
    expect(screen.queryByText('Sửa')).toBeNull();
    expect(screen.getByText((_, element) => element?.classList.contains('ds-pagination__summary') === true && element.textContent === 'Trang này có 2 / 2 container phù hợp')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Danh sách container' })).toBeTruthy();
    expect(screen.queryByText('Sổ điều hành container')).toBeNull();
    expect(screen.queryByText('Mỗi dòng là một container. Lịch trình và ghi chú thuộc toàn lô; điểm nâng hạ và phân xe thuộc từng container.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tất cả' })).toBeTruthy();
    expect(document.querySelector('.shipment-container-ledger__route i')).toBeNull();
    expect(screen.queryByText(/Tìm theo 4–5 ký tự cuối|Tự động lọc khi nhập đủ 4–5 ký tự cuối/)).toBeNull();
    expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}`);
  });

  it('sorts columns server-side through URL params with aria-sort tracking', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter initialEntries={['/shipments-detail?dateScope=all']}><ShipmentContainersPage /></MemoryRouter>);

    expect(await screen.findByText('CONT-001')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20');

    const containerHeader = screen.getByRole('button', { name: 'Thông số container' });
    expect(screen.getByRole('columnheader', { name: /Thông số container/ }).getAttribute('aria-sort')).toBe('none');

    // First click sorts ascending, refetching with both params in one pass.
    fireEvent.click(containerHeader);
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&sortBy=containerNumber&sortDir=asc'));
    // The ledger remounts after each refetch (skeleton swap), so re-query the
    // header rather than holding a detached node.
    expect(screen.getByRole('columnheader', { name: /Thông số container/ }).getAttribute('aria-sort')).toBe('ascending');

    // Second click flips to descending; the header stays the active column.
    fireEvent.click(screen.getByRole('button', { name: 'Thông số container' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&sortBy=containerNumber&sortDir=desc'));
    expect(screen.getByRole('columnheader', { name: /Thông số container/ }).getAttribute('aria-sort')).toBe('descending');
  });

  it('can show all dates and return to today', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Tất cả' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20'));
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}`));
  });

  it('keeps Hôm nay / Hôm sau / Tất cả / Xóa bộ lọc in one stable row and disables the active one', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    // The four buttons must all be present from the first render so the row
    // never reflows when a date shortcut is activated.
    const actionGroup = document.querySelector('.shipments-detail-filters__date-actions') as HTMLElement;
    expect(actionGroup).toBeTruthy();
    const isDisabled = (btn: HTMLElement) => btn.hasAttribute('disabled');
    const todayBtn = within(actionGroup).getByRole('button', { name: 'Hôm nay' });
    const tomorrowBtn = within(actionGroup).getByRole('button', { name: 'Hôm sau' });
    const allBtn = within(actionGroup).getByRole('button', { name: 'Tất cả' });
    const resetBtn = within(actionGroup).getByRole('button', { name: 'Xóa bộ lọc' });

    // Default (today): Hôm nay is disabled (already today), the date
    // shortcuts Hôm sau + Tất cả are enabled. Xóa bộ lọc is enabled
    // because the default state seeds dateFrom/dateTo = today, so the
    // reset action is meaningful.
    expect(isDisabled(todayBtn)).toBe(true);
    expect(isDisabled(allBtn)).toBe(false);
    expect(isDisabled(resetBtn)).toBe(false);
    expect(isDisabled(tomorrowBtn)).toBe(false);

    // Switch to Hôm sau — the other three stay mounted, only the active one disables.
    fireEvent.click(tomorrowBtn);
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${tomorrow}&transportDateTo=${tomorrow}`));
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Hôm sau' }))).toBe(true);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Hôm nay' }))).toBe(false);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Tất cả' }))).toBe(false);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Xóa bộ lọc' }))).toBe(false);

    // Switch to Tất cả — every date button disables; Xóa bộ lọc also
    // disables because selecting Tất cả clears the date filter, leaving
    // no other active filter behind.
    fireEvent.click(allBtn);
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20'));
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Tất cả' }))).toBe(true);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Hôm nay' }))).toBe(false);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Hôm sau' }))).toBe(false);
    expect(isDisabled(within(actionGroup).getByRole('button', { name: 'Xóa bộ lọc' }))).toBe(true);
  });

  it('renders every fulfillment classification with its canonical Vietnamese label', async () => {
    apiGet.mockResolvedValueOnce({
      ...response,
      total: 4,
      totalPages: 1,
      items: [
        { ...response.items[0], containerNumber: 'CLASS-SINGLE', isCombined: false, classification: 'SINGLE' as const },
        { ...response.items[1], containerNumber: 'CLASS-DOUBLE', classification: 'DOUBLE' as const },
        { ...response.items[0], id: 13, containerNumber: 'CLASS-COMBINED', classification: 'COMBINED' as const },
        { ...response.items[1], id: 14, containerNumber: 'CLASS-LCL', classification: 'LCL' as const },
      ],
    });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CLASS-LCL');
    expect([...document.querySelectorAll('.shipment-container-ledger__container-classification')].map((element) => element.textContent)).toEqual([
      'Đơn', 'Kẹp', 'Kết hợp', 'Lẻ',
    ]);
  });

  it('renders the container-search illustration for a filtered empty result', async () => {
    apiGet.mockResolvedValueOnce({ ...response, total: 0, totalPages: 0, items: [] });
    render(<MemoryRouter initialEntries={['/?searchSuffix=ZZZZZ']}><ShipmentContainersPage /></MemoryRouter>);

    const emptyState = (await screen.findByText('Không có container phù hợp')).closest<HTMLElement>('.ds-empty-state');
    expect(emptyState).toBeTruthy();
    const illustration = document.querySelector<HTMLImageElement>('.ds-empty-state__illustration');
    expect(illustration?.getAttribute('src')).toBe('/assets/illustrations/empty-container-search-v1.png');
    expect(within(emptyState!).getByRole('button', { name: 'Xóa bộ lọc' })).toBeTruthy();
  });

  it('keeps a single pending container row in the ledger before pagination', async () => {
    apiGet.mockResolvedValueOnce({ ...response, total: 1, totalPages: 1, items: [{ ...response.items[1], transportDate: today }] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    const container = await screen.findByText('CONT-002');
    const row = container.closest('tr');
    const ledger = row?.closest('.shipment-container-ledger');
    const pagination = ledger?.querySelector('.ds-pagination');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain('Chờ phân xe');
    expect(pagination).toBeTruthy();
    if (!row || !pagination) throw new Error('Expected the pending row and pagination to render');
    expect(row.compareDocumentPosition(pagination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps a fully read-only document group as a labelled value, not an editable cell', async () => {
    const readOnlyDocuments = {
      ...directShipmentAccess,
      blNumber: { mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
      bookingRef: { mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
      tradeDirection: { mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
      shippingLineName: { mode: 'READ_ONLY' as const, reason: 'Lô hàng đã khóa.' },
    };
    apiGet.mockResolvedValueOnce({
      ...response,
      items: response.items.map((row) => row.id === 12 ? { ...row, shipmentFieldAccess: readOnlyDocuments } : row),
    });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    const documentCell = screen.getByText('BOOK-67890').closest('td');
    expect(documentCell?.getAttribute('data-label')).toBe('Chứng từ & hãng tàu');
    expect(documentCell?.classList.contains('shipment-container-ledger__editable-cell')).toBe(false);
    expect(within(documentCell!).queryByRole('button', { name: /Chỉnh sửa ô chứng từ và hãng tàu CONT-002/ })).toBeNull();
  });

  it('presents today\'s unassigned vehicle as an amber operational state, not a destructive error', async () => {
    apiGet.mockResolvedValueOnce({
      ...response,
      items: response.items.map((item) => item.id === 12 ? { ...item, transportDate: today } : item),
    });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    // The same-day vehicle urgency badge now reads 'Chờ phân xe' like the
    // dispatch chip — select by the badge's own class to disambiguate.
    const pendingVehicleCell = (await screen.findByText('Chờ phân xe', { selector: '.shipment-container-ledger__vehicle-state' })).closest('td');
    expect(pendingVehicleCell?.className).toContain('shipment-container-ledger__vehicle-pending');
    expect(pendingVehicleCell?.textContent).toContain('Chưa phân nhà xe');
    expect(pendingVehicleCell?.textContent).toContain('Chưa gán biển số');
    expect(pendingVehicleCell?.textContent).toContain('Phối hợp Điều vận hoặc tự phân xe trước giờ chạy.');
    // "Chưa gán biển số" is a status label, not an action: it renders as a
    // badge span with no button chrome of its own.
    const plateChip = screen.getByText('Chưa gán biển số');
    expect(plateChip.tagName).toBe('SPAN');
    expect(plateChip.className).not.toContain('button');
  });

  it('keeps a trip-bound vehicle cell read-only', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    const vehicleCell = (await screen.findByText('30H-123.45')).closest('td');
    expect(vehicleCell?.getAttribute('data-label')).toBe('Phân xe');
    expect(vehicleCell?.classList.contains('shipment-container-ledger__editable-cell')).toBe(false);
    expect(within(vehicleCell!).queryByRole('button', { name: /Chỉnh sửa phân xe CONT-001/ })).toBeNull();
  });

  it('opens value-cell editors with click, Enter, and Space without pencil controls', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(detail).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    const clickTrigger = await screen.findByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ });
    expect(clickTrigger.textContent).toContain('Công ty Silver Sea');
    expect(clickTrigger.querySelector('[data-icon]')).toBeNull();
    fireEvent.click(clickTrigger);
    const clickEditor = (await screen.findByLabelText('Nhà máy')).closest('.shipment-container-ledger__inline-editor')!;
    fireEvent.keyDown(clickEditor, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ })));

    const enterTrigger = screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ });
    fireEvent.keyDown(enterTrigger, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(enterTrigger, { key: 'Enter', code: 'Enter' });
    const enterEditor = (await screen.findByLabelText('Nhà máy')).closest('.shipment-container-ledger__inline-editor')!;
    fireEvent.keyDown(enterEditor, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ })));

    const spaceTrigger = screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ });
    fireEvent.keyDown(spaceTrigger, { key: ' ', code: 'Space' });
    fireEvent.keyUp(spaceTrigger, { key: ' ', code: 'Space' });
    expect(await screen.findByLabelText('Nhà máy')).toBeTruthy();
    expect(screen.queryByText('Sửa')).toBeNull();
  });

  it('marks every editable detail cell as a full-cell editor target', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    const editableControls = [
      /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/,
      /^Chỉnh sửa ô chứng từ và hãng tàu CONT-002/,
      /^Chỉnh sửa ô thông số container CONT-002/,
      /^Chỉnh sửa điểm nâng hạ CONT-002/,
      /^Chỉnh sửa lịch trình CONT-002/,
      /^Chỉnh sửa phân xe CONT-002/,
      /^Chỉnh sửa ghi chú CONT-002/,
    ];

    for (const name of editableControls) {
      const trigger = screen.getByRole('button', { name });
      const cell = trigger.closest<HTMLElement>('th, td');
      expect(cell?.classList.contains('shipment-container-ledger__editable-cell')).toBe(true);
      expect(cell?.querySelector('.shipment-container-ledger__cell-editor')).toContain(trigger);
    }
  });

  it('opens an editor from the cell\'s single control', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    const trigger = await screen.findByRole('button', { name: /^Chỉnh sửa ô thông số container CONT-002/ });
    const cell = trigger.closest('td');
    expect(cell).toBeTruthy();
    expect(within(cell!).getAllByRole('button')).toEqual([trigger]);
    fireEvent.click(trigger);

    expect(await screen.findByLabelText('Số container')).toBeTruthy();
  });

  it('labels shipment notes by recipient and sends driverNotes on save', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPut.mockResolvedValueOnce({ id: 2, version: 8 });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa ghi chú CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Ghi chú cho khách hàng'), { target: { value: 'Khách nhận lúc 10h' } });
    fireEvent.change(screen.getByLabelText('Ghi chú cho lái xe'), { target: { value: 'Vào cổng số 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ghi chú CONT-002' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/2', {
      expectedVersion: 7,
      customerNotes: 'Khách nhận lúc 10h',
      driverNotes: 'Vào cổng số 2',
    }));
  });

  it('uses labeled touch actions while retaining accessible save and cancel controls', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));

    const save = await screen.findByRole('button', { name: 'Lưu hành trình CONT-002' });
    const cancel = screen.getByRole('button', { name: 'Hủy hành trình CONT-002' });
    expect(save.className).toContain('shipment-container-ledger__edit-action');
    expect(cancel.className).toContain('shipment-container-ledger__edit-action');
    expect(save.querySelector('[data-icon="leading"]')).toBeTruthy();
    expect(cancel.querySelector('[data-icon="leading"]')).toBeTruthy();
    expect(save.textContent).toContain('Lưu');
    expect(cancel.textContent).toContain('Hủy');
    const editor = save.closest('.shipment-container-ledger__inline-editor');
    expect(editor?.id).toBe('shipment-detail-edit-route-12-editor');
    expect(editor?.closest('.shipment-container-ledger__editor-row')).toBeNull();
    expect(editor?.parentElement?.className).toContain('shipment-container-ledger__cell-editor');
    const hint = screen.getByText('Enter để lưu · Esc để hủy');
    expect(hint.closest('.shipment-container-ledger__editor-footer')).toContain(save);
  });

  it('passes URL-backed customer, direction, date, and suffix filters to the flat endpoint', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter initialEntries={['/?transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT&searchSuffix=abcde']}><ShipmentContainersPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=ABCDE&transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT'));
    await screen.findByText('CONT-001');
    const selectsGroup = document.querySelector('.shipments-detail-filters__group--selects') as HTMLElement;
    expect(within(selectsGroup).getByRole('button', { name: /Khách hàng/i })).toHaveTextContent('Công ty Silver Sea');
  });

  it('ignores malformed or inverted URL filters instead of sending an invalid API query', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter initialEntries={['/?page=-2&transportDateFrom=2026-08-31&transportDateTo=2026-08-01&customerId=7.5&direction=SIDEWAYS&searchSuffix=ABC!']}><ShipmentContainersPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}`));
    expect(await screen.findByRole('region', { name: 'Danh sách container' })).toBeTruthy();
  });

  it('applies date, customer, direction, and valid suffix changes immediately', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-001');
    fireEvent.change(screen.getByLabelText('Từ ngày vận chuyển'), { target: { value: '2026-08-15' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15'));

    const selectsGroup = document.querySelector('.shipments-detail-filters__group--selects') as HTMLElement;
    fireEvent.click(within(selectsGroup).getByRole('button', { name: /Khách hàng/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Công ty Silver Sea' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15&customerId=7'));

    fireEvent.click(within(selectsGroup).getByRole('button', { name: /Nhập \/ Xuất/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Nhập' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15&customerId=7&direction=IMPORT'));

    fireEvent.change(screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i), { target: { value: 'abcd' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=ABCD&transportDateFrom=2026-08-15&customerId=7&direction=IMPORT'));
  });

  it('keeps filter actions together and clears active filters without a redundant summary', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter initialEntries={['/?transportDateFrom=2026-08-15&customerId=7&direction=IMPORT&searchSuffix=abcd']}><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-001');
    const actionGroup = document.querySelector('.shipments-detail-filters__date-actions');
    expect(actionGroup).toBeTruthy();
    expect(within(actionGroup as HTMLElement).getByRole('button', { name: 'Tất cả' })).toBeTruthy();
    expect(within(actionGroup as HTMLElement).getByRole('button', { name: 'Xóa bộ lọc' })).toBeTruthy();
    expect(screen.queryByText('Đang lọc')).toBeNull();
    expect(screen.queryByText(/Ngày vận chuyển:/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20'));
  });

  it('backs the Trạng thái (điều xe) filter in the URL and sends it only to the container endpoint', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter initialEntries={['/?dispatchStatus=AWAITING_VEHICLE']}><ShipmentContainersPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}&dispatchStatus=AWAITING_VEHICLE`));
    await screen.findByText('CONT-001');
    const filtersGroup = document.querySelector('.shipments-detail-filters__group--selects') as HTMLElement;
    // The status list is long enough that UuiSelectField renders it as a searchable combobox.
    expect(within(filtersGroup).getByRole('combobox', { name: /Trạng thái/i })).toHaveValue('Chờ phân xe');
    expect(screen.getAllByText('Chờ phân xe').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/shipments/cus-workspace/containers?page=1&limit=20'));
  });

  it('ignores a malformed dispatchStatus value instead of sending an invalid query', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter initialEntries={['/?dispatchStatus=FOO']}><ShipmentContainersPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}`));
  });

  it('offers every ledger badge status in the Trạng thái filter and sends the selected value', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-001');
    const filtersGroup = document.querySelector('.shipments-detail-filters__group--selects') as HTMLElement;
    fireEvent.click(within(filtersGroup).getByRole('combobox', { name: /Trạng thái/i }));
    for (const label of ['Chờ phân xe', 'Đã tạo chuyến', 'Đang chạy', 'Hoàn thành']) {
      expect(screen.getByRole('option', { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('option', { name: 'Hoàn thành' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}&dispatchStatus=COMPLETED`));
  });

  it('rejects an invalid suffix without issuing a filtered request', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    await screen.findByText('CONT-001');
    const input = screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i);
    // Mid-typing prefixes of a valid reference (incl. separators) must not
    // flash the error; only a truly invalid value may.
    fireEvent.change(input, { target: { value: 'AB-' } });
    await waitFor(() => expect(screen.queryByText(/tối thiểu 4 ký tự/i)).toBeNull());
    fireEvent.change(input, { target: { value: 'ABC!' } });
    expect(await screen.findByText('Nhập số Bill/Book, container hoặc tờ khai đầy đủ, hoặc tối thiểu 4 ký tự cuối (không dùng % hoặc _).')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('accepts the full container/Bill number, not only a 4-5 char suffix (2026-09-09 report)', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    await screen.findByText('CONT-001');
    const input = screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i);
    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('searchSuffix=MSCU6639870')));
  });

  it('shows load failure separately from empty data and offers retry', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Thử lại')).toBeTruthy();
    expect(screen.queryByText('Chưa có container')).toBeNull();
  });

  it('uses the master-data port catalog instead of customer operational sites for lift and drop', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));

    expect(await screen.findByRole('option', { name: 'HY · Cảng Hưng Yên' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'HY · Nhà máy Hưng Yên' })).toBeNull();
  });

  it('saves lift/drop through the existing idempotent optimistic container mutation', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    const routeTrigger = screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ });
    fireEvent.click(routeTrigger);
    const liftField = await screen.findByLabelText('Cảng nâng');
    expect(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }).getAttribute('aria-expanded')).toBe('true');
    const editor = liftField.closest('.shipment-container-ledger__inline-editor');
    expect(editor?.id).toBe('shipment-detail-edit-route-12-editor');
    expect(editor?.closest('.shipment-container-ledger__editor-row')).toBeNull();
    fireEvent.click(liftField);
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7, liftSiteId: 33, dropoffSiteId: 32,
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
  });

  it('edits the previously read-only identity and document cells through the shipment authority', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response)
      .mockResolvedValueOnce(detail).mockResolvedValueOnce(response)
      .mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPut.mockResolvedValue({ version: 8, changeMode: 'DIRECT', changeRequestId: null });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ }));
    const factoryName = await screen.findByLabelText('Nhà máy');
    fireEvent.change(factoryName, { target: { value: 'Nhà máy mới' } });
    fireEvent.keyDown(factoryName, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/2', expect.objectContaining({ expectedVersion: 7, factoryName: 'Nhà máy mới' })));

    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa ô chứng từ và hãng tàu CONT-002/ }));
    const documentEditor = (await screen.findByLabelText('Số Booking')).closest<HTMLElement>('.shipment-container-ledger__inline-editor')!;
    fireEvent.click(within(documentEditor).getByRole('button', { name: /Nhập \/ Xuất/ }));
    // The UUI listbox portals to the body — query it outside the editor scope.
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập' }));
    fireEvent.change(within(documentEditor).getByLabelText('Số Bill'), { target: { value: 'BILL-NEW' } });
    fireEvent.change(within(documentEditor).getByLabelText('Hãng tàu'), { target: { value: 'ONE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chứng từ và hãng tàu CONT-002' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/shipments/2', {
      expectedVersion: 7,
      blNumber: 'BILL-NEW',
      bookingRef: null,
      tradeDirection: 'IMPORT',
      shippingLineName: 'ONE',
    }));
  });

  it('edits container identity and cargo through the idempotent container authority', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa ô thông số container CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Số container'), { target: { value: 'MSCU1234566' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12500.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông số container CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7,
      containerNumber: 'MSCU1234566',
      containerTypeId: 2,
      cargoWeightKg: '12500.5',
      cargoVolumeCbm: null,
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
  });

  it('keeps the same idempotency key when a route save is retried and supports Escape cancel', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new Error('Mạng tạm thời gián đoạn')).mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    expect(await screen.findByText('Mạng tạm thời gián đoạn')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[0]?.[2]?.headers?.['Idempotency-Key']).toBe(apiPost.mock.calls[1]?.[2]?.headers?.['Idempotency-Key']);

    apiGet.mockResolvedValueOnce(detail);
    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    const editor = (await screen.findByLabelText('Cảng nâng')).closest('.shipment-container-ledger__inline-editor')!;
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ })));
  });

  it('saves the selected container schedule without changing the whole shipment', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa lịch trình CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Ngày đóng hàng'), { target: { value: '2026-08-22' } });
    fireEvent.change(screen.getByLabelText('Giờ đóng hàng'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7,
      customerAppointmentAt: '2026-08-22T09:30:00+07:00',
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
  });

  it('edits the selected container appointment without exposing a shipment-level delivery date', async () => {
    const appointmentAt = '2026-08-22T03:15:00.000Z';
    apiGet.mockResolvedValueOnce({
      ...response,
      items: response.items.map((row) => row.id === 12 ? { ...row, transportDate: null, customerAppointmentAt: appointmentAt } : row),
    }).mockResolvedValueOnce({
      ...detail,
      containers: [{ ...detail.containers[0], customerAppointmentAt: appointmentAt }],
    }).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: { ...detail.containers[0], customerAppointmentAt: '2026-08-23T03:15:00.000Z' } });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa lịch trình CONT-002/ }));
    const appointmentDate = await screen.findByLabelText(/Ngày (đóng|trả) hàng/);
    expect((appointmentDate as HTMLInputElement).value).toBe('2026-08-22');
    expect(screen.queryByLabelText('Ngày vận chuyển')).toBeNull();
    fireEvent.change(appointmentDate, { target: { value: '2026-08-23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7,
      customerAppointmentAt: '2026-08-23T10:15:00+07:00',
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('does not render a redundant customer-appointment row in the detail ledger', async () => {
    const appointmentResponse = {
      ...response,
      items: response.items.map((row) => row.id === 12 ? { ...row, customerAppointmentAt: '2026-08-22T03:15:00.000Z' } : row),
    };
    apiGet.mockResolvedValueOnce(appointmentResponse).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    expect(screen.queryByText(/Hẹn khách/)).toBeNull();
    expect(screen.queryByRole('button', { name: /giờ hẹn khách/ })).toBeNull();
  });

  it('represents an internal-fleet assignment without forcing an external carrier', async () => {
    const ownDetail = {
      ...detail,
      containers: [{ ...detail.containers[0], carrierType: 'OWN', carrierName: 'SilverSea', permissions: { ...detail.containers[0].permissions, plateEditable: false } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(ownDetail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa phân xe CONT-002/ }));

    expect((await screen.findByLabelText('Nhà xe')).textContent).toContain('Đội xe SilverSea');
    // CUS plans the internal plate too (Cap_nhat_UI_va_logic 1.3): the input
    // renders for OWN, gated by permissions; copy states plan semantics.
    expect(screen.getByText('Biển số nội bộ nhập ở đây là kế hoạch (dự kiến); lệnh điều xe chính thức vẫn là nguồn xác nhận cuối.')).toBeTruthy();
    const plateInput = screen.getByLabelText('Biển số xe') as HTMLInputElement;
    expect(plateInput.disabled).toBe(true);
  });

  it('enables the internal-fleet plate input when permissions allow', async () => {
    const ownEditableDetail = {
      ...detail,
      containers: [{ ...detail.containers[0], carrierType: 'OWN', carrierName: 'SilverSea', permissions: { ...detail.containers[0].permissions, plateEditable: true } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(ownEditableDetail);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa phân xe CONT-002/ }));

    const plateInput = await screen.findByLabelText('Biển số xe') as HTMLInputElement;
    expect(plateInput.disabled).toBe(false);
  });

  it('reloads and rebases an inline editor after an optimistic conflict', async () => {
    const refreshedDetail = {
      ...detail,
      summary: { ...detail.summary, version: 8 },
      containers: [{ ...detail.containers[0], shipmentVersion: 8, dropoffSiteId: 33, dropoffSite: 'Cảng Đình Vũ' }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(refreshedDetail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new ApiError(409, {}, 'Lô hàng vừa thay đổi.')).mockResolvedValueOnce({ line: refreshedDetail.containers[0] });
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    await waitFor(() => expect(screen.getAllByRole('status').some((element) => element.textContent?.includes('Đã tải bản mới nhất'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeTruthy();
    expect(screen.getByLabelText('Cảng hạ').textContent).toContain('DV · Cảng Đình Vũ');
    fireEvent.click(screen.getByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 8,
      liftSiteId: 33,
      dropoffSiteId: 33,
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
  });

  it('keeps the route draft and shows a domain 409 inline instead of treating it as stale data', async () => {
    const domainMessage = 'Hình thức hàng FCL/LCL chưa được xác định.';
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail);
    apiPost.mockRejectedValueOnce(new ApiError(409, { error: domainMessage }, domainMessage));
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(domainMessage);
    expect(screen.getByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeTruthy();
    expect(screen.getByLabelText('Cảng nâng').textContent).toContain('DV · Cảng Đình Vũ');
    expect(screen.queryByText(/Đã tải bản mới nhất/)).toBeNull();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('treats a newer change-request 409 as stale data and rebases the editor', async () => {
    const refreshedDetail = {
      ...detail,
      summary: { ...detail.summary, version: 8 },
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(refreshedDetail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new ApiError(409, {}, 'Lô hàng đã có yêu cầu thay đổi mới hơn. Vui lòng tải lại.'));
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    await waitFor(() => expect(screen.getAllByRole('status').some((element) => element.textContent?.includes('Đã tải bản mới nhất'))).toBe(true));
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  it('closes a stale editor when refreshed permissions become read-only', async () => {
    const readOnlyDetail = {
      ...detail,
      summary: { ...detail.summary, version: 8, operational: { transportDateEditable: false } },
      containers: [{
        ...detail.containers[0],
        shipmentVersion: 8,
        permissions: { ...detail.containers[0].permissions, liftSiteEditable: false, dropoffSiteEditable: false },
      }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(readOnlyDetail);
    apiPost.mockRejectedValueOnce(new ApiError(409, {}, 'Lô hàng vừa thay đổi.'));
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Cảng nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    expect(await screen.findByText('Quyền chỉnh sửa vừa thay đổi. Dòng này đã chuyển sang chỉ đọc.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeNull();
  });

  it('hides the "Chưa có ghi chú cho..." placeholders when both notes are empty', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    // CONT-002 has customerNotes=null and operationalNotes=null
    // The "Chưa có ghi chú cho khách hàng" and "Chưa có ghi chú cho lái xe"
    // placeholders must NOT appear to avoid UI clutter.
    expect(screen.queryByText('Chưa có ghi chú cho khách hàng')).toBeNull();
    expect(screen.queryByText('Chưa có ghi chú cho lái xe')).toBeNull();
  });

  it('keeps the "Ghi chú" cell compact: only the present note lines render when one of the notes is empty', async () => {
    const partialNotesResponse: ShipmentCusContainerFlatResponse = {
      ...response,
      items: response.items.map((item) => item.id === 11
        ? { ...item, customerNotes: 'Lưu ca sáng', operationalNotes: null }
        : item),
    };
    apiGet.mockResolvedValueOnce(partialNotesResponse);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);

    await screen.findByText('CONT-001');
    // Customer note is set; only that line is shown. The empty operational
    // note must not show its "Chưa có ghi chú cho lái xe" placeholder.
    expect(screen.getByText('Lưu ca sáng')).toBeTruthy();
    expect(screen.queryByText('Chưa có ghi chú cho lái xe')).toBeNull();
  });

});
