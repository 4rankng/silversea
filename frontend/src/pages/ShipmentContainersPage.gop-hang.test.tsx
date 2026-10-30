// SIL-547 (id 614, spec 23/10 §2/§4.2) — the CUS [Gộp hàng] flow on Chi tiết
// lô hàng: the filter-strip toggle reveals the CHỌN column (LOT-level LCL rows
// only — a container line can never join a rev group), the floating bar counts
// the picks, the same-customer gate refuses at the tick, and [Gộp hàng] opens
// the shared «Gộp xe thu khách» popup at ≥2 ungrouped picks.
//
// Mirrors ShipmentContainersPage.test.tsx's api-mock plane; the assertions pin
// the §2 mode mechanics, not the merge send (MergeRevGroupDialog has its own).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatResponse, ShipmentCusContainerFlatRow } from '@tingting/shared';
import { formatVietnamDateInput } from '../lib/shipment-operations';

const { apiGet, apiPost, toastMock, authRole } = vi.hoisted(() => ({
  apiGet: vi.fn(), apiPost: vi.fn(), toastMock: vi.fn(), authRole: { value: 'CUS' },
}));
vi.mock('../components/shared/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, public readonly raw: unknown, message: string) { super(message); }
  },
}));

import ShipmentContainersPage from './ShipmentContainersPage';

const today = formatVietnamDateInput(new Date());

const directAccess = {
  operationalSiteId: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  containerNumber: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  containerTypeId: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  cargoWeightKg: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  cargoVolumeCbm: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  routeId: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  liftSiteId: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
  dropoffSiteId: { mode: 'READ_ONLY' as const, reason: 'Không thể sửa.' },
};
const readOnlyShipmentAccess = Object.fromEntries([
  'customerId', 'factoryName', 'routeId', 'deliveryLocation', 'blNumber', 'bookingRef', 'declarationNumber', 'tradeDirection', 'shippingLineName',
  'packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm', 'customsCutoffAt', 'closingAt', 'plannedReturnAt', 'customerNotes', 'operationalNotes',
].map((key) => [key, { mode: 'READ_ONLY', reason: 'Không thể sửa.' }])) as ShipmentCusContainerFlatRow['shipmentFieldAccess'];

/** A container-less LCL lot row (the tickable kind) on this workboard. */
const lotRow = (over: Partial<ShipmentCusContainerFlatRow>): ShipmentCusContainerFlatRow => ({
  id: -(over.shipmentId ?? 1), shipmentId: over.shipmentId ?? 1, shipmentVersion: 3, ordinal: 1,
  customerId: 7, isAdHoc: false, customerName: 'Công ty Silver Sea', factoryName: null, routeName: null,
  billOrBookNumber: 'BILL-LCL', declarationNumber: null, shippingLineName: null, isCombined: false,
  classification: 'LCL', direction: 'IMPORT', containerNumber: null, containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE', carrierName: null, carrierType: null, plateNumber: null,
  tripId: null, tripStatus: null, tripDepartureDate: null,
  actualTruckNo: null, billingTruckNo: null, revVehicleClassCode: null, costVehicleClassCode: null,
  liftSite: null, dropoffSite: null, transportDate: today, closingAt: null, plannedReturnAt: null,
  customerAppointmentAt: null, customerNotes: null, operationalNotes: null,
  raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: '5000', cargoVolumeCbm: '12.5' },
  fieldAccess: directAccess, shipmentFieldAccess: readOnlyShipmentAccess,
  informationStatus: 'COMPLETE', missingFields: [],
  shipmentScheduleEditable: false, shipmentNotesEditable: false, carrierEditable: false, plateEditable: false,
  liftSiteEditable: false, dropoffSiteEditable: false, routeEditable: false, customerAppointmentEditable: false, scheduleEditable: false,
  isLotLevel: true,
  ...over,
});

/** A real FCL container row — never tickable. */
const containerRow = (over: Partial<ShipmentCusContainerFlatRow>): ShipmentCusContainerFlatRow => lotRow({
  id: 11, shipmentId: 11, isLotLevel: undefined, billOrBookNumber: 'BILL-FCL',
  containerNumber: 'CONT-FCL-01', containerTypeLabel: '40HC', classification: 'SINGLE',
  raw: { containerNumber: 'CONT-FCL-01', containerTypeId: 1, cargoWeightKg: '25000', cargoVolumeCbm: '52.5' },
  ...over,
});

function wire(items: ShipmentCusContainerFlatRow[]) {
  const response: ShipmentCusContainerFlatResponse = {
    page: 1, limit: 20, total: items.length, totalPages: 1,
    filterOptions: { customers: [{ id: 7, name: 'Công ty Silver Sea' }] },
    items,
  };
  apiGet.mockResolvedValue(response);
}

const renderPage = () => render(
  <MemoryRouter>
    {/* The merge popup's Loại xe field rides react-query (useVehicleSizeClasses). */}
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShipmentContainersPage />
    </QueryClientProvider>
  </MemoryRouter>,
);

/** Flip the filter-strip mode ON and wait for the CHỌN column. */
const enterMergeMode = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng', pressed: false }));
  await screen.findByRole('columnheader', { name: /Chọn lô hàng lẻ/ });
};

beforeEach(() => {
  authRole.value = 'CUS';
  apiGet.mockReset();
  apiPost.mockReset();
  toastMock.mockReset();
});

describe('SIL-547 — [Gộp hàng] mode on Chi tiết lô hàng', () => {
  it('mặc định ẩn mode: không nút Gộp hàng, không cột CHỌN (CUS vẫn thấy nút vì có quyền — kiểm tra trạng thái OFF)', async () => {
    wire([lotRow({})]);
    renderPage();
    await screen.findByText('BILL-LCL');
    // OFF by default: the toggle sits on the strip (spec §2) but unpressed,
    // and the ledger carries NO leading CHỌN column and no checkbox.
    const toggle = screen.getByRole('button', { name: 'Gộp hàng', pressed: false });
    expect(toggle).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent);
    expect(headers[0]).not.toBe('');
  });

  it('bật mode → cột CHỌN đầu bảng; CHỈ dòng lô lẻ có checkbox, dòng cont để trống', async () => {
    wire([lotRow({ billOrBookNumber: 'BILL-LCL-1' }), containerRow({})]);
    renderPage();
    await screen.findByText('BILL-LCL-1');
    await enterMergeMode();

    const headers = screen.getAllByRole('columnheader').map((el) => el.textContent);
    expect(headers[0]).toBe('Chọn lô hàng lẻ để gộp');
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-1' })).toBeTruthy();
    // The FCL container line renders the muted dash — no checkbox to tick.
    const containerCell = screen.getByText('CONT-FCL-01').closest('tr')!.querySelector('td');
    expect(containerCell?.querySelector('input[type="checkbox"]')).toBeNull();
    // The toggle carries the active face.
    expect(screen.getByRole('button', { pressed: true })).toBeTruthy();
  });

  it('tick ≥1 lô → floating bar đếm + [Gộp hàng] khóa dưới 2 lô chưa ghép; đủ 2 → popup «Gộp xe thu khách» 3 trường', async () => {
    wire([
      lotRow({ shipmentId: 1, billOrBookNumber: 'BILL-LCL-1' }),
      lotRow({ shipmentId: 2, billOrBookNumber: 'BILL-LCL-2' }),
    ]);
    renderPage();
    await screen.findByText('BILL-LCL-1');
    await enterMergeMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-1' }));
    expect(screen.getByText(/Đang chọn 1 lô: Tổng 5 tấn \| 12,5 CBM/)).toBeTruthy();
    // Under 2 ungrouped picks the merge action is disabled WITH its reason.
    // (The bar's action reads "Gộp hàng"; its title "Gộp xe thu khách" is the
    // tooltip, not the accessible name.)
    const assign = screen.getByRole('button', { name: 'Gộp hàng' });
    expect(assign.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-2' }));
    expect(screen.getByText(/Đang chọn 2 lô/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng' }));

    // The shared §4.2 popup — exactly its three fields.
    expect(await screen.findByRole('heading', { name: 'Gộp xe thu khách' })).toBeTruthy();
    expect(screen.getByText('Loại xe tính cước thu khách')).toBeTruthy();
    expect(screen.getByText('BKS báo khách (chung nhóm)')).toBeTruthy();
    expect(screen.getByText('Cước thu khách Lô 1 (đ)')).toBeTruthy();
  });

  it('tick lô khác khách → chặn NGAY khi tích (toast nêu lô + khách), bar không đổi', async () => {
    wire([
      lotRow({ shipmentId: 1, billOrBookNumber: 'BILL-LCL-1', customerId: 7, customerName: 'KH A' }),
      lotRow({ shipmentId: 2, billOrBookNumber: 'BILL-LCL-2', customerId: 9, customerName: 'KH B' }),
    ]);
    renderPage();
    await screen.findByText('BILL-LCL-1');
    await enterMergeMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-2' }));

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('Lô BILL-LCL-2 thuộc khách hàng KH B'),
    }));
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();
  });

  it('Thoát gộp hàng → ẩn cột CHỌN, đóng bar, picks drop', async () => {
    wire([lotRow({ billOrBookNumber: 'BILL-LCL-1' })]);
    renderPage();
    await screen.findByText('BILL-LCL-1');
    await enterMergeMode();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-1' }));
    expect(screen.getByText(/Đang chọn 1 lô/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { pressed: true }));
    await waitFor(() => expect(screen.queryByText(/Đang chọn/)).toBeNull());
    expect(screen.queryByRole('checkbox', { name: /Chọn lô/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Gộp hàng', pressed: false })).toBeTruthy();
  });

  it('lô đã thuộc nhóm ghép (revGroupId) không tính vào cờ mergeable — 2 picks mà 1 đã ghép thì [Gộp hàng] vẫn khóa', async () => {
    wire([
      lotRow({ shipmentId: 1, billOrBookNumber: 'BILL-LCL-1', revGroupId: 'rev-group-1' }),
      lotRow({ shipmentId: 2, billOrBookNumber: 'BILL-LCL-2' }),
    ]);
    renderPage();
    await screen.findByText('BILL-LCL-1');
    await enterMergeMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BILL-LCL-2' }));
    // The bar counts the picks…
    expect(screen.getByText(/Đang chọn 2 lô/)).toBeTruthy();
    // …but only UNGROUPED lots are mergeable — one grouped pick keeps the
    // action locked (the wire's revGroupId rides the row since SIL-547).
    expect(screen.getByRole('button', { name: 'Gộp hàng' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('reader (không phải ADMIN/ACCOUNTANT/CUS) không thấy toggle và không bao giờ có cột CHỌN', async () => {
    authRole.value = 'DISPATCHER';
    wire([lotRow({})]);
    renderPage();
    await screen.findByText('BILL-LCL');
    expect(screen.queryByRole('button', { name: 'Gộp hàng' })).toBeNull();
  });
});
