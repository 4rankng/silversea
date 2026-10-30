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

/** SIL-521 (owner 26/10): form tạo/sửa lô KHÔNG còn chỗ nhập Số tờ khai cấp
 *  lô — supersede SIL-502's draft-commit pins: the chip strip the SIL-502 bug
 *  class lived in is retired entirely. SIL-701 (owner ruling 30/10) reverses
 *  the per-cont half of the old absence pin: the create form's Thông tin hàng
 *  table now carries a per-cont SỐ TỜ KHAI column (entered at create time,
 *  từng cont riêng, trùng số trong lô hợp lệ) alongside the Tổng quan ledger
 *  cells / drawer DeclarationCell editors. */
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

describe('SIL-521 — form tạo lô hết ô Số tờ khai cấp lô', { timeout: 30000 }, () => {
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

  it('hết ô Số tờ khai CẤP LÔ; cột per-cont TỒN TẠI (đảo pin SIL-701, ruling 30/10)', async () => {
    // SIL-521 điểm 4 keeps the LOT-level input retired — strip/chips/textarea
    // cấp lô stay gone. Owner ruling 30/10 (SIL-701) REVERSES the old
    // "no tờ khai anywhere on the create form" pin for the per-cont half:
    // the Thông tin hàng table now carries one Số tờ khai input per container
    // row, entered at create time (per-cont, trùng số trong lô là hợp lệ).
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('[data-field-id="shipment-declarations"]')).toBeNull();
    expect(document.querySelector('.csc-declaration-strip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa hàng loạt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).toBeNull();
    // Per-cont column present on the cargo table — one input per row.
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toContain('Số tờ khai');
    expect(within(table).getAllByLabelText('Số tờ khai')).toHaveLength(1);
    cleanup();
  });
});
