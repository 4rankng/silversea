import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      <Routes>
        <Route path="/clerk/shipments/new" element={<ClerkShipmentCreatePage />} />
        <Route path="/clerk/shipments/:id/docs" element={<div data-testid="dossier" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function choose(label: string, value: string) {
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
}

describe('ClerkShipmentCreatePage', () => {
  beforeEach(() => {
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
    await screen.findByText('Thông tin chung');
    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect(screen.getByRole('alert').textContent).toContain('Vui lòng chọn khách hàng');
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('shows the selected factory rules and Google Maps link without a live map', async () => {
    renderPage();
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    choose('Nhà máy', '41');
    expect(await screen.findByText('Gọi điện trước khi vào')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mở vị trí trên Google Maps/ }).getAttribute('href')).toBe('https://maps.google.com/example');
    expect(screen.queryByText(/theo dõi trực tiếp/i)).toBeNull();
  });

  it('saves an incomplete shipment as DRAFT', async () => {
    renderPage();
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-001' } });
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
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });

    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mất kết nối khi lưu container');

    fireEvent.click(screen.getByRole('button', { name: /Lưu bản nháp/ }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate).toHaveBeenCalledTimes(1);
    expect(mocks.saveContainers.mock.calls[1][0]).toBe(90);
    expect(mocks.saveContainers.mock.calls[1][1]).toMatchObject({ expectedVersion: 1 });
    expect(mocks.saveCarrierAllocations).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dossier')).toBeTruthy();
  });

  it('saves every FCL container then submits the latest shipment version', async () => {
    renderPage();
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    choose('Nhà máy', '41');
    fireEvent.click(screen.getByLabelText('Đóng'));
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-FCL' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    choose('Cảng nâng', '21');
    choose('Cảng hạ', '22');
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));
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
  });

  it('persists corrected container fields before retrying a failed dispatch submit', async () => {
    mocks.submit
      .mockRejectedValueOnce(new Error('Cảng hạ đã ngừng hoạt động'))
      .mockResolvedValueOnce({ shipment: { id: 90 }, handoff: { id: 1, status: 'UNSEEN' }, replayed: false });
    mocks.saveContainers
      .mockResolvedValueOnce({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null })
      .mockResolvedValueOnce({ shipmentVersion: 3, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    renderPage();
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    choose('Nhà máy', '41');
    fireEvent.click(screen.getByLabelText('Đóng'));
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-RETRY' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    choose('Cảng nâng', '21');
    choose('Cảng hạ', '22');
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    choose('Cảng hạ', '21');
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
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    choose('Nhà máy', '41');
    fireEvent.click(screen.getByLabelText('Đóng'));
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-MODE-RETRY' } });
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    choose('Loại container', '31');
    fireEvent.change(screen.getByLabelText('Hãng tàu'), { target: { value: 'MSC' } });
    choose('Cảng nâng', '21');
    choose('Cảng hạ', '22');
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    choose('Loại lô hàng', 'LCL');
    choose('Loại hàng', '32');
    choose('Kho lấy hàng', '42');
    fireEvent.change(screen.getByLabelText('Quy cách đóng gói'), { target: { value: 'Pallet' } });
    fireEvent.change(screen.getByLabelText('Số lượng'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Thể tích (CBM)'), { target: { value: '6.5' } });
    fireEvent.change(screen.getByLabelText('Ngày giao dự kiến'), { target: { value: '2026-08-06' } });
    fireEvent.click(screen.getByRole('button', { name: /Gửi sang điều phối/ }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.quickCreate).toHaveBeenCalledTimes(1);
    expect(mocks.updateShipment).toHaveBeenCalledTimes(1);
    expect(mocks.saveContainers).toHaveBeenCalledTimes(2);
    expect(mocks.saveContainers.mock.calls[1][1]).toEqual({ expectedVersion: 3, containers: [] });
    expect(mocks.submit.mock.calls[1][1]).toMatchObject({ expectedVersion: 4 });
    expect(mocks.submit.mock.calls[1][1]).not.toHaveProperty('carrierAllocations');
    confirm.mockRestore();
  });

  it('submits one LCL fulfillment payload with warehouse, package count, KG and CBM', async () => {
    renderPage();
    await screen.findByText('Thông tin chung');
    choose('Khách hàng', '7');
    choose('Tuyến đường', '11');
    await waitFor(() => expect(mocks.sites).toHaveBeenCalledWith(7));
    choose('Nhà máy', '41');
    fireEvent.click(screen.getByLabelText('Đóng'));
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-LCL' } });
    choose('Loại lô hàng', 'LCL');
    choose('Loại hàng', '32');
    choose('Kho lấy hàng', '42');
    fireEvent.change(screen.getByLabelText('Quy cách đóng gói'), { target: { value: 'Pallet' } });
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
  });
});
