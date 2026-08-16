import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import { ReducedMotionProvider } from '../../hooks/usePrefersReducedMotion';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  quickCreate: vi.fn(),
  sites: vi.fn(),
  saveContainers: vi.fn(),
  createDeclaration: vi.fn(),
  updateDeclaration: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
}));

vi.mock('../../api/tripClient', () => ({ tripClient: { getBootstrap: mocks.bootstrap } }));
vi.mock('../../api/shipmentClient', () => ({
  quickCreateShipment: mocks.quickCreate,
  listOperationalSites: mocks.sites,
  saveShipmentContainers: mocks.saveContainers,
  createShipmentDeclaration: mocks.createDeclaration,
  updateShipmentDeclaration: mocks.updateDeclaration,
  updateShipment: mocks.updateShipment,
  getShipmentDetail: mocks.getShipmentDetail,
}));

vi.mock('../../components/UI', () => ({
  Modal: ({ isOpen, onClose, title, children, footer }: {
    isOpen: boolean; onClose?: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode;
  }) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}<button type="button" onClick={onClose}>Đóng</button></div> : null,
  Drawer: ({ isOpen, onClose, title, children }: {
    isOpen: boolean; onClose?: () => void; title?: string; children: React.ReactNode;
  }) => isOpen ? <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Đóng</button></div> : null,
}));

import ClerkShipmentCreatePage from './ClerkShipmentCreatePage';

const longCustomerName = 'Công ty Cổ phần Vận tải và Logistics Biển Bắc';

const bootstrap = {
  customers: [{ id: 7, name: longCustomerName }],
  routes: [{ id: 11, name: 'Cát Lái — Sóng Thần' }],
  ports: [{ id: 21, name: 'Cảng Cát Lái' }, { id: 22, name: 'Cảng ICD Sóng Thần' }],
  containerTypes: [{ id: 31, code: '40HC', name: 'Container 40 feet cao' }],
  cargoTypes: [{ id: 32, code: 'LCL', name: 'Hàng lẻ' }],
  externalCarriers: [],
};

const sites = [
  { id: 41, customerId: 7, code: 'NM01', name: 'Nhà máy Long Minh', siteType: 'FACTORY', address: 'Bình Dương', googleMapsUrl: 'https://maps.google.com/example', contactName: 'Anh Nam', contactPhone: '0901000000', liftFeeInvoiceName: 'Long Minh', liftFeeInvoiceAddress: 'Bình Dương', liftFeeTaxCode: '3700000000', strictRules: 'Gọi điện trước khi vào', version: 1 },
  { id: 42, customerId: 7, code: 'KHO01', name: 'Kho Long Minh', siteType: 'WAREHOUSE', address: 'Bình Dương', googleMapsUrl: null, contactName: null, contactPhone: null, liftFeeInvoiceName: null, liftFeeInvoiceAddress: null, liftFeeTaxCode: null, strictRules: null, version: 1 },
];

function renderPage() {
  return render(<MemoryRouter initialEntries={['/shipments/new']}><ReducedMotionProvider><ToastProvider><Routes>
    <Route path="/shipments/new" element={<ClerkShipmentCreatePage />} />
    <Route path="/clerk/shipments/:id/docs" element={<div data-testid="dossier" />} />
    <Route path="/shipments" element={<div data-testid="shipment-list" />} />
  </Routes></ToastProvider></ReducedMotionProvider></MemoryRouter>);
}

async function choose(label: string, value: string) {
  const labelElement = Array.from(document.querySelectorAll('label')).find((element) => element.textContent?.trim().startsWith(label));
  const nativeSelect = labelElement?.parentElement?.querySelector('select');
  if (nativeSelect instanceof HTMLSelectElement) {
    fireEvent.change(nativeSelect, { target: { value } });
    return;
  }
  const combobox = screen.getByRole('combobox', { name: new RegExp(`^${label}`) });
  fireEvent.focus(combobox);
  fireEvent.keyDown(combobox, { key: 'ArrowDown' });
  const option = await waitFor(() => {
    const match = document.querySelector<HTMLElement>(`[role="option"][id$="-option-${value}"]`);
    if (!match) throw new Error(`Không tìm thấy lựa chọn ${value} trong trường ${label}`);
    return match;
  });
  fireEvent.click(option);
  await waitFor(() => expect(document.querySelector(`[role="option"][id$="-option-${value}"]`)).toBeNull());
}

describe('ClerkShipmentCreatePage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.bootstrap.mockResolvedValue(bootstrap);
    mocks.sites.mockResolvedValue(sites);
    mocks.quickCreate.mockResolvedValue({ id: 90, version: 1 });
    mocks.saveContainers.mockResolvedValue({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    mocks.createDeclaration.mockResolvedValue({ id: 1 });
    mocks.updateDeclaration.mockResolvedValue({ id: 1 });
    mocks.updateShipment.mockResolvedValue({ id: 90, version: 2 });
    mocks.getShipmentDetail.mockResolvedValue({ shipment: { id: 90, version: 1 } });
  });

  it('shows only create and cancel actions, without the superseded draft or dispatch actions', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    expect(screen.getByRole('button', { name: 'Tạo lô hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lưu bản nháp|Gửi sang điều phối/ })).toBeNull();
  });

  it('renders long customer names in the customer-specific dropdown treatment', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const combobox = screen.getByRole('combobox', { name: /^Khách hàng/ });
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    const option = await screen.findByRole('option', { name: longCustomerName });
    expect(option.className).toContain('csc-customer-option');
    expect(document.querySelector('.csc-customer-popover')).toBeTruthy();
    expect(combobox.closest('.csc-customer-field')).toBeTruthy();
  });

  it('requires a customer before creating a shipment', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn khách hàng để tạo lô hàng');
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('creates a customer-only shipment without a manual dispatch request', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7, cargoMode: 'FCL' }), expect.any(String)));
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('hides the FCL volume field and copies the previous container when adding a row', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    expect(screen.queryByLabelText('Thể tích (m³)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-20' } });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));

    expect(screen.getAllByLabelText('Số container').map((field) => (field as HTMLInputElement).value)).toEqual(['MSCU6639870', '']);
    expect(screen.getAllByLabelText('Trọng lượng (kg)').map((field) => (field as HTMLInputElement).value)).toEqual(['12000', '12000']);
    expect(screen.getAllByLabelText('Ngày giao dự kiến').map((field) => (field as HTMLInputElement).value)).toEqual(['2026-08-20', '2026-08-20']);
  });

  it('persists an FCL container delivery date with an optional container number', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Hình thức xuất nhập khẩu', 'IMPORT');
    await choose('Tuyến đường', '11');
    fireEvent.change(screen.getByLabelText(/^Số Bill\/Booking/), { target: { value: 'BL-FCL' } });
    await choose('Loại container', '31');
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [expect.objectContaining({
        containerNumber: null,
        customerAppointmentAt: '2026-08-14T12:00:00.000Z',
      })],
    })));
    expect(mocks.quickCreate.mock.calls[0][0]).toMatchObject({ tradeDirection: 'IMPORT' });
    expect(mocks.quickCreate.mock.calls[0][0].expectedDeliveryDate).toBeUndefined();
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('opens a confirmation before discarding entered data and creates nothing', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Hình thức xuất nhập khẩu', 'IMPORT');
    fireEvent.change(screen.getByLabelText(/^Số Bill\/Booking/), { target: { value: 'BL-DIRTY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ tạo lô hàng?' })).toBeTruthy();
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('keeps the factory creation action discoverable before a customer is selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    fireEvent.click(screen.getAllByRole('button', { name: /Thêm nhà máy/ })[0]);
    await waitFor(() => expect(document.querySelector('.toast-container')?.textContent).toContain('Vui lòng chọn khách hàng trước khi thêm nhà máy'));
  });

  it('opens the factory dialog after a customer is selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    fireEvent.click(screen.getAllByRole('button', { name: /Thêm nhà máy/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhà máy' });
    expect(within(dialog).getByLabelText('Mã điểm vận hành')).toBeTruthy();
  });
});
