// SIL-933 (KB K1.3): form Hàng lẻ phải thấy cước dự kiến TRƯỚC khi lưu —
// FreightPreviewCard nhận đúng bộ căn cứ cấp lô (khách + tuyến + loại xe tính
// cước + ngày giờ đóng/trả), đúng khung cước FCL đã có từ container đầu.
// KHÔNG mock FreightPreviewCard: card thật render qua hook useFreightPreview
// bị mock để chốt contract của input. Thiếu căn cứ → hook ăn null (không hỏi,
// không bịa số); thiếu bảng giá → MANUAL card 'Chưa có bảng giá'.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const freightPreviewMock = vi.fn<(input: unknown) => { data?: { source: 'AUTO' | 'MANUAL'; freight: number; surcharge: number; total: number; formula: string } }>(() => ({ data: undefined }));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: (input: unknown) => freightPreviewMock(input),
}));
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

/** Canonical 9 (seed-demo-freight-pricing) — code IS the bảng giá rate key. */
const CATALOG_CLASSES = [
  { id: 11, code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false, sortOrder: 1 },
  { id: 14, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 4 },
  { id: 18, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8 },
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

/** Catalog LCL lot, the QA probe shape (SIL-933 comment): khách + tuyến +
 *  nhà máy + đóng/trả 20/08/2026 09:30 + trọng tải Xe 5 tấn. */
async function enterCatalogLcl() {
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
  await waitFor(() => expect(document.querySelector('[data-field-id="shipment-rev-vehicle-class"]')).toBeTruthy());
  fireEvent.click(document.getElementById('shipment-trade-direction')!);
  fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
  fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')!, { target: { value: 'BL-SIL933' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'Nhà máy (Điểm trả hàng)' }));
  fireEvent.click(await screen.findByRole('option', { name: 'NM Quế Võ' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Tuyến đường' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Route A' }));
  fireEvent.change(screen.getByLabelText(/Số lượng/), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Trọng lượng/), { target: { value: '300' } });
  const closing = document.querySelector('[data-field-id="shipment-lcl-closing-at"]')!;
  const seg = (key: string) => closing.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`)!;
  fireEvent.change(seg('hh'), { target: { value: '09' } });
  fireEvent.change(seg('mm'), { target: { value: '30' } });
  fireEvent.change(seg('dd'), { target: { value: '20' } });
  fireEvent.change(seg('mm2'), { target: { value: '08' } });
  fireEvent.change(seg('yyyy'), { target: { value: '2026' } });
  const select = screen.getByRole('combobox', { name: 'Trọng tải (Loại xe tính cước)' });
  select.focus();
  fireEvent.click(select);
  fireEvent.click(await screen.findByRole('option', { name: 'Xe 5 tấn' }));
}

describe('SIL-933 — form Hàng lẻ thấy cước dự kiến như FCL', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    getVehicleSizeClasses.mockReset();
    freightPreviewMock.mockReset();
    freightPreviewMock.mockReturnValue({ data: undefined });
    listSharedWarehouseSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 933, version: 1 });
    getVehicleSizeClasses.mockResolvedValue(CATALOG_CLASSES);
    listOperationalSites.mockResolvedValue([
      {
        id: 5, customerId: 1, code: 'QV', name: 'NM Quế Võ', siteType: 'FACTORY',
        routeId: null, address: 'KCN Quế Võ', googleMapsUrl: null, contactName: null,
        contactPhone: null, warehouseContactInfo: null, liftInfo: null, dropInfo: null,
        cleaningInfo: null, liftFeeInvoiceName: null, liftFeeInvoiceAddress: null,
        liftFeeTaxCode: null,
      },
    ]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('chọn đủ căn cứ LCL → card hỏi đúng khách + tuyến + 5T + ngày đóng/trả, khung cước hiện số thật', async () => {
    renderWorkspace();
    // Trước khi đủ căn cứ (chưa chọn loại xe), hook phải ăn null — không hỏi,
    // không bịa.
    await enterCatalogLcl();
    await waitFor(() => expect(freightPreviewMock).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 1,
      routeId: 7,
      vehicleSizeClassCode: '5T',
      transportDate: '2026-08-20',
    })));
    expect(freightPreviewMock).toHaveBeenCalledWith(null);
    cleanup();

    // The card frame rides the same input — AUTO answer renders real money.
    freightPreviewMock.mockReturnValue({
      data: { source: 'AUTO', freight: 2_300_000, surcharge: 0, total: 2_300_000, formula: '2.300.000 × (1 + 3%)' },
    });
    renderWorkspace();
    await enterCatalogLcl();
    await screen.findByText('Tổng cước thu khách');
    // Cước gốc và Tổng có thể tròn số như nhau — cả hai dòng đều in số thật.
    expect(screen.getAllByText('2.300.000 ₫').length).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  it('thiếu bảng giá → card MANUAL ghi rõ “Chưa có bảng giá — cần nhập tay”, không hiện số bịa', async () => {
    freightPreviewMock.mockReturnValue({
      data: { source: 'MANUAL', freight: 0, surcharge: 0, total: 0, formula: 'Thiếu giá gốc cho 5T — cần nhập tay' },
    });
    renderWorkspace();
    await enterCatalogLcl();
    const card = await screen.findByText('Chưa có bảng giá — cần nhập tay');
    expect(card).toBeTruthy();
    expect(screen.getByText('Thiếu giá gốc cho 5T — cần nhập tay')).toBeTruthy();
    expect(document.querySelector('[data-freight-preview="manual"]')?.textContent).not.toMatch(/0 ₫/);
    cleanup();
  });
});
