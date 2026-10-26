import { cleanup, render, screen } from '@testing-library/react';
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
 *  class lived in is retired entirely. Số tờ khai chỉ nhập/sửa ở cấp cont
 *  (Tổng quan ledger cells / drawer DeclarationCell, per-cont line update). */
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

  it('không còn input/chip/strip Số tờ khai trên form', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(screen.queryByRole('textbox', { name: 'Số tờ khai' })).toBeNull();
    expect(screen.queryByLabelText('Số tờ khai')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa hàng loạt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).toBeNull();
    expect(document.querySelector('[data-field-id="shipment-declarations"]')).toBeNull();
    expect(document.querySelector('.csc-declaration-strip')).toBeNull();
    cleanup();
  });
});
