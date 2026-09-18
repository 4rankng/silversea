import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary, getDetail } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listSummary: vi.fn(), getDetail: vi.fn() }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: getDetail,
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

function renderPage(initialEntry = '/shipments-debit') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  factoryName: 'NM A',
  factoryAddress: 'Bình Dương',
  billOrBookNumber: 'BL-1',
  customsNumber: 'TK-1',
  documentsSummary: '5/6',
  freightAuto: 4_500_000,
  chiHoTotal: 2_000_000,
  receivableTotal: 9_000_000,
  profit: 2_500_000,
  lockStatus: 'OPEN',
  lockedAt: null,
  ...over,
});

beforeEach(() => {
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
  getDetail.mockReset();
});

describe('Chi phí - Quyết toán — L1 lot list (20260918_17)', () => {
  it('requires the customer pick before any list fetch happens', async () => {
    renderPage();
    expect(await screen.findByText('Chưa chọn khách hàng')).toBeTruthy();
    expect(listSummary).not.toHaveBeenCalled();
    // Picking the customer fires the summary fetch with the numeric id.
    fireEvent.click(await screen.findByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1 })));
  });

  it('keeps customer, delivery-date range and lock status in the URL', async () => {
    listSummary.mockResolvedValue({ items: [], total: 0 });
    renderPage('/shipments-debit?customer=1&from=2026-09-01&to=2026-09-30&lock=LOCKED');
    await waitFor(() => expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 1,
      deliveryDateFrom: '2026-09-01',
      deliveryDateTo: '2026-09-30',
      lockStatus: 'LOCKED',
    })));
    // 3 options stay below the search threshold → the select renders a button trigger.
    expect(screen.getByRole('button', { name: /Trạng thái khóa lô/ })).toHaveTextContent('Đã khóa');
  });

  it('renders money from the payload and shows Chưa xác định for unknown amounts', async () => {
    listSummary.mockResolvedValue({
      items: [
        row({ lockStatus: 'LOCKED' }),
        row({ shipmentId: 102, code: 'SHP-26-0002', freightAuto: null, profit: null, documentsSummary: null }),
      ],
      total: 2,
    });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('SHP-26-0001')).toBeTruthy();
    // Numbers format exactly as the payload says — never a fabricated 0.
    expect(screen.getByText('4.500.000')).toBeTruthy();
    expect(screen.getAllByText('Chưa xác định').length).toBeGreaterThanOrEqual(3);
    // The locked row carries the badge and an enabled select box.
    const lockedBox = screen.getByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }) as HTMLInputElement;
    expect(lockedBox.disabled).toBe(false);
    const openBox = screen.getByRole('checkbox', { name: 'Chọn lô SHP-26-0002' }) as HTMLInputElement;
    expect(openBox.disabled).toBe(true);
  });

  it('enables Xuất Debit Note only while a locked lot is selected', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('SHP-26-0001')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }));
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }));
    expect(button.disabled).toBe(true);
  });

  it('clears the selection when filters change so stale locked picks cannot arm the export', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('SHP-26-0001')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô SHP-26-0001' }));
    const button = screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Trạng thái khóa lô/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đang mở' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Xuất Debit Note' }) as HTMLButtonElement).disabled).toBe(true));
  });
});

describe('Chi phí - Quyết toán — L2 expansion (20260918_18)', () => {
  it('mounts the workspace under the expanded lot row and collapses on the second click', async () => {
    listSummary.mockResolvedValue({ items: [row({ lockStatus: 'LOCKED' })], total: 1 });
    getDetail.mockResolvedValue({
      shipmentId: 101,
      freightRows: [],
      chiHoRows: [],
      payables: { freightReturn: null, lachHuyenReturn: null, customsFee: null, psOps: null },
      thuKhachTotal: null,
    });
    renderPage('/shipments-debit?customer=1');
    expect(await screen.findByText('SHP-26-0001')).toBeTruthy();
    expect(screen.queryByText('Bảng 2.1 — Cước vận tải')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết lô SHP-26-0001' }));
    expect(await screen.findByText('Bảng 2.1 — Cước vận tải')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đóng chi tiết lô SHP-26-0001' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết lô SHP-26-0001' }));
    await waitFor(() => expect(screen.queryByText('Bảng 2.1 — Cước vận tải')).toBeNull());
  });
});
