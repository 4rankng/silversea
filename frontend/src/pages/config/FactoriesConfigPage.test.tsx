import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  };
});

vi.mock('../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/configClient')>();
  return {
    ...actual,
    configClient: {
      ...actual.configClient,
      getRoutesList: vi.fn(),
    },
  };
});

const listMock = vi.mocked(shipmentClientModule.listAdminOperationalSites);
const updateMock = vi.mocked(shipmentClientModule.updateAdminOperationalSite);
const routesMock = vi.mocked(configClientModule.configClient.getRoutesList);

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
  routesMock.mockReset().mockResolvedValue([{ id: 7, name: 'Tuyến Lạch Huyện' } as never]);
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

  it('explains that intake creates sites when the catalog is empty', async () => {
    listMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nhà máy mới được tạo từ form nhận lô hàng của CUS/)).toBeTruthy();
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
