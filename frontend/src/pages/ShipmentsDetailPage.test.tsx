import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import ShipmentsDetailPage from './ShipmentsDetailPage';

const today = formatVietnamDateInput(new Date());
const directContainerAccess = {
  containerNumber: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  containerTypeId: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  cargoWeightKg: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
  cargoVolumeCbm: { mode: 'DIRECT' as const, reason: 'Có thể sửa.' },
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
      id: 11, shipmentId: 1, shipmentVersion: 4, ordinal: 1, customerId: 7,
      customerName: 'Công ty Silver Sea', factoryName: 'Nhà máy Hải Phòng', routeName: 'Đình Vũ → Hải Phòng',
      billOrBookNumber: 'BILL-12345', declarationNumber: 'TK-001', shippingLineName: 'MSC', isCombined: true, direction: 'IMPORT',
      containerNumber: 'CONT-001', containerTypeLabel: '40HC', dispatchStatus: 'PLANNED', carrierName: 'SilverSea', plateNumber: '30H-123.45',
      liftSite: 'Bãi CY', dropoffSite: 'Nhà máy Hải Phòng', transportDate: today, closingAt: null, plannedReturnAt: `${today}T08:00:00.000Z`, customerAppointmentAt: null,
      customerNotes: 'Lưu ca sáng', operationalNotes: 'Ưu tiên cổng 2', shipmentScheduleEditable: false, shipmentNotesEditable: false,
      raw: { containerNumber: 'CONT-001', containerTypeId: 1, cargoWeightKg: '25000', cargoVolumeCbm: '52.5' }, fieldAccess: directContainerAccess,
      shipmentFieldAccess: directShipmentAccess,
      carrierEditable: false, plateEditable: false, liftSiteEditable: false, dropoffSiteEditable: false, customerAppointmentEditable: false, scheduleEditable: false,
    },
    {
      id: 12, shipmentId: 2, shipmentVersion: 7, ordinal: 1, customerId: 7,
      customerName: 'Công ty Silver Sea', factoryName: 'Nhà máy Hưng Yên', routeName: 'Cảng → Hưng Yên',
      billOrBookNumber: 'BOOK-67890', declarationNumber: null, shippingLineName: 'CMA CGM', isCombined: false, direction: 'EXPORT',
      containerNumber: 'CONT-002', containerTypeLabel: '20DC', dispatchStatus: 'UNASSIGNED', carrierName: null, plateNumber: null,
      liftSite: null, dropoffSite: null, transportDate: null, closingAt: null, plannedReturnAt: null, customerAppointmentAt: null,
      customerNotes: null, operationalNotes: null, shipmentScheduleEditable: true, shipmentNotesEditable: true,
      raw: { containerNumber: 'CONT-002', containerTypeId: 2, cargoWeightKg: null, cargoVolumeCbm: null }, fieldAccess: directContainerAccess,
      shipmentFieldAccess: directShipmentAccess,
      carrierEditable: true, plateEditable: true, liftSiteEditable: true, dropoffSiteEditable: true, customerAppointmentEditable: true, scheduleEditable: true,
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
  },
} as unknown as ShipmentCusWorkspaceDetail;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
});

describe('ShipmentsDetailPage — DOCX container workboard', () => {
  it('loads all dates by default and renders the seven multi-line groups with warning semantics', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    expect(await screen.findByText('CONT-001')).toBeTruthy();
    for (const label of ['Khách hàng & lộ trình', 'Chứng từ & hãng tàu', 'Thông số container', 'Địa điểm nâng / hạ', 'Lịch trình', 'Phân xe', 'Ghi chú']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('TK-001')).toBeTruthy();
    const classificationCell = screen.getByRole('button', { name: /^Chỉnh sửa chiều hàng và hãng tàu CONT-001/ });
    expect(classificationCell.textContent).toContain('Nhập');
    expect(classificationCell.textContent).toContain('MSC');
    expect(classificationCell.querySelector('[data-icon]')).toBeNull();
    expect(screen.getByText('Hàng kết hợp')).toBeTruthy();
    expect(screen.getByText('Lưu ca sáng')).toBeTruthy();
    expect(screen.getAllByText('Thiếu ngày vận chuyển')).toHaveLength(2);
    const identityCell = screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-001/ });
    expect(identityCell.textContent).toContain('Công ty Silver Sea');
    expect(identityCell.querySelector('[data-icon]')).toBeNull();
    expect(screen.queryByText('Sửa')).toBeNull();
    expect(screen.getByText((_, element) => element?.classList.contains('ds-pagination__summary') === true && element.textContent === 'Trang này có 2 / 2 container phù hợp')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Công việc container theo tất cả các ngày' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tất cả ngày' })).toBeNull();
    expect(screen.queryByText(/Tìm theo 4–5 ký tự cuối|Tự động lọc khi nhập đủ 4–5 ký tự cuối/)).toBeNull();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20');
  });

  it('opens value-cell editors with click, Enter, and Space without pencil controls', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(detail).mockResolvedValueOnce(detail);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

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

  it('passes URL-backed customer, direction, date, and suffix filters to the flat endpoint', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter initialEntries={['/?transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT&searchSuffix=abcde']}><ShipmentsDetailPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=ABCDE&transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT'));
    expect(await screen.findByRole('option', { name: 'Công ty Silver Sea' })).toBeTruthy();
  });

  it('ignores malformed or inverted URL filters instead of sending an invalid API query', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter initialEntries={['/?page=-2&transportDateFrom=2026-08-31&transportDateTo=2026-08-01&customerId=7.5&direction=SIDEWAYS&searchSuffix=ABC!']}><ShipmentsDetailPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20'));
    expect(await screen.findByRole('heading', { name: 'Công việc container theo tất cả các ngày' })).toBeTruthy();
  });

  it('applies date, customer, direction, and valid suffix changes immediately', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-001');
    fireEvent.change(screen.getByLabelText('Từ ngày vận chuyển'), { target: { value: '2026-08-15' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15'));

    fireEvent.change(screen.getByLabelText('Khách hàng'), { target: { value: '7' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15&customerId=7'));

    fireEvent.change(screen.getByLabelText('Nhập / Xuất'), { target: { value: 'IMPORT' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=2026-08-15&customerId=7&direction=IMPORT'));

    fireEvent.change(screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i), { target: { value: 'abcd' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=ABCD&transportDateFrom=2026-08-15&customerId=7&direction=IMPORT'));
  });

  it('rejects an invalid suffix without issuing a filtered request', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);
    await screen.findByText('CONT-001');
    const input = screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i);
    fireEvent.change(input, { target: { value: 'ABC!' } });
    expect(await screen.findByText('Nhập đúng 4 hoặc 5 ký tự chữ và số cuối.')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('shows load failure separately from empty data and offers retry', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Thử lại')).toBeTruthy();
    expect(screen.queryByText('Chưa có container')).toBeNull();
  });

  it('saves lift/drop through the existing idempotent optimistic container mutation', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    const routeTrigger = screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ });
    fireEvent.click(routeTrigger);
    const liftField = await screen.findByLabelText('Điểm nâng');
    expect(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }).getAttribute('aria-expanded')).toBe('true');
    const editorCell = liftField.closest('.shipment-container-ledger__editor-row')?.querySelector('td');
    expect(editorCell?.getAttribute('colspan')).toBe('7');
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
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa ô khách hàng và lộ trình CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Nhà máy'), { target: { value: 'Nhà máy mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu khách hàng và lộ trình CONT-002' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/2', expect.objectContaining({ expectedVersion: 7, factoryName: 'Nhà máy mới' })));

    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa ô chứng từ và hãng tàu CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Số Bill'), { target: { value: 'BILL-NEW' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chứng từ và hãng tàu CONT-002' }));
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/shipments/2', expect.objectContaining({ expectedVersion: 7, blNumber: 'BILL-NEW' })));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hủy chứng từ và hãng tàu CONT-002' })).toBeNull());
    const classificationTrigger = screen.getByRole('button', { name: /^Chỉnh sửa chiều hàng và hãng tàu CONT-002/ });
    fireEvent.click(classificationTrigger);
    const classificationEditor = (await screen.findByRole('button', { name: 'Lưu chiều hàng và hãng tàu CONT-002' })).closest('.shipment-container-ledger__inline-editor')!;
    const directionSelect = classificationEditor.querySelector('select')!;
    fireEvent.change(directionSelect, { target: { value: 'IMPORT' } });
    fireEvent.change(classificationEditor.querySelector('input')!, { target: { value: 'ONE' } });
    const saveClassification = screen.getByRole('button', { name: 'Lưu chiều hàng và hãng tàu CONT-002' });
    await waitFor(() => expect(saveClassification.hasAttribute('disabled')).toBe(false));
    fireEvent.click(saveClassification);
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/shipments/2', {
      expectedVersion: 7,
      tradeDirection: 'IMPORT',
      shippingLineName: 'ONE',
    }));
  });

  it('edits container identity and cargo through the idempotent container authority', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

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
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    expect(await screen.findByText('Mạng tạm thời gián đoạn')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[0]?.[2]?.headers?.['Idempotency-Key']).toBe(apiPost.mock.calls[1]?.[2]?.headers?.['Idempotency-Key']);

    apiGet.mockResolvedValueOnce(detail);
    fireEvent.click(await screen.findByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    const editor = (await screen.findByLabelText('Điểm nâng')).closest('.shipment-container-ledger__inline-editor')!;
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ })));
  });

  it('saves shipment-scoped schedule through the existing versioned shipment update', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPut.mockResolvedValueOnce({ version: 8 });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa lịch trình CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Ngày vận chuyển'), { target: { value: '2026-08-22' } });
    fireEvent.change(screen.getByLabelText('Giờ đóng hàng'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/2', expect.objectContaining({
      expectedVersion: 7,
      expectedDeliveryDate: '2026-08-22',
      closingAt: '2026-08-22T09:30:00+07:00',
    })));
  });

  it('keeps the container appointment visible and saves it through the container mutation', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockResolvedValueOnce({ line: { ...detail.containers[0], shipmentVersion: 8, customerAppointmentAt: '2026-08-22T03:15:00.000Z' } });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa giờ hẹn khách CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Giờ hẹn khách'), { target: { value: '2026-08-22T10:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ hẹn khách CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7,
      customerAppointmentAt: '2026-08-22T10:15:00+07:00',
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('keeps shipment schedule read-only when only the container appointment is editable', async () => {
    const appointmentOnlyResponse = {
      ...response,
      items: response.items.map((row) => row.id === 12 ? { ...row, shipmentScheduleEditable: false } : row),
    };
    const appointmentOnlyDetail = {
      ...detail,
      summary: { ...detail.summary, operational: { transportDateEditable: false } },
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(appointmentOnlyResponse).mockResolvedValueOnce(appointmentOnlyDetail);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    expect(screen.queryByRole('button', { name: /^Chỉnh sửa lịch trình CONT-002/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa giờ hẹn khách CONT-002/ }));
    expect((await screen.findByLabelText('Giờ hẹn khách')).hasAttribute('disabled')).toBe(false);
  });

  it('represents an internal-fleet assignment without forcing an external carrier', async () => {
    const ownDetail = {
      ...detail,
      containers: [{ ...detail.containers[0], carrierType: 'OWN', carrierName: 'SilverSea', permissions: { ...detail.containers[0].permissions, plateEditable: false } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(ownDetail);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa phân xe CONT-002/ }));

    expect((await screen.findByLabelText('Nhà xe')).textContent).toContain('Đội xe SilverSea');
    expect(screen.getByText('Biển số xe nội bộ được xác định từ lệnh điều xe chính thức.')).toBeTruthy();
  });

  it('reloads and rebases an inline editor after an optimistic conflict', async () => {
    const refreshedDetail = {
      ...detail,
      summary: { ...detail.summary, version: 8 },
      containers: [{ ...detail.containers[0], shipmentVersion: 8, dropoffSiteId: 33, dropoffSite: 'Cảng Đình Vũ' }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(refreshedDetail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new ApiError(409, {}, 'Lô hàng vừa thay đổi.')).mockResolvedValueOnce({ line: refreshedDetail.containers[0] });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    expect((await screen.findByRole('status')).textContent).toContain('Đã tải bản mới nhất');
    expect(screen.getByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeTruthy();
    expect(screen.getByLabelText('Điểm hạ').textContent).toContain('DV · Cảng Đình Vũ');
    fireEvent.click(screen.getByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 8,
      liftSiteId: 33,
      dropoffSiteId: 33,
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
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
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa điểm nâng hạ CONT-002/ }));
    fireEvent.click(await screen.findByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    expect(await screen.findByText('Quyền chỉnh sửa vừa thay đổi. Dòng này đã chuyển sang chỉ đọc.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeNull();
  });

  it('drops a stale appointment draft when dispatch revokes only appointment permission', async () => {
    const dispatchedDetail = {
      ...detail,
      summary: { ...detail.summary, version: 8 },
      containers: [{
        ...detail.containers[0],
        shipmentVersion: 8,
        customerAppointmentAt: '2026-08-23T02:00:00.000Z',
        permissions: { ...detail.containers[0].permissions, customerAppointmentEditable: false },
      }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(dispatchedDetail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new ApiError(409, {}, 'Lô hàng vừa thay đổi.'));
    apiPut.mockResolvedValueOnce({ version: 9 });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: /^Chỉnh sửa giờ hẹn khách CONT-002/ }));
    fireEvent.change(await screen.findByLabelText('Giờ hẹn khách'), { target: { value: '2026-08-22T10:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ hẹn khách CONT-002' }));

    expect((await screen.findByRole('alert')).textContent).toContain('chuyển sang chỉ đọc');
    expect(screen.queryByLabelText('Giờ hẹn khách')).toBeNull();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
