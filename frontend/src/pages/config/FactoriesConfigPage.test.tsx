import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/shared/Toast';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import FactoriesConfigPage from './FactoriesConfigPage';
import * as shipmentClientModule from '../../api/shipmentClient';
import * as configClientModule from '../../api/configClient';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }),
}));

vi.mock('../../api/shipmentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/shipmentClient')>();
  return {
    ...actual,
    listAdminOperationalSites: vi.fn(),
    updateAdminOperationalSite: vi.fn(),
    createOperationalSite: vi.fn(),
  };
});

vi.mock('../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/configClient')>();
  return {
    ...actual,
    configClient: {
      ...actual.configClient,
      getRoutesList: vi.fn(),
      getAllCustomers: vi.fn(),
    },
  };
});

const listMock = vi.mocked(shipmentClientModule.listAdminOperationalSites);
const updateMock = vi.mocked(shipmentClientModule.updateAdminOperationalSite);
const createSiteMock = vi.mocked(shipmentClientModule.createOperationalSite);
const routesMock = vi.mocked(configClientModule.configClient.getRoutesList);
const customersMock = vi.mocked(configClientModule.configClient.getAllCustomers);

const factory = {
  id: 11,
  customerId: 4,
  customerName: 'Khách A',
  code: 'FAC-1',
  name: 'Nhà máy A',
  shortName: 'NM A',
  siteType: 'FACTORY' as const,
  routeId: 7,
  routeName: 'Tuyến Lạch Huyện',
  address: 'KCN Đình Vũ',
  googleMapsUrl: null,
  contactName: 'Anh Tùng',
  contactPhone: '0900000000',
  warehouseContactInfo: null,
  liftInfo: null,
  dropInfo: null,
  cleaningInfo: null,
  liftFeeInvoiceName: null,
  liftFeeInvoiceAddress: null,
  liftFeeTaxCode: null,
  strictRules: null,
  isActive: true,
  version: 3,
};

const warehouse = {
  ...factory,
  id: 12,
  code: 'WH-1',
  name: 'Kho B',
  siteType: 'WAREHOUSE' as const,
  routeId: null,
  routeName: null,
  isActive: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <FactoriesConfigPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([factory, warehouse]);
  updateMock.mockReset();
  createSiteMock.mockReset().mockResolvedValue({ ...factory, id: 99, code: 'NEW-1', name: 'Nhà máy Mới' });
  routesMock.mockReset().mockResolvedValue([{ id: 7, name: 'Tuyến Lạch Huyện' } as never]);
  customersMock.mockReset().mockResolvedValue([{ id: 4, name: 'Khách A' } as never]);
});

describe('FactoriesConfigPage', () => {
  it('lists sites with customer, type, route and status', async () => {
    renderPage();
    expect(await screen.findByText('Nhà máy A')).toBeTruthy();
    // The customer name also appears in the filter dropdown — assert the
    // table cell occurrence (row-scoped) rather than a unique-text query.
    expect(screen.getAllByText('Khách A').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Tuyến Lạch Huyện')).toBeTruthy();
    expect(screen.getByText('Đang dùng')).toBeTruthy();
    expect(screen.getByText('Đã ngưng')).toBeTruthy();
    expect(listMock).toHaveBeenCalledOnce();
  });

  it('explains how to create the first site when the catalog is empty', async () => {
    listMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Dùng nút "Tạo mới" hoặc form nhận lô của CUS/)).toBeTruthy();
  });

  it('creates a site from the toolbar button through the customer-picker dialog', async () => {
    renderPage();
    // The button stays disabled until the customer catalog resolves — the
    // picker cannot work without it.
    const createButton = await screen.findByRole('button', { name: /Tạo mới/ });
    await waitFor(() => expect(createButton).not.toBeDisabled());
    fireEvent.click(createButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhà máy' });

    // The page passes no fixed customer, so the dialog owns the picker.
    fireEvent.click(within(dialog).getByRole('button', { name: /Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Khách A' }));

    fireEvent.change(within(dialog).getByLabelText('Mã điểm vận hành'), { target: { value: 'NEW-1' } });
    fireEvent.change(within(dialog).getByLabelText('Tên đầy đủ'), { target: { value: 'Nhà máy Mới' } });
    fireEvent.change(within(dialog).getByLabelText('Tên ngắn'), { target: { value: 'NM Mới' } });
    fireEvent.change(within(dialog).getByLabelText('Địa chỉ'), { target: { value: 'Hải Phòng' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Tuyến đường/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tuyến Lạch Huyện' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm nhà máy' }));

    await waitFor(() => expect(createSiteMock).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 4,
      code: 'NEW-1',
      siteType: 'FACTORY',
    })));
  });

  it('edits a site through the modal with a version-checked patch', async () => {
    renderPage();
    // Rows are no longer clickable — editing goes through the row-action button.
    fireEvent.click((await screen.findAllByTitle('Sửa điểm vận hành'))[0]);

    // Field labels are not wired with htmlFor — reach the input by value.
    const nameInput = await screen.findByDisplayValue('Nhà máy A');
    fireEvent.change(nameInput, { target: { value: 'Nhà máy A — renamed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledOnce());
    expect(updateMock).toHaveBeenCalledWith(11, expect.objectContaining({
      expectedVersion: 3,
      name: 'Nhà máy A — renamed',
      routeId: 7,
    }));
  });

  it('surfaces the stale-version conflict instead of failing silently', async () => {
    updateMock.mockRejectedValueOnce(new Error('Dữ liệu vừa bị người khác thay đổi. Tải lại trang và thử lại.'));
    renderPage();
    fireEvent.click((await screen.findAllByTitle('Sửa điểm vận hành'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByText(/Dữ liệu vừa bị/i, undefined, { timeout: 3000 })).toBeTruthy();
  });
});
