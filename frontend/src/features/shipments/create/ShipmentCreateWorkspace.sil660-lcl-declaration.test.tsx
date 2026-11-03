// SIL-660 (owner ruling 02/11): tab HÀNG LẺ của form Tạo lô có ô "Số tờ
// khai" CẤP LÔ trong Thông tin hàng — khách báo mất trường nhập tờ khai từ
// 0a20bd1c (SIL-521 gỡ ô cấp lô, tab LCL không có bảng container nên không
// còn chỗ nhập nào). Ruling CẬP NHẬT luật SIL-600/SIL-701 cho riêng hàng
// lẻ (SIL-601: lẻ = 1 lô 1 cont); FCL giữ nguyên per-cont column.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getBootstrap,
  quickCreateShipment,
  createShipmentDeclaration,
  listOperationalSites,
  listSharedWarehouseSites,
} = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  quickCreateShipment: vi.fn(),
  createShipmentDeclaration: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  quickCreateShipment,
  createShipmentDeclaration,
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

async function enterLclMode() {
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
  await waitFor(() => expect(document.querySelector('[data-field-id="shipment-pickup-warehouse"]')).toBeTruthy());
  fireEvent.click(document.getElementById('shipment-trade-direction')!);
  fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
  fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-booking-ref"] input')!, { target: { value: 'BL-SIL660' } });
}

describe('SIL-660 — ô Số tờ khai cấp lô trên tab HÀNG LẺ (ruling 02/11)', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    createShipmentDeclaration.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 660, version: 1 });
    createShipmentDeclaration.mockResolvedValue({
      id: 910, shipmentId: 660, declarationNumber: 'TK-LCL-660', issuedAt: null,
      scope: 'SINGLE', note: null, createdBy: null,
      createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('tab HÀNG LẺ có ô "Số tờ khai" nhập được trong Thông tin hàng', async () => {
    renderWorkspace();
    await enterLclMode();

    const wrap = await waitFor(() => {
      const el = document.querySelector('[data-field-id="shipment-lcl-declaration-number"]');
      expect(el).toBeTruthy();
      return el!;
    });
    const input = within(wrap as HTMLElement).getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(input.value).toBe('');
    // The field lives in the Thông tin hàng section, next to the
    // Số lượng/Trọng lượng/Thể tích group (one input for the whole lot).
    expect((wrap as HTMLElement).closest('section')!.textContent).toContain('Thông tin hàng');
    fireEvent.change(input, { target: { value: 'TK-LCL-660' } });
    expect(input.value).toBe('TK-LCL-660');
    cleanup();
  });

  it('nhập số + Lưu nháp → POST /shipments/:id/declarations với số đã nhập; root payload không mang key cấp lô', async () => {
    renderWorkspace();
    await enterLclMode();

    const route = screen.getByRole('combobox', { name: /^Tuyến đường/ }) as HTMLInputElement;
    route.focus();
    fireEvent.click(route);
    fireEvent.click(await screen.findByRole('option', { name: 'Route A' }));
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-operational-site"] input')!, { target: { value: 'Nhà máy 660' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-pickup-warehouse"] input')!, { target: { value: 'Kho CFS 660' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Quy cách đóng gói' }), { target: { value: 'Pallet' } });
    fireEvent.change(screen.getByLabelText(/Số lượng/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Trọng lượng/), { target: { value: '300' } });
    const closing = document.querySelector('[data-field-id="shipment-lcl-closing-at"]')!;
    const seg = (key: string) => closing.querySelector<HTMLInputElement>(`input[data-seg="${key}"]`)!;
    fireEvent.change(seg('hh'), { target: { value: '09' } });
    fireEvent.change(seg('mm'), { target: { value: '30' } });
    fireEvent.change(seg('dd'), { target: { value: '20' } });
    fireEvent.change(seg('mm2'), { target: { value: '08' } });
    fireEvent.change(seg('yyyy'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '  TK-LCL-660  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createShipmentDeclaration).toHaveBeenCalledTimes(1));

    expect(createShipmentDeclaration.mock.calls[0][0]).toBe(660);
    expect(createShipmentDeclaration.mock.calls[0][1]).toEqual({ declarationNumber: 'TK-LCL-660' });
    const body = quickCreateShipment.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('declarationNumber');
    cleanup();
  });

  it('FCL: vẫn KHÔNG có ô tờ khai cấp lô — cột per-cont giữ nguyên (SIL-600/SIL-701)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('[data-field-id="shipment-lcl-declaration-number"]')).toBeNull();
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    expect(within(table).getAllByLabelText('Số tờ khai')).toHaveLength(1);
    cleanup();
  });
});
