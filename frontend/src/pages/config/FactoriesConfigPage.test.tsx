import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  it('shows address and named phone values directly and edits the default contact list', { timeout: 15000 }, async () => {
    const contacts = [{ name: 'Cổng kho', phone: '0901234567', isDefault: true }, { name: 'Điều phối', phone: '0907654321', isDefault: false }];
    listMock.mockResolvedValue([{ ...factory, contacts }]);
    renderPage();
    await screen.findByText('Nhà máy A');
    expect(screen.getByText('KCN Đình Vũ')).toBeVisible();
    expect(screen.getByText('0907654321')).toBeVisible();
    expect(document.querySelector('.factory-record-details details')).toBeNull();
    fireEvent.click(screen.getByTitle('Sửa điểm vận hành'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tên liên hệ 2' }), { target: { value: 'Điều phối mới' } });
    fireEvent.click(within(dialog).getAllByRole('radio')[1]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa liên hệ 1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledOnce());
    expect(updateMock).toHaveBeenCalledWith(11, expect.objectContaining({ contacts: [{ name: 'Điều phối mới', phone: '0907654321', isDefault: true }] }));
  });

  it('preserves a legacy named contact with no phone on unrelated metadata edits', async () => {
    listMock.mockResolvedValue([{ ...factory, contactPhone: null, contacts: [] }]);
    renderPage();
    await screen.findByText('Nhà máy A');
    expect(screen.getByText('Anh Tùng · Chưa có số điện thoại')).toBeVisible();
    fireEvent.click(screen.getByTitle('Sửa điểm vận hành'));
    fireEvent.change(await screen.findByDisplayValue('Nhà máy A'), { target: { value: 'Nhà máy A sửa tên' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledOnce());
    expect(updateMock.mock.calls[0][1]).not.toHaveProperty('contacts');
    expect(updateMock.mock.calls[0][1].contactName).toBe('Anh Tùng');
  });

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

  it('matches Vietnamese terms without accents and recovers from no results', async () => {
    renderPage();
    await screen.findByText('Nhà máy A');
    const input = screen.getByRole('textbox', { name: 'Tìm nhà máy / kho' });
    for (const query of ['nha may', '  NHA   MAY  ', 'nha may dinh vu', 'FAC-1']) {
      fireEvent.change(input, { target: { value: query } });
      expect(screen.getByText('Nhà máy A')).toBeInTheDocument();
      expect(screen.queryByText('Kho B')).not.toBeInTheDocument();
    }
    fireEvent.change(input, { target: { value: 'no matching site' } });
    expect(screen.getByText(/Không tìm thấy nhà máy/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Nhà máy A')).toBeInTheDocument();
    expect(screen.getByText('Kho B')).toBeInTheDocument();
  });

  // Card 20260930_237: the customer-picker dialog chain (toolbar button →
  // dialog → combobox → submit) flakes at 5.1-6.9s in full runs on a loaded
  // box — deterministically over the 5s default while scoped it passes in
  // ~1.2s. Explicit 15s contract, the house drawer-interaction deadline.
  it('creates a site from the toolbar button through the customer-picker dialog', { timeout: 15000 }, async () => {
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
      contacts: [expect.objectContaining({ phone: factory.contactPhone })],
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

describe('FactoriesConfigPage filter strip', () => {
  it('renders the shared bar with the search slot, the customer criterion and the create action', async () => {
    const { container } = renderPage();
    await screen.findByText('Nhà máy A');

    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The page-local toolbar row is gone: the bar owns the strip.
    expect(container.querySelector('.toolbar')).toBeNull();

    const input = within(bar).getByRole('textbox', { name: 'Tìm nhà máy / kho' });
    expect(input.getAttribute('placeholder')).toBe('Tìm theo mã, tên, địa chỉ…');

    // Khách hàng is the surface's one secondary criterion; at the jsdom width
    // the measured ladder renders it inline inside the bar.
    const select = bar.querySelector('.ds-uui-select') as HTMLElement;
    expect(select).not.toBeNull();
    expect(select.textContent).toContain('Khách hàng');

    expect(within(bar).getByRole('button', { name: /Tạo mới/ })).toBeInTheDocument();
    expect(bar.querySelector('.cfg-page__summary')?.textContent).toContain('2 mục');
  });

  it('keeps the toolbar layout out of the page source', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/config/FactoriesConfigPage.tsx'), 'utf8');
    expect(source).toContain("import { FilterBar } from '../../design-system';");
    expect(source).toContain('<FilterBar');
    expect(source).not.toContain('className="toolbar"');
    // No page-declared control width or stretch spacer survives.
    expect(source).not.toContain('maxWidth: 280');
    expect(source).not.toContain('maxWidth: 240');
    expect(source).not.toContain("style={{ flex: 1 }}");
  });
});
