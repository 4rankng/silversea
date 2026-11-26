// SIL-1080 — hai defect Wave5 rerun trên form tạo lô:
//  - Tờ khai cont 1 tự điền sang các dòng cont còn trống ngay lúc nhập
//    (đồng bộ như ô inline chi tiết lô), và payload lưu mang số ở MỌI dòng
//    — cont 2 không còn None sau khi lưu.
//  - Đổi khách hàng khi đã chọn nhà máy/kho PHẢI hỏi trước khi xóa pick
//    cũ (Giữ nguyên / Đổi khách hàng); không còn xóa lặng lẽ. Bill/Booking
//    vẫn giữ nguyên qua lần đổi.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function pickCustomer(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name }));
}

async function pickFactoryRow1() {
  const factory = await waitFor(() => {
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ }) as HTMLInputElement;
    expect(input).not.toBeDisabled();
    return input;
  });
  factory.focus();
  fireEvent.click(factory);
  fireEvent.click(await screen.findByRole('option', { name: /ASKEY-X1/ }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: /^Nhà máy/ }) as HTMLInputElement).value).toContain('ASKEY'));
}

describe('SIL-1080 — tờ khai cont 1 đồng bộ sang cont 2 lúc tạo lô', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([
      { id: 11, siteType: 'FACTORY', name: 'ASKEY-XƯỞNG 1', shortName: 'ASKEY-X1', routeId: null },
    ]);
    quickCreateShipment.mockResolvedValue({ id: 1080, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }, { id: 2, name: 'KH B' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('2 cont có sẵn, nhập tờ khai ở cont 1 → cont 2 tự điền; Lưu nháp mang số ở CẢ HAI dòng', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await pickCustomer('KH A');

    // Lô 2 cont tạo TRƯỚC khi nhập tờ khai — đúng repro defect: cont 2 phải
    // nhận theo cont 1 ngay trên form, không phải chỉ sau khi lưu.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const inputs = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    expect(inputs).toHaveLength(2);

    fireEvent.change(inputs[0], { target: { value: 'TK-2CONT-01' } });

    const inputsAfter = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    expect(inputsAfter[0].value).toBe('TK-2CONT-01');
    expect(inputsAfter[1].value).toBe('TK-2CONT-01');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalled());

    const payload = quickCreateShipment.mock.calls[0][0] as { containers?: Array<Record<string, unknown>> };
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers![0]).toMatchObject({ declarationNumber: 'TK-2CONT-01' });
    expect(payload.containers![1]).toMatchObject({ declarationNumber: 'TK-2CONT-01' });
    cleanup();
  });

  it('cont 2 đã tự nhập số riêng thì KHÔNG bị cont 1 ghi đè', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await pickCustomer('KH A');

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const inputs = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];

    // Cont 2 nhập số riêng TRƯỚC.
    fireEvent.change(inputs[1], { target: { value: 'TK-RIENG-02' } });
    // Cont 1 nhập sau — cont 2 giữ số của mình.
    fireEvent.change(inputs[0], { target: { value: 'TK-CHINH-01' } });

    const inputsAfter = within(table).getAllByLabelText('Số tờ khai') as HTMLInputElement[];
    expect(inputsAfter[0].value).toBe('TK-CHINH-01');
    expect(inputsAfter[1].value).toBe('TK-RIENG-02');
    cleanup();
  });
});

describe('SIL-1080 — đổi khách hàng phải cảnh báo trước khi xóa nhà máy/kho đã chọn', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([
      { id: 11, siteType: 'FACTORY', name: 'ASKEY-XƯỞNG 1', shortName: 'ASKEY-X1', routeId: null },
    ]);
    quickCreateShipment.mockResolvedValue({ id: 1080, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }, { id: 2, name: 'KH B' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('có nhà máy: dialog hỏi trước — "Giữ nguyên" giữ customer cũ VÀ nhà máy', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await pickCustomer('KH A');
    await pickFactoryRow1();

    await pickCustomer('KH B');

    // Không xóa lặng lẽ: dialog chờ xác nhận, nhà máy vẫn đứng. Khi gate giữ
    // selection, suggestion popover của combobox còn mở và aria-hide modal
    // (react-aria ariaHideOutside) — quyền truy vấn a11y phải scanning cả
    // node ẩn; click thật vẫn ăn (trình duyệt thật cũng vậy).
    expect(await screen.findByRole('button', { name: 'Giữ nguyên', hidden: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đổi khách hàng', hidden: true })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /^Nhà máy/, hidden: true }) as HTMLInputElement).value).toContain('ASKEY');

    const keep = await screen.findByRole('button', { name: 'Giữ nguyên', hidden: true });
    // A real click moves focus out of the combobox, ending its typing session
    // (the blur settle law) — jsdom's click does not, so fire it explicitly.
    fireEvent.blur(screen.getByRole('combobox', { name: 'Khách hàng', hidden: true }));
    fireEvent.click(keep);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đổi khách hàng', hidden: true })).toBeNull());
    // jsdom không mô phỏng pointer-outside nên suggestion popover chưa đóng
    // và vẫn aria-hide nền — đọc giá trị committed qua node ẩn là đủ.
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Khách hàng', hidden: true }) as HTMLInputElement).value).toBe('KH A'));
    await waitFor(() => expect((screen.getByRole('combobox', { name: /^Nhà máy/, hidden: true }) as HTMLInputElement).value).toContain('ASKEY'));
    cleanup();
  });

  it('xác nhận "Đổi khách hàng" → sang customer mới, nhà máy được xóa', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await pickCustomer('KH A');
    await pickFactoryRow1();

    await pickCustomer('KH B');
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi khách hàng', hidden: true }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đổi khách hàng', hidden: true })).toBeNull());
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Khách hàng', hidden: true }) as HTMLInputElement).value).toBe('KH B'));
    await waitFor(() => expect((screen.getByRole('combobox', { name: /^Nhà máy/, hidden: true }) as HTMLInputElement).value).toBe(''));
    cleanup();
  });

  it('chưa chọn nhà máy/kho nào → đổi thẳng, không dialog', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    await pickCustomer('KH A');
    await pickCustomer('KH B');

    expect(screen.queryByRole('button', { name: 'Giữ nguyên' })).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Khách hàng' }) as HTMLInputElement).value).toBe('KH B');
    cleanup();
  });
});
