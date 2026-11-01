// SIL-643 (id 748, owner 01/11 — reverses SIL-638 TC5): the create form has
// NO Phân loại column. The CUS Thông tin hàng sheet shows no Đơn/Kẹp/Kết hợp
// picker and sends no choice — every container row the quick-create payload
// carries is Đơn (`classification: 'SINGLE'`, the explicit wire default).
// Điều vận keeps the only classification edit surface: "Chỉnh sửa điều phối"
// (plan PATCH — flow hiện có, không đụng).
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function renderWorkspace(initialEntry = '/shipments/new') {
  return render(
    <MemoryRouter initialEntries={['/shipments', initialEntry]}>
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

function pickCustomer() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(screen.getByRole('option', { name: 'KH A' }));
}

describe('SIL-643 — bỏ cột Phân loại khỏi form Tạo lô (mặc định Đơn)', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 748, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('CỘT Phân loại KHÔNG TỒN TẠI trên bảng container (không header, không radio)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).not.toContain('Phân loại');
    expect(within(table).queryByRole('radiogroup', { name: /Phân loại vận chuyển/ })).toBeNull();
    expect(within(table).queryAllByRole('radio')).toHaveLength(0);
  });

  it('tạo lô 2 cont → payload gửi classification SINGLE cho CẢ HAI (mặc định Đơn)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    pickCustomer();

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    // Each row carries its own identity facts (the BE reconcile requires
    // containerTypeId) — the always-Đơn payload is the SIL-643 delta here.
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-643-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const declarations = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    fireEvent.change(declarations[1], { target: { value: 'TK-643-2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers![0]).toMatchObject({ classification: 'SINGLE' });
    expect(payload.containers![1]).toMatchObject({ classification: 'SINGLE' });
  });

  it('lô 1 cont không đụng gì → payload vẫn gửi classification SINGLE tường minh', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    pickCustomer();

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-643' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers![0]).toMatchObject({ classification: 'SINGLE' });
  });
});

async function waitForCalled() {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(quickCreateShipment).toHaveBeenCalled());
}
