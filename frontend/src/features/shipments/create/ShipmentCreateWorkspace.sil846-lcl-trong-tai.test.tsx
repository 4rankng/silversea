// SIL-846 (id 975, KH 15/11): form Hàng lẻ — quy cách đóng gói becomes a
// SUGGESTION (blank still saves) and a new 'Trọng tải (Loại xe tính cước)'
// select rides the vehicle_size_classes catalog as the Bảng giá cước thu
// khách lookup basis. Pins: the field reads the LIVE catalog (no hardcoded
// list), the pick rides the root payload (LCL only), and a blank quy cách +
// blank trọng tải still create the lot.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getBootstrap,
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
  getVehicleSizeClasses,
} = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  quickCreateShipment: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
  getVehicleSizeClasses: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
}));
vi.mock('../../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigClientModule>();
  return {
    ...actual,
    // The hook calls the METHOD on the exported configClient object — patch
    // it there, not as a separate named export.
    configClient: {
      ...actual.configClient,
      getVehicleSizeClasses,
    },
  };
});

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import type * as ConfigClientModule from '../../../api/configClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** The catalog the Bảng giá engine itself seeds (canonical 9, seed-demo-
 *  freight-pricing CANONICAL_CLASSES) — sortOrder is the render order. */
const CATALOG_CLASSES = [
  { id: 11, code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false, sortOrder: 1 },
  { id: 12, code: '2.5T', name: 'Xe 2.5 tấn', isContainer: false, sortOrder: 2 },
  { id: 13, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 3 },
  { id: 14, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 },
  { id: 15, code: '8T', name: 'Xe 8 tấn', isContainer: false, sortOrder: 5 },
  { id: 16, code: '10T', name: 'Xe 10 tấn', isContainer: false, sortOrder: 6 },
  { id: 17, code: '15T', name: 'Xe 15 tấn', isContainer: false, sortOrder: 7 },
  { id: 18, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
  { id: 19, code: 'CONT40', name: 'Container 40 feet', isContainer: true, sortOrder: 9 },
];

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments', '/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
            <Route path="/shipments/new" element={<ShipmentCreateWorkspace />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function enterAdHocLcl() {
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  // Ad-hoc waives route/factory/kho so the test exercises the cargo fields
  // alone; the customer still comes from the catalog (hybrid intake).
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
  await waitFor(() => expect(document.querySelector('[data-field-id="shipment-rev-vehicle-class"]')).toBeTruthy());
  fireEvent.click(document.getElementById('shipment-trade-direction')!);
  fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
  fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')!, { target: { value: 'BL-SIL846' } });
  fireEvent.change(screen.getByLabelText(/Số lượng/), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Trọng lượng/), { target: { value: '300' } });
  const closing = document.querySelector('[data-field-id="shipment-lcl-closing-at"]')!;
  const seg = (key: string) => closing.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`)!;
  fireEvent.change(seg('hh'), { target: { value: '09' } });
  fireEvent.change(seg('mm'), { target: { value: '30' } });
  fireEvent.change(seg('dd'), { target: { value: '20' } });
  fireEvent.change(seg('mm2'), { target: { value: '08' } });
  fireEvent.change(seg('yyyy'), { target: { value: '2026' } });
}

describe('SIL-846 — form Hàng lẻ: quy cách tuỳ chọn + Trọng tải tính cước', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    getVehicleSizeClasses.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 846, version: 1 });
    // fetchAllPaginated resolves to a flat array — the hook's data IS the list.
    getVehicleSizeClasses.mockResolvedValue(CATALOG_CLASSES);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('renders the Trọng tải select over the live catalog — the 9 canonical classes, đúng thứ tự', async () => {
    renderWorkspace();
    await enterAdHocLcl();

    const field = document.querySelector('[data-field-id="shipment-rev-vehicle-class"]')!;
    expect(within(field as HTMLElement).getByText('Trọng tải (Loại xe tính cước)')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Trọng tải (Loại xe tính cước)' });
    select.focus();
    fireEvent.click(select);
    for (const name of ['Xe 1.25 tấn', 'Xe 5 tấn', 'Xe 15 tấn', 'Container 20 feet', 'Container 40 feet']) {
      expect(await screen.findByRole('option', { name })).toBeTruthy();
    }
    cleanup();
  });

  it('chọn loại xe → root payload mang revVehicleClassId (căn cứ tra Bảng giá); quy cách để trống vẫn lưu', async () => {
    renderWorkspace();
    await enterAdHocLcl();

    // Quy cách đóng gói stays a SUGGESTION: no required mark, left blank.
    expect(document.querySelector('[data-field-id="shipment-package-type"]')!.textContent).not.toContain('*');
    const select = screen.getByRole('combobox', { name: 'Trọng tải (Loại xe tính cước)' });
    select.focus();
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole('option', { name: 'Xe 5 tấn' }));

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
    const body = quickCreateShipment.mock.calls[0][0] as Record<string, unknown>;
    expect(body.revVehicleClassId).toBe(14);
    expect(body.packageType).toBeNull();
    expect(body.cargoMode).toBe('LCL');
    cleanup();
  });

  it('bỏ trống cả hai → lot vẫn tạo được, revVehicleClassId null (chip không đếm quy cách)', async () => {
    renderWorkspace();
    await enterAdHocLcl();

    // The required chip's denominator proves quy cách left the set: 3 identity
    // + số lượng + trọng lượng + ngày giờ đóng trả = 6, all filled here → 6/6
    // (a quy cách slot would read x/7).
    await waitFor(() => expect(document.querySelector('.csc-topline__progress')?.textContent).toContain('Bắt buộc: 6/6'));

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
    const body = quickCreateShipment.mock.calls[0][0] as Record<string, unknown>;
    expect(body.packageType).toBeNull();
    expect(body.revVehicleClassId).toBeNull();
    cleanup();
  });

  it('FCL không có ô Trọng tải cấp lô — root payload không mang key', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')!, { target: { value: 'BL-FCL-846' } });

    expect(document.querySelector('[data-field-id="shipment-rev-vehicle-class"]')).toBeNull();
    cleanup();
  });
});
