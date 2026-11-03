import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, quickCreateShipment, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  quickCreateShipment: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** SIL-521 (owner 26/10) → SIL-701/SIL-600 (owner ruling 30/10) → SIL-660
 *  (owner ruling 02/11): lịch sử luật tờ khai trên form tạo lô.
 *  - SIL-521 chết máy tờ khai CẤP LÔ (chip strip retired: `shipment-declarations`
 *    field, `.csc-declaration-strip`, Sửa hàng loạt / Xóa tất cả) — máy đó
 *    VẪN CHẾT, pin giữ nguyên.
 *  - SIL-701/SIL-600 sống lại tờ khai theo CONT (cột per-cont, nhập lúc tạo).
 *  - SIL-660 (ruling 02/11, cập nhật luật cho RIÊNG hàng lẻ — khách báo mất
 *    chỗ nhập tờ khai vì tab LCL không có bảng container): tab HÀNG LẺ có ô
 *    "Số tờ khai" CẤP LÔ duy nhất (SIL-601: lẻ = 1 lô 1 cont), persist qua
 *    entity shipment_declarations. Pin absence cấp lô giờ chỉ đúng cho FCL.
 *    Pin chi tiết LCL sống ở ShipmentCreateWorkspace.sil660-lcl-declaration.test.tsx. */
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

describe('SIL-521/600/660 — tờ khai: máy cấp lô cũ vẫn chết, per-cont sống (FCL), ô cấp lô sống riêng cho LCL', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 501, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('máy chip-strip cấp lô SIL-502 vẫn chết; ô cấp lô SIL-660 chỉ tồn tại trên tab LCL, không trên FCL', async () => {
    // SIL-521 điểm 4 keeps the RETIRED MACHINERY dead — strip/chips/textarea
    // + Sửa hàng loạt/Xóa tất cả stay gone on BOTH tabs. Owner ruling 30/10
    // (SIL-701) revived the per-cont half; owner ruling 02/11 (SIL-660) added
    // the LCL lot-level input — so the "no lot-level input anywhere" pin now
    // scopes to the FCL tab only (the default this render opens with).
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('[data-field-id="shipment-declarations"]')).toBeNull();
    expect(document.querySelector('.csc-declaration-strip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa hàng loạt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).toBeNull();
    // FCL: no lot-level declaration input — per-cont column only.
    expect(document.querySelector('[data-field-id="shipment-lcl-declaration-number"]')).toBeNull();
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toContain('Số tờ khai');
    expect(within(table).getAllByLabelText('Số tờ khai')).toHaveLength(1);
    cleanup();
  });

  it('SIL-600: mỗi dòng container có ô SỐ TỜ KHAI nhập được ngay lúc tạo', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const declarationInputs = within(table).getAllByLabelText('Số tờ khai');
    expect(declarationInputs.length).toBeGreaterThanOrEqual(1);
    expect((declarationInputs[0] as HTMLInputElement).value).toBe('');
    cleanup();
  });
});
