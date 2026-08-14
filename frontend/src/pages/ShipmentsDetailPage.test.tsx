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
      carrierEditable: false, plateEditable: false, liftSiteEditable: false, dropoffSiteEditable: false, customerAppointmentEditable: false, scheduleEditable: false,
    },
    {
      id: 12, shipmentId: 2, shipmentVersion: 7, ordinal: 1, customerId: 7,
      customerName: 'Công ty Silver Sea', factoryName: 'Nhà máy Hưng Yên', routeName: 'Cảng → Hưng Yên',
      billOrBookNumber: 'BOOK-67890', declarationNumber: null, shippingLineName: 'CMA CGM', isCombined: false, direction: 'EXPORT',
      containerNumber: 'CONT-002', containerTypeLabel: '20DC', dispatchStatus: 'UNASSIGNED', carrierName: null, plateNumber: null,
      liftSite: null, dropoffSite: null, transportDate: null, closingAt: null, plannedReturnAt: null, customerAppointmentAt: null,
      customerNotes: null, operationalNotes: null, shipmentScheduleEditable: true, shipmentNotesEditable: true,
      carrierEditable: true, plateEditable: true, liftSiteEditable: true, dropoffSiteEditable: true, customerAppointmentEditable: true, scheduleEditable: true,
    },
  ],
};

const detail = {
  summary: {
    id: 2, version: 7, transportDate: null, closingAt: null, plannedReturnAt: null,
    customerNotes: null, operationalNotes: null, operational: { transportDateEditable: true },
  },
  containers: [{
    id: 12, ordinal: 1, containerNumber: 'CONT-002', liftSiteId: 31, liftSite: 'Bãi CY', dropoffSiteId: 32, dropoffSite: 'Nhà máy Hưng Yên',
    externalCarrierId: null, externalCarrierVehicleId: null, plateNumber: null, customerAppointmentAt: null, shipmentVersion: 7,
    permissions: { carrierEditable: true, plateEditable: true, containerTypeEditable: true, liftSiteEditable: true, dropoffSiteEditable: true, customerAppointmentEditable: true },
  }],
  selectors: {
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
  it('loads today by default and renders the seven multi-line groups with warning semantics', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    expect(await screen.findByText('CONT-001')).toBeTruthy();
    for (const label of ['Khách hàng & lộ trình', 'Chứng từ & hãng tàu', 'Thông số container', 'Địa điểm nâng / hạ', 'Lịch trình', 'Phân xe', 'Ghi chú']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('TK-001')).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === 'Nhập · MSC')).toBeTruthy();
    expect(screen.getByText('Hàng kết hợp')).toBeTruthy();
    expect(screen.getByText('Lưu ca sáng')).toBeTruthy();
    expect(screen.getAllByText('Thiếu ngày vận chuyển')).toHaveLength(2);
    expect(screen.getByText((_, element) => element?.classList.contains('ds-pagination__summary') === true && element.textContent === 'Trang này có 2 / 2 container phù hợp')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith(`/shipments/cus-workspace/containers?page=1&limit=20&transportDateFrom=${today}&transportDateTo=${today}`);
  });

  it('passes URL-backed customer, direction, date, and suffix filters to the flat endpoint', async () => {
    apiGet.mockResolvedValueOnce(response);
    render(<MemoryRouter initialEntries={['/?transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT&searchSuffix=abcde']}><ShipmentsDetailPage /></MemoryRouter>);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=abcde&transportDateFrom=2026-08-01&transportDateTo=2026-08-31&customerId=7&direction=IMPORT'));
    expect(await screen.findByRole('option', { name: 'Công ty Silver Sea' })).toBeTruthy();
  });

  it('rejects an invalid suffix without issuing a filtered request', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);
    await screen.findByText('CONT-001');
    const input = screen.getByLabelText(/Container, Bill\/Booking hoặc tờ khai/i);
    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.submit(input.closest('form')!);
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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa điểm nâng hạ CONT-002' }));
    fireEvent.click(await screen.findByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/shipments/cus-workspace/2/containers/12', {
      expectedShipmentVersion: 7, liftSiteId: 33, dropoffSiteId: 32,
    }, { headers: { 'Idempotency-Key': expect.any(String) } }));
  });

  it('keeps the same idempotency key when a route save is retried and supports Escape cancel', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPost.mockRejectedValueOnce(new Error('Mạng tạm thời gián đoạn')).mockResolvedValueOnce({ line: detail.containers[0] });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa điểm nâng hạ CONT-002' }));
    fireEvent.click(await screen.findByLabelText('Điểm nâng'));
    fireEvent.click(screen.getByRole('option', { name: 'DV · Cảng Đình Vũ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    expect(await screen.findByText('Mạng tạm thời gián đoạn')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hành trình CONT-002' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls[0]?.[2]?.headers?.['Idempotency-Key']).toBe(apiPost.mock.calls[1]?.[2]?.headers?.['Idempotency-Key']);

    apiGet.mockResolvedValueOnce(detail);
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa điểm nâng hạ CONT-002' }));
    const editor = (await screen.findByLabelText('Điểm nâng')).closest('.shipment-container-ledger__inline-editor')!;
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Hủy hành trình CONT-002' })).toBeNull();
  });

  it('saves shipment-scoped schedule through the existing versioned shipment update', async () => {
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(detail).mockResolvedValueOnce(response);
    apiPut.mockResolvedValueOnce({ version: 8 });
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa lịch trình CONT-002' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa lịch trình CONT-002' }));
    fireEvent.change(await screen.findByLabelText('Giờ hẹn khách'), { target: { value: '2026-08-22T10:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa lịch trình CONT-002' }));

    expect((await screen.findByLabelText('Ngày vận chuyển')).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Giờ đóng hàng').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Giờ hẹn khách').hasAttribute('disabled')).toBe(false);
  });

  it('represents an internal-fleet assignment without forcing an external carrier', async () => {
    const ownDetail = {
      ...detail,
      containers: [{ ...detail.containers[0], carrierType: 'OWN', carrierName: 'SilverSea', permissions: { ...detail.containers[0].permissions, plateEditable: false } }],
    } as unknown as ShipmentCusWorkspaceDetail;
    apiGet.mockResolvedValueOnce(response).mockResolvedValueOnce(ownDetail);
    render(<MemoryRouter><ShipmentsDetailPage /></MemoryRouter>);

    await screen.findByText('CONT-002');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa phân xe CONT-002' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa điểm nâng hạ CONT-002' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa điểm nâng hạ CONT-002' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa lịch trình CONT-002' }));
    fireEvent.change(await screen.findByLabelText('Giờ hẹn khách'), { target: { value: '2026-08-22T10:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

    expect((await screen.findByRole('status')).textContent).toContain('bỏ bản nháp cũ');
    expect(screen.getByLabelText('Giờ hẹn khách').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Ngày vận chuyển'), { target: { value: '2026-08-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch trình CONT-002' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/2', expect.objectContaining({
      expectedVersion: 8,
      expectedDeliveryDate: '2026-08-25',
    })));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
