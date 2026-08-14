import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/shared/Toast';
import { ReducedMotionProvider } from '../../hooks/usePrefersReducedMotion';
import { ApiError } from '../../lib/api';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  quickCreate: vi.fn(),
  sites: vi.fn(),
  saveContainers: vi.fn(),
  saveCarrierAllocations: vi.fn(),
  submit: vi.fn(),
  createDeclaration: vi.fn(),
  updateDeclaration: vi.fn(),
  updateShipment: vi.fn(),
  pricingPreview: vi.fn(),
  getShipmentDetail: vi.fn(),
}));

vi.mock('../../api/tripClient', () => ({ tripClient: { getBootstrap: mocks.bootstrap } }));
vi.mock('../../api/shipmentClient', () => ({
  quickCreateShipment: mocks.quickCreate,
  listOperationalSites: mocks.sites,
  saveShipmentContainers: mocks.saveContainers,
  saveShipmentCarrierAllocations: mocks.saveCarrierAllocations,
  submitShipmentForDispatch: mocks.submit,
  createShipmentDeclaration: mocks.createDeclaration,
  updateShipmentDeclaration: mocks.updateDeclaration,
  updateShipment: mocks.updateShipment,
  getShipmentPricingPreview: mocks.pricingPreview,
  getShipmentDetail: mocks.getShipmentDetail,
}));

vi.mock('../../components/UI', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), dialog: null }),
  Modal: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose?: () => void;
    title?: string;
    children: React.ReactNode;
  }) => isOpen ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={onClose}>Đóng</button>
    </div>
  ) : null,
  Drawer: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose?: () => void;
    title?: string;
    children: React.ReactNode;
  }) => isOpen ? (
    <div role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={onClose}>Đóng</button>
    </div>
  ) : null,
}));

import ClerkShipmentCreatePage from './ClerkShipmentCreatePage';

const bootstrap = {
  customers: [{ id: 7, name: 'Công ty Long Minh' }],
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
  return render(
    <MemoryRouter initialEntries={['/clerk/shipments/new']}>
      <ReducedMotionProvider>
        <ToastProvider>
          <Routes>
            <Route path="/clerk/shipments/new" element={<ClerkShipmentCreatePage />} />
            <Route path="/clerk/shipments/:id/docs" element={<div data-testid="dossier" />} />
          </Routes>
        </ToastProvider>
      </ReducedMotionProvider>
    </MemoryRouter>,
  );
}

async function closeDialog(name: string | RegExp) {
  const dialog = await screen.findByRole('dialog', { name });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());
}

async function saveCarrierAllocationDialog() {
  const dialog = await screen.findByRole('dialog', { name: 'Gán nhà xe' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu phân bổ' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gán nhà xe' })).toBeNull());
}

async function choose(label: string, value: string) {
  const labelElement = Array.from(document.querySelectorAll('label'))
    .find((element) => element.textContent?.trim().startsWith(label));
  const labelledControl = labelElement?.htmlFor
    ? document.getElementById(labelElement.htmlFor)
    : null;
  const control = labelledControl ?? labelElement?.parentElement?.querySelector('select');
  if (!control) throw new Error(`Không tìm thấy trường chọn ${label}`);
  if (control instanceof HTMLSelectElement) {
    fireEvent.change(control, { target: { value } });
    return;
  }
  fireEvent.click(control);
  const option = document.querySelector<HTMLElement>(`[role="option"][id$="-option-${value}"]`);
  if (!option) throw new Error(`Không tìm thấy lựa chọn ${value} trong trường ${label}`);
  fireEvent.click(option);
  return waitFor(() => {
    expect(document.querySelector(`[role="option"][id$="-option-${value}"]`)).toBeNull();
  });
}

describe('ClerkShipmentCreatePage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.bootstrap.mockResolvedValue(bootstrap);
    mocks.sites.mockResolvedValue(sites);
    mocks.quickCreate.mockResolvedValue({ id: 90, version: 1 });
    mocks.saveContainers.mockResolvedValue({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    mocks.saveCarrierAllocations.mockResolvedValue({ shipment: { id: 90, version: 3 }, assignments: [] });
    mocks.submit.mockResolvedValue({ shipment: { id: 90 }, handoff: { id: 1, status: 'UNSEEN' }, replayed: false });
    mocks.createDeclaration.mockResolvedValue({ id: 1 });
    mocks.updateDeclaration.mockResolvedValue({ id: 1 });
    mocks.updateShipment.mockResolvedValue({ id: 90, version: 2 });
    mocks.getShipmentDetail.mockResolvedValue({ shipment: { id: 90, version: 1 } });
    mocks.pricingPreview.mockResolvedValue({
      readiness: 'MISSING_AUTHORITY',
      message: 'Chưa có bảng giá phù hợp.',
      freightPrice: null,
      freightSource: null,
      freightFormula: null,
      expectedFuelSurcharge: null,
      expectedFuelLiters: null,
      estimationDate: null,
      breakdown: [],
    });
  });

  it('loads customer master data and blocks a draft without customer', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect(screen.getByRole('alert').textContent).toContain('Chọn khách hàng để lưu bản nháp');
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('shows every missing dispatch field and focuses the first invalid control', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Chọn khách hàng.');
    expect(alert.textContent).toContain('Nhập số Bill hoặc số Booking.');
    expect(alert.textContent).toContain('Chọn tuyến đường.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Khách hàng/)));
    expect(screen.getByLabelText(/Khách hàng/).getAttribute('aria-invalid')).toBe('true');
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('protects entered data when the explicit back action is used', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-DIRTY' } });

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(await screen.findByRole('dialog', { name: 'Bỏ tạo lô hàng?' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Số Bill/Book')).toHaveProperty('value', 'BK-DIRTY');
    confirm.mockRestore();
  });

  it('keeps factory rules visible without automatically opening the details dialog', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    expect(screen.getByText('Gọi điện trước khi vào')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Mở vị trí trên Google Maps/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xem chi tiết/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nhà máy Long Minh' });
    expect((await within(dialog).findAllByText('Gọi điện trước khi vào')).length).toBe(1);
    expect(within(dialog).getByRole('link', { name: /Mở vị trí trên Google Maps/ }).getAttribute('href')).toBe('https://maps.google.com/example');
    expect(screen.queryByText(/theo dõi trực tiếp/i)).toBeNull();
    await closeDialog('Nhà máy Long Minh');
  });

  it('saves an incomplete shipment as DRAFT', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-001' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledTimes(1));
    expect(mocks.quickCreate.mock.calls[0][0]).toMatchObject({ customerId: 7, bookingRef: 'BK-001', cargoMode: 'FCL' });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('retries a populated pending-date FCL draft without creating a duplicate shipment', async () => {
    mocks.saveContainers
      .mockRejectedValueOnce(new Error('Mất kết nối khi lưu container'))
      .mockResolvedValueOnce({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mất kết nối khi lưu container');

    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate).toHaveBeenCalledTimes(1);
    expect(mocks.saveContainers.mock.calls[1][0]).toBe(90);
    expect(mocks.saveContainers.mock.calls[1][1]).toMatchObject({ expectedVersion: 1 });
    expect(mocks.getShipmentDetail).toHaveBeenCalledWith(90);
    expect(mocks.saveCarrierAllocations).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('recovers an ambiguous quick-create response before applying edited data', async () => {
    mocks.quickCreate
      .mockRejectedValueOnce(new Error('Mất kết nối sau khi tạo lô'))
      .mockResolvedValueOnce({ id: 90, version: 1 });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-ORIGINAL' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mất kết nối sau khi tạo lô');

    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-EDITED' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));

    await waitFor(() => expect(mocks.updateShipment).toHaveBeenCalledTimes(1));
    expect(mocks.quickCreate.mock.calls[0][0]).toMatchObject({ bookingRef: 'BK-ORIGINAL' });
    expect(mocks.quickCreate.mock.calls[1][0]).toMatchObject({ bookingRef: 'BK-ORIGINAL' });
    expect(mocks.quickCreate.mock.calls[0][1]).toBe(mocks.quickCreate.mock.calls[1][1]);
    expect(mocks.updateShipment).toHaveBeenCalledWith(90, expect.objectContaining({ expectedVersion: 1, bookingRef: 'BK-EDITED' }));
  });

  it('starts a corrected retry with a new create payload and key after a deterministic create rejection', async () => {
    mocks.quickCreate
      .mockRejectedValueOnce(new ApiError(400, null, 'Số Bill không hợp lệ'))
      .mockResolvedValueOnce({ id: 90, version: 1 });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-SAI' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Số Bill không hợp lệ');

    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-DA-SUA' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));

    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate.mock.calls[1][0]).toMatchObject({ bookingRef: 'BK-DA-SUA' });
    expect(mocks.quickCreate.mock.calls[1][1]).not.toBe(mocks.quickCreate.mock.calls[0][1]);
  });

  it('clears a persisted declaration with the nullable update payload after a failed retry', async () => {
    mocks.saveContainers.mockRejectedValueOnce(new Error('Không thể lưu container'));
    mocks.updateDeclaration
      .mockRejectedValueOnce(new Error('Không thể xóa số tờ khai'))
      .mockResolvedValueOnce({ id: 1, declarationNumber: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-01' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không thể lưu container');

    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Không thể xóa số tờ khai');

    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    await waitFor(() => expect(mocks.updateDeclaration).toHaveBeenCalledTimes(2));
    expect(mocks.updateDeclaration).toHaveBeenLastCalledWith(90, 1, {
      declarationNumber: null,
      scope: 'SINGLE',
    });
  });

  it('focuses the carrier allocation button from its validation-summary link', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-CARRIER-FOCUS' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    await choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Hạn hạ container tại cảng'), { target: { value: '2026-08-14T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: /Container 40.*0\/1/ }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Gán nhà xe' }));
  });

  it('saves every FCL container then submits the latest shipment version', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-FCL' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    await choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Hạn hạ container tại cảng'), { target: { value: '2026-08-14T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    await saveCarrierAllocationDialog();
    const submitButton = screen.getByRole('button', { name: /Gửi sang điều phối/ }) as HTMLButtonElement;
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledTimes(1));
    expect(mocks.saveCarrierAllocations).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(90, expect.objectContaining({
      expectedVersion: 2,
      carrierAllocations: [{
        carrierType: 'OWN',
        externalCarrierId: null,
        carrierName: 'Đội xe nội bộ SilverSea',
        count20: 0,
        count40: 1,
      }],
    }), expect.any(String));
    expect(mocks.saveContainers.mock.calls[0][1].containers[0]).toMatchObject({ containerNumber: 'MSCU6639870', shippingLineName: 'MSC', pickupPortId: 21, dropoffPortId: 22 });
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('persists corrected container fields before retrying a failed dispatch submit', async () => {
    mocks.submit
      .mockRejectedValueOnce(new Error('Cảng hạ đã ngừng hoạt động'))
      .mockResolvedValueOnce({ shipment: { id: 90 }, handoff: { id: 1, status: 'UNSEEN' }, replayed: false });
    mocks.saveContainers
      .mockResolvedValueOnce({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null })
      .mockResolvedValueOnce({ shipmentVersion: 3, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-RETRY' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    await choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Hạn hạ container tại cảng'), { target: { value: '2026-08-14T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    await saveCarrierAllocationDialog();

    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await choose('Cảng hạ', '21');
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate).toHaveBeenCalledTimes(1);
    expect(mocks.saveContainers).toHaveBeenCalledTimes(2);
    expect(mocks.saveContainers.mock.calls[1][1]).toMatchObject({
      expectedVersion: 2,
      containers: [expect.objectContaining({ dropoffPortId: 21 })],
    });
    expect(mocks.submit.mock.calls[0][2]).not.toBe(mocks.submit.mock.calls[1][2]);
    expect(mocks.submit.mock.calls[1][1]).toMatchObject({ expectedVersion: 3 });
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('removes persisted FCL containers before retrying the same shipment as LCL', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.submit
      .mockRejectedValueOnce(new Error('Cần sửa hình thức hàng'))
      .mockResolvedValueOnce({ shipment: { id: 90 }, handoff: { id: 1, status: 'UNSEEN' }, replayed: false });
    mocks.saveContainers
      .mockResolvedValueOnce({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null })
      .mockResolvedValueOnce({ shipmentVersion: 4, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    mocks.updateShipment.mockResolvedValueOnce({ id: 90, version: 3 });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-MODE-RETRY' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    await choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Hạn hạ container tại cảng'), { target: { value: '2026-08-14T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    await saveCarrierAllocationDialog();
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ (LCL)' }));
    await choose('Loại hàng', '32');
    await choose('Kho lấy hàng', '42');
    await choose('Quy cách đóng gói', 'Pallet');
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Thể tích (CBM)'), { target: { value: '6.5' } });
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-06' } });
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate).toHaveBeenCalledTimes(1);
    expect(mocks.updateShipment).toHaveBeenCalledTimes(1);
    expect(mocks.updateShipment.mock.calls[0][1]).toMatchObject({ cargoMode: 'LCL', operationalSiteId: null, factoryName: null });
    expect(mocks.saveContainers).toHaveBeenCalledTimes(2);
    expect(mocks.saveContainers.mock.calls[1][1]).toEqual({ expectedVersion: 3, containers: [] });
    expect(mocks.submit.mock.calls[1][1]).toMatchObject({ expectedVersion: 4 });
    expect(mocks.submit.mock.calls[1][1]).not.toHaveProperty('carrierAllocations');
    expect(await screen.findByTestId('dossier')).toBeTruthy();
    confirm.mockRestore();
  });

  it('reconciles an ambiguous FCL container save to an empty LCL container list', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.saveContainers
      .mockRejectedValueOnce(new Error('Mất kết nối khi lưu container'))
      .mockResolvedValueOnce({ shipmentVersion: 3, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    mocks.updateShipment.mockResolvedValueOnce({ id: 90, version: 2 });
    mocks.getShipmentDetail.mockResolvedValueOnce({ shipment: { id: 90, version: 2 } });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mất kết nối khi lưu container');

    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ (LCL)' }));
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Loại hàng', '32');
    await choose('Kho lấy hàng', '42');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-LCL-RECOVERY' } });
    await choose('Quy cách đóng gói', 'Pallet');
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Thể tích (CBM)'), { target: { value: '6.5' } });
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-06' } });
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.getShipmentDetail).toHaveBeenCalledWith(90);
    expect(mocks.saveContainers.mock.calls[1][1]).toEqual({ expectedVersion: 2, containers: [] });
    confirm.mockRestore();
  });

  it('submits one LCL fulfillment payload with warehouse, package count, KG and CBM', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Số Bill/Book'), { target: { value: 'BK-LCL' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ (LCL)' }));
    await choose('Loại hàng', '32');
    await choose('Kho lấy hàng', '42');
    await choose('Quy cách đóng gói', 'Pallet');
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '1250' } });
    fireEvent.change(screen.getByLabelText('Thể tích (CBM)'), { target: { value: '8.5' } });
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-03' } });
    const submitButton = screen.getByRole('button', { name: /Gửi sang điều phối/ }) as HTMLButtonElement;
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.quickCreate.mock.calls[0][0]).toMatchObject({ cargoMode: 'LCL', pickupWarehouseSiteId: 42, packageType: 'Pallet', packageCount: 12, cargoWeightKg: '1250', cargoVolumeCbm: '8.5', expectedDeliveryDate: '2026-08-03' });
    expect(mocks.saveContainers).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('surfaces a warning toast when "Thêm nhà máy" is clicked before a customer is selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    // No customer selected — the "Thêm nhà máy" button must still be visible
    // so the user has a discoverable next step. Clicking it should NOT silently
    // no-op; it should explain what's missing.
    const addButton = screen.getAllByRole('button', { name: /Thêm nhà máy/ })[0];
    fireEvent.click(addButton);
    // The toast renders a .toast element. The animation may keep opacity:0 in
    // jsdom but the message is still in the DOM, so query by class+text.
    await waitFor(() => {
      const container = document.querySelector('.toast-container');
      expect(container?.textContent).toContain('Vui lòng chọn khách hàng trước khi thêm nhà máy');
    });
    // Dialog must NOT have opened because customer is missing.
    expect(screen.queryByLabelText('Mã điểm vận hành')).toBeNull();
  });

  it('opens the operational-site dialog when "Thêm nhà máy" is clicked with a customer selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    const addButton = screen.getAllByRole('button', { name: /Thêm nhà máy/ })[0];
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhà máy' });
    expect(within(dialog).getByLabelText('Mã điểm vận hành')).toBeTruthy();
    await closeDialog('Thêm nhà máy');
  });

  it('keeps the "Thêm nhà máy" action available after a factory is already selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    await choose('Nhà máy', '41');
    // "Xem chi tiết" should appear once a factory is picked.
    expect(screen.getByRole('button', { name: /Xem chi tiết/ })).toBeTruthy();
    // And "Thêm nhà máy" must still be available so the user can add another
    // factory for the same customer without leaving the form.
    const addButtons = screen.getAllByRole('button', { name: /Thêm nhà máy/ });
    expect(addButtons.length).toBeGreaterThan(0);
    fireEvent.click(addButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhà máy' });
    expect(within(dialog).getByLabelText('Mã điểm vận hành')).toBeTruthy();
    await closeDialog('Thêm nhà máy');
  });
});
