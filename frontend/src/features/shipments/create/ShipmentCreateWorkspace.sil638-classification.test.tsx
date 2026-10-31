// SIL-638 (id 742) TC5 — CUS khai báo Kẹp/Kết hợp NGAY TRÊN form Tạo lô FCL:
// mỗi dòng container có một nhóm radio Phân loại (Đơn/Kẹp/Kết hợp, Đơn chọn
// sẵn). Tích Kẹp cho cả 2 cont → payload quick-create mang
// `containers[].classification: 'DOUBLE'` cho cả hai → fulfilment sinh ra
// mang dispatch_classification tương ứng (hợp đồng brief-sil-638-be), nên
// Điều vận thấy sẵn KẸP trên Kế hoạch Chi tiết, không phải đổi tay.
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

describe('SIL-638 TC5 — Phân loại theo từng dòng cont trên form Tạo lô FCL', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 742, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('mỗi dòng cont có nhóm radio Đơn/Kẹp/Kết hợp, Đơn chọn sẵn', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const group = within(table).getByRole('radiogroup', { name: 'Phân loại vận chuyển — container 1' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(['SINGLE', 'DOUBLE', 'COMBINED']);
    // ĐƠN is the preselected default.
    expect(radios.find((radio) => radio.value === 'SINGLE')!.checked).toBe(true);
    expect(radios.find((radio) => radio.value === 'DOUBLE')!.checked).toBe(false);
  });

  it('chọn Kẹp cho 2 cont → payload gửi classification DOUBLE cho cả hai (Đơn bỏ trống)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    pickCustomer();

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const tickKep = (groupLabel: string) => {
      fireEvent.click(within(within(table).getByRole('radiogroup', { name: groupLabel })).getByRole('radio', { name: 'Kẹp' }));
    };
    // Each row carries its own identity facts (the BE reconcile requires
    // containerTypeId) — the classification is the TC5 delta under test.
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-KEP-1' } });
    tickKep('Phân loại vận chuyển — container 1');
    // Row 2 joins as a Kẹp member too — the TC5 happy path (2 cont 20' chạy kẹp).
    // The click re-asserts DOUBLE on an already-inherited pick, so this test
    // doubles as the inheritance pin ("Thêm container" carries the previous
    // row's classification, like its other shared fields).
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const declarations = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    fireEvent.change(declarations[1], { target: { value: 'TK-KEP-2' } });
    expect((within(within(table).getByRole('radiogroup', { name: 'Phân loại vận chuyển — container 2' })).getByRole('radio', { name: 'Kẹp' }) as HTMLInputElement).checked).toBe(true);
    tickKep('Phân loại vận chuyển — container 2');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers![0]).toMatchObject({ classification: 'DOUBLE' });
    expect(payload.containers![1]).toMatchObject({ classification: 'DOUBLE' });
  });

  it('không đụng phân loại → payload KHÔNG gửi classification (mặc định Đơn thuộc về backend)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    pickCustomer();

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-638' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers![0]).not.toHaveProperty('classification');
  });

  it('chọn Kết hợp trên một dòng → payload gửi COMBINED cho đúng dòng đó', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    pickCustomer();

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-KETOP-1' } });
    fireEvent.click(within(within(table).getByRole('radiogroup', { name: 'Phân loại vận chuyển — container 1' })).getByRole('radio', { name: 'Kết hợp' }));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers![0]).toMatchObject({ classification: 'COMBINED' });
  });
});

async function waitForCalled() {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(quickCreateShipment).toHaveBeenCalled());
}
