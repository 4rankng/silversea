// SIL-600 (owner ruling 30/10, qua QA Glint): bảng "Thông tin hàng" trên form
// tạo lô có cột SỐ TỜ KHAI THEO TỪNG CONTAINER — nhập được ngay lúc tạo lô,
// đặt ngay sau nhóm SỐ CONTAINER (đúng thứ tự sheet Thông tin hàng phía CUS),
// theo mô hình SIL-521: từng cont nhập/sửa riêng, trùng số trong cùng lô
// KHÔNG bị chặn. Ô cấp lô vẫn cấm (pin sống ở
// ShipmentCreateWorkspace.sil502-declaration-draft.test.tsx).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

describe('SIL-600 — cột SỐ TỜ KHAI theo cont trên bảng Thông tin hàng', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 601, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('cột nằm đúng thứ tự sheet: STT → SỐ CONTAINER → SỐ TỜ KHAI → NHÀ MÁY → …', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'STT',
      'Số container',
      'Số tờ khai',
      'Nhà máy',
      'Tuyến đường',
      'Cảng nâng',
      'Cảng hạ',
      'Ngày giờ đóng trả',
      'Thao tác',
    ]);
    cleanup();
  });

  it('nhập số tờ khai lúc tạo → payload gửi declarationNumber theo cont', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const declarationInput = within(table).getByLabelText('Số tờ khai') as HTMLInputElement;
    fireEvent.change(declarationInput, { target: { value: 'TK-0123456789' } });
    expect(declarationInput.value).toBe('TK-0123456789');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(1);
    expect(payload.containers![0]).toMatchObject({ declarationNumber: 'TK-0123456789' });
    cleanup();
  });

  it('hai cont cùng một số tờ khai lưu được — không chặn trùng trong cùng lô', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));

    const table = screen.getByRole('table', { name: 'Danh sách container' });
    fireEvent.change(within(table).getByLabelText('Số tờ khai'), { target: { value: 'TK-SHARED-01' } });

    // "Thêm container" inherits the shared declaration (SIL-600): the new row
    // opens with the same number, still editable per row.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const inputs = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[1].value).toBe('TK-SHARED-01');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitForCalled();

    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers![0]).toMatchObject({ declarationNumber: 'TK-SHARED-01' });
    expect(payload.containers![1]).toMatchObject({ declarationNumber: 'TK-SHARED-01' });
    // No duplicate-declaration issue anywhere on the form.
    expect(screen.queryByText(/trùng.*tờ khai/i)).toBeNull();
    cleanup();
  });
});

async function waitForCalled() {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(quickCreateShipment).toHaveBeenCalled());
}
