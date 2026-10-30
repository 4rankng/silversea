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

/** SIL-521 (owner 26/10) → SIL-600 (owner ruling 30/10, qua QA Glint): the
 *  create form still has NO lot-level số tờ khai entry — the retired chip
 *  strip (SIL-502's bug class) stays dead (`shipment-declarations` field,
 *  `.csc-declaration-strip`, Sửa hàng loạt / Xóa tất cả). The owner ruling
 *  REVERSES the "create form deliberately has no tờ khai" pin ONLY at the
 *  per-container tier: each Thông tin hàng row now carries its own SỐ TỜ KHAI
 *  input (entered at intake, editable per row, duplicates allowed in-lot). */
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

describe('SIL-521/SIL-600 — tờ khai: cấp lô vẫn chết, cấp cont sống trên form tạo', { timeout: 30000 }, () => {
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

  it('vẫn không còn input/chip/strip Số tờ khai CẤP LÔ trên form', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('[data-field-id="shipment-declarations"]')).toBeNull();
    expect(document.querySelector('.csc-declaration-strip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa hàng loạt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).toBeNull();
    cleanup();
  });

  it('SIL-600: mỗi dòng container có ô SỐ TỜ KHAI nhập được ngay lúc tạo', async () => {
    const { within } = await import('@testing-library/react');
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const declarationInputs = within(table).getAllByLabelText('Số tờ khai');
    expect(declarationInputs.length).toBeGreaterThanOrEqual(1);
    expect((declarationInputs[0] as HTMLInputElement).value).toBe('');
    cleanup();
  });
});
