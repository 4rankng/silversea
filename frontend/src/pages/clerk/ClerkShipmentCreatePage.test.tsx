import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  // Customer feedback 2026-09-07 — duplicate Bill/Booking guard. The
  // pre-flight check is debounced, so the mock needs to return a promise
  // that resolves to an empty conflicts array or the form will hang.
  checkDuplicate: vi.fn().mockResolvedValue([]),
  createRoute: vi.fn(),
  createCustomer: vi.fn(),
  createContainerType: vi.fn(),
  createSite: vi.fn(),
}));

vi.mock('../../api/tripClient', () => ({ tripClient: { getBootstrap: mocks.bootstrap } }));

// Prod's CustomerCreateDialog invalidates the catalog blob via useQueryClient
// after creating a customer — renderPage provides a real QueryClientProvider.
// The page's tests render the workspace without a QueryClientProvider; the
// preview card's useQuery would throw — stub the component like the APIs above.
vi.mock('../../features/shipments/create/FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../api/configClient', () => ({
  configClient: {
    createRoute: mocks.createRoute,
    createCustomer: mocks.createCustomer,
    createContainerType: mocks.createContainerType,
  },
}));
vi.mock('../../api/shipmentClient', () => ({
  quickCreateShipment: mocks.quickCreate,
  listOperationalSites: mocks.sites,
  createOperationalSite: mocks.createSite,
  saveShipmentContainers: mocks.saveContainers,
  createShipmentDeclaration: mocks.createDeclaration,
  updateShipmentDeclaration: mocks.updateDeclaration,
  updateShipment: mocks.updateShipment,
  getShipmentDetail: mocks.getShipmentDetail,
  checkShipmentReferenceDuplicate: mocks.checkDuplicate,
}));

vi.mock('../../components/UI', async () => {
  const { createContext } = await import('react');
  return ({
  Modal: ({ isOpen, onClose, title, children, footer }: {
    isOpen: boolean; onClose?: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode;
  }) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}<button type="button" onClick={onClose}>Đóng</button></div> : null,
  Drawer: ({ isOpen, onClose, title, children }: {
    isOpen: boolean; onClose?: () => void; title?: string; children: React.ReactNode;
  }) => isOpen ? <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onClose}>Đóng</button></div> : null,
  ModalCompactContext: createContext(false),
  });
});

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
  { id: 41, customerId: 7, code: 'NM01', name: 'Nhà máy Long Minh', siteType: 'FACTORY', routeId: 11, address: 'Bình Dương', googleMapsUrl: 'https://maps.google.com/example', contactName: 'Anh Nam', contactPhone: '0901000000', liftFeeInvoiceName: 'Long Minh', liftFeeInvoiceAddress: 'Bình Dương', liftFeeTaxCode: '3700000000', strictRules: 'Gọi điện trước khi vào', version: 1 },
  { id: 42, customerId: 7, code: 'KHO01', name: 'Kho Long Minh', siteType: 'WAREHOUSE', routeId: null, address: 'Bình Dương', googleMapsUrl: null, contactName: null, contactPhone: null, liftFeeInvoiceName: null, liftFeeInvoiceAddress: null, liftFeeTaxCode: null, strictRules: null, version: 1 },
];

function renderPage() {
  // CustomerCreateDialog (rendered by this page) reads useQueryClient at
  // mount — the harness needs a provider with fresh per-test caching.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter initialEntries={['/shipments/new']}><QueryClientProvider client={client}><ReducedMotionProvider><ToastProvider><Routes>
    <Route path="/shipments/new" element={<ClerkShipmentCreatePage />} />
    <Route path="/shipments" element={<div data-testid="shipment-list" />} />
  </Routes></ToastProvider></ReducedMotionProvider></QueryClientProvider></MemoryRouter>);
}

async function choose(label: string, value: string) {
  const labelElement = Array.from(document.querySelectorAll('label')).find((element) => element.textContent?.trim().startsWith(label));
  const nativeSelect = labelElement?.parentElement?.querySelector('select');
  if (nativeSelect instanceof HTMLSelectElement) {
    fireEvent.change(nativeSelect, { target: { value } });
    return;
  }
  const selectButton = screen.queryByRole('button', { name: new RegExp(label) });
  if (selectButton) {
    fireEvent.click(selectButton);
    const option = await waitFor(() => {
      const match = document.querySelector<HTMLElement>(`[role="option"][id$="-option-${value}"]`);
      if (!match) throw new Error(`Không tìm thấy lựa chọn ${value} trong trường ${label}`);
      return match;
    });
    fireEvent.click(option);
    await waitFor(() => expect(selectButton).toHaveAttribute('aria-expanded', 'false'));
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
    mocks.createRoute.mockResolvedValue({
      id: 12,
      name: 'Cảng Cái Mép — KCN Mỹ Phước',
      shortName: 'Cái Mép — Mỹ Phước',
      distanceKm: 95,
      isMountain: false,
      fixedFuelAllowance: null,
      tollsStations: null,
      driverSalary: null,
      defaultLegs: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      deletedAt: null,
    });
    mocks.createCustomer.mockResolvedValue({
      id: 8,
      name: 'Công ty TNHH Thương mại Phú Cường',
      shortName: 'Phú Cường',
      taxCode: '0312345678',
      partnerId: null,
      contactPerson: 'Chị Lan',
      phone: '0909123456',
      contactInfo: null,
      creditLimit: null,
      creditWarningThreshold: null,
      paymentTermDays: null,
      fuelSurchargeSharePct: null,
      paymentDatePolicy: 'NEXT_BUSINESS_DAY',
      status: 'ACTIVE',
      isCarrier: false,
      debitNoteMode: 'MONTHLY',
      debitNoteTemplateId: null,
      linkedSupplierId: null,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
      deletedAt: null,
    });
  });

  it('shows only create and cancel actions, without the superseded draft or dispatch actions', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    expect(screen.getByRole('heading', { level: 1, name: 'Tạo lô hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo lô hàng' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lưu bản nháp|Gửi sang điều phối/ })).toBeNull();
  });

  it('uses the approved Vietnamese cargo-mode copy while payloads keep FCL/LCL wire values', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    expect(screen.getByText('Hàng nguyên container (Cont)')).toBeTruthy();
    expect(screen.getByText('Hàng lẻ')).toBeTruthy();
    // No customer-facing FCL/LCL jargon anywhere on the create form.
    expect(screen.queryByText(/FCL|LCL/)).toBeNull();

    await choose('Khách hàng', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalled());
    expect(mocks.quickCreate.mock.calls[0][0].cargoMode).toBe('FCL');
  });

  it('labels notes by recipient and sends driver notes through the canonical API field', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Lịch & ghi chú' });

    fireEvent.change(screen.getByLabelText('Ghi chú cho khách hàng'), { target: { value: 'Khách cần bản scan' } });
    fireEvent.change(screen.getByLabelText('Ghi chú cho lái xe'), { target: { value: 'Gọi bảo vệ trước khi vào' } });
    await choose('Khách hàng', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));

    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({
      customerNotes: 'Khách cần bản scan',
      driverNotes: 'Gọi bảo vệ trước khi vào',
    }), expect.any(String)));
    expect(mocks.quickCreate.mock.calls[0][0]).not.toHaveProperty('operationalNotes');
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

  it('keeps the customer combobox open on focus so typing filters the dropdown', async () => {
    // Spec: the customer field is a proper combobox. Focusing the field
    // pops the overlay (production: openOnPress + menuTrigger=focus);
    // jsdom needs an explicit ArrowDown to drive the keyboard handler
    // the same way. The typed text stays in the input — `form.customerId`
    // only updates when the user actually picks a row.
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const combobox = screen.getByRole('combobox', { name: /^Khách hàng/ }) as HTMLInputElement;
    // Open the popover first (the long-name test covers unfiltered list);
    // here we just confirm the searchable wiring doesn't regress — the
    // overlay still opens on focus + ArrowDown.
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: longCustomerName })).toBeTruthy();
  });

  it('uses an application-styled menu for every shipment-create select', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const tradeDirection = screen.getByRole('button', { name: /Hình thức xuất nhập khẩu/ });
    expect(tradeDirection.tagName).not.toBe('SELECT');
    const accessibilitySelect = tradeDirection.closest('.csc-select-field')?.querySelector('select');
    expect(accessibilitySelect).toHaveAttribute('tabindex', '-1');

    fireEvent.click(tradeDirection);
    expect(tradeDirection).toHaveAttribute('aria-expanded', 'true');
    expect((await screen.findByRole('listbox')).closest('.csc-select-popover')).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: 'Nhập khẩu' }));
    await waitFor(() => expect(tradeDirection).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(tradeDirection).toHaveFocus());

    tradeDirection.focus();
    fireEvent.click(tradeDirection);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(tradeDirection).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(tradeDirection).toHaveFocus());
  });

  it('adds a custom shipping line through the visible add action', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const addButton = screen.getByRole('button', { name: 'Thêm hãng tàu' });
    fireEvent.click(addButton);

    const dialog = await screen.findByRole('dialog', { name: 'Thêm hãng tàu' });
    const nameAction = dialog.querySelector('.csc-shipping-line-dialog__name-action');
    expect(nameAction).toContainElement(within(dialog).getByLabelText('Tên hãng tàu'));
    expect(nameAction).toContainElement(within(dialog).getByRole('button', { name: 'Áp dụng' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Vui lòng nhập tên hãng tàu');

    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: '  Ocean Network Express  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm hãng tàu' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('Ocean Network Express');
    expect(addButton).toHaveFocus();
  });

  it('keeps the current shipping line when the add dialog is cancelled', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const shippingLine = screen.getByRole('combobox', { name: /^Hãng tàu/ });
    fireEvent.change(shippingLine, { target: { value: 'MSC' } });
    const addButton = screen.getByRole('button', { name: 'Thêm hãng tàu' });
    fireEvent.click(addButton);

    const dialog = await screen.findByRole('dialog', { name: 'Thêm hãng tàu' });
    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: 'ONE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm hãng tàu' })).toBeNull());
    expect((shippingLine as HTMLInputElement).value).toBe('MSC');
    expect(addButton).toHaveFocus();
  });

  it('creates and selects a route from the visible shipment-intake action', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await screen.findByRole('heading', { name: 'Điểm vận hành & tuyến' });

    const addButton = screen.getByRole('button', { name: 'Thêm tuyến đường' });
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm tuyến đường' });
    const distanceAction = dialog.querySelector('.route-create-dialog__distance-action');
    expect(distanceAction).toContainElement(within(dialog).getByLabelText('Khoảng cách (km)'));
    expect(distanceAction).toContainElement(within(dialog).getByRole('button', { name: 'Thêm tuyến đường' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm tuyến đường' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Vui lòng nhập tên đầy đủ');

    fireEvent.change(within(dialog).getByLabelText('Tên đầy đủ'), { target: { value: '  Cảng Cái Mép — KCN Mỹ Phước  ' } });
    fireEvent.change(within(dialog).getByLabelText('Tên ngắn'), { target: { value: '  Cái Mép — Mỹ Phước  ' } });
    fireEvent.change(within(dialog).getByLabelText('Khoảng cách (km)'), { target: { value: '95' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm tuyến đường' }));

    await waitFor(() => expect(mocks.createRoute).toHaveBeenCalledWith({
      name: 'Cảng Cái Mép — KCN Mỹ Phước',
      shortName: 'Cái Mép — Mỹ Phước',
      distanceKm: 95,
      isMountain: false,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm tuyến đường' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Tuyến đường/ }) as HTMLInputElement).value).toBe('Cái Mép — Mỹ Phước');
    expect(addButton).toHaveFocus();
  });

  it('keeps the selected route when route creation is cancelled', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await screen.findByRole('heading', { name: 'Điểm vận hành & tuyến' });
    await choose('Tuyến đường', '11');

    const addButton = screen.getByRole('button', { name: 'Thêm tuyến đường' });
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm tuyến đường' });
    fireEvent.change(within(dialog).getByLabelText('Tên đầy đủ'), { target: { value: 'Không lưu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm tuyến đường' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Tuyến đường/ }) as HTMLInputElement).value).toBe('Cát Lái — Sóng Thần');
    expect(mocks.createRoute).not.toHaveBeenCalled();
    expect(addButton).toHaveFocus();
  });

  it('creates and selects a customer from the visible shipment-intake action', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const addButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm khách hàng' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm khách hàng' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Vui lòng nhập tên khách hàng');

    fireEvent.change(within(dialog).getByLabelText('Tên khách hàng'), { target: { value: '  Công ty TNHH Thương mại Phú Cường  ' } });
    fireEvent.change(within(dialog).getByLabelText('Mã số thuế'), { target: { value: '0312345678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm khách hàng' }));

    await waitFor(() => expect(mocks.createCustomer).toHaveBeenCalledWith({
      name: 'Công ty TNHH Thương mại Phú Cường',
      taxCode: '0312345678',
      contactPerson: undefined,
      phone: undefined,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm khách hàng' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Khách hàng/ }) as HTMLInputElement).value).toBe('Công ty TNHH Thương mại Phú Cường');
    expect(addButton).toHaveFocus();
  });

  it('keeps the selected customer when customer creation is cancelled', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');

    const addButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm khách hàng' });
    fireEvent.change(within(dialog).getByLabelText('Tên khách hàng'), { target: { value: 'Không lưu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm khách hàng' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Khách hàng/ }) as HTMLInputElement).value).toBe(longCustomerName);
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(addButton).toHaveFocus();
  });

  it('picks up a customer created elsewhere once the tab regains focus, without a reload', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);

    mocks.bootstrap.mockResolvedValue({
      ...bootstrap,
      customers: [...bootstrap.customers, { id: 8, name: 'Công ty TNHH Thương mại Phú Cường' }],
    });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2));
    const combobox = screen.getByRole('combobox', { name: /^Khách hàng/ });
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'Công ty TNHH Thương mại Phú Cường' })).toBeTruthy();
  });

  it('keeps a locally-created customer when revalidation returns a scoped list without it', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });

    const addButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    fireEvent.click(addButton);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm khách hàng' });
    mocks.createCustomer.mockResolvedValueOnce({
      ...bootstrap.customers[0]!,
      id: 9,
      name: 'Công ty TNHH Chưa Gán Scope',
    });
    fireEvent.change(within(dialog).getByLabelText('Tên khách hàng'), { target: { value: 'Công ty TNHH Chưa Gán Scope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm khách hàng' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm khách hàng' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Khách hàng/ }) as HTMLInputElement).value).toBe('Công ty TNHH Chưa Gán Scope');

    // Clerk-scope bootstrap still lacks the row (an admin has to assign it);
    // revalidation must merge, not replace — the selected value may not be
    // yanked out from under the form.
    mocks.bootstrap.mockResolvedValue(bootstrap);
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledTimes(2));
    expect((screen.getByRole('combobox', { name: /^Khách hàng/ }) as HTMLInputElement).value).toBe('Công ty TNHH Chưa Gán Scope');
    const combobox = screen.getByRole('combobox', { name: /^Khách hàng/ });
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'Công ty TNHH Chưa Gán Scope' })).toBeTruthy();
  });

  it('requires a customer before creating a shipment', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    const customer = screen.getByRole('combobox', { name: /^Khách hàng/ });
    await waitFor(() => expect(customer).toHaveFocus());
    expect(customer).toHaveAttribute('aria-invalid', 'true');
    // Focusing the invalid customer opens its options and temporarily hides
    // sibling regions from assistive technology. Dismiss it to read the summary.
    fireEvent.keyDown(customer, { key: 'Escape' });
    expect((await screen.findByRole('alert')).textContent).toContain('Chọn khách hàng để tạo lô hàng');
    expect(mocks.quickCreate).not.toHaveBeenCalled();
  });

  it('creates a customer-only shipment without a manual dispatch request', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7, cargoMode: 'FCL' }), expect.any(String)));
    expect(await screen.findByTestId('shipment-list')).toBeTruthy();
  });

  it('VID-CUS-04: creates the initial declaration atomically without a second declaration write', async () => {
    mocks.quickCreate.mockResolvedValue({ id: 90, version: 1, initialDeclarationId: 77 });
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByRole('textbox', { name: 'Số tờ khai' }), { target: { value: 'TK-ATOMIC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({ declarationNumber: 'TK-ATOMIC' }), expect.any(String)));
    expect(await screen.findByTestId('shipment-list')).toBeTruthy();
    expect(mocks.createDeclaration).not.toHaveBeenCalled();
    expect(mocks.updateDeclaration).not.toHaveBeenCalled();
  });

  it('hides the FCL volume field and copies the previous container when adding a row', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    expect(screen.queryByLabelText('Thể tích (m³)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'MSCU6639870' } });
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Ngày — Ngày giờ đóng trả'), { target: { value: '20/08/2026' } });

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));

    expect(screen.getAllByLabelText('Số container').map((field) => (field as HTMLInputElement).value)).toEqual(['MSCU6639870', '']);
    expect(screen.getAllByLabelText('Trọng lượng (kg)').map((field) => (field as HTMLInputElement).value)).toEqual(['12000', '12000']);
    expect(screen.getAllByLabelText('Giờ — Ngày giờ đóng trả').map((field) => (field as HTMLInputElement).value)).toEqual(['09:30', '09:30']);
    expect(screen.getAllByLabelText('Ngày — Ngày giờ đóng trả').map((field) => (field as HTMLInputElement).value)).toEqual(['20/08/2026', '20/08/2026']);
  });

  it('removes the FCL shipment-level factory/route section and keeps each container route independent', async () => {
    mocks.bootstrap.mockResolvedValue({
      ...bootstrap,
      routes: [...bootstrap.routes, { id: 12, name: 'Cái Mép — Mỹ Phước' }],
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    expect(screen.queryByRole('heading', { name: 'Điểm vận hành & tuyến' })).toBeNull();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toContain('Tuyến đường');
    await choose('Khách hàng', '7');
    await choose('Tuyến đường', '12');
    await choose('Nhà máy', '41');
    // MasterDataNhaMay §3.2: the factory owns the route — choosing nhà máy 41
    // (routeId 11) overrides the manual route-12 pick and locks the cell to
    // the factory's configured route.
    expect(screen.getByText('Cát Lái — Sóng Thần', { selector: '.csc-container-cell__display' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: null, operationalSiteId: null }),
      expect.any(String),
    ));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [expect.objectContaining({ routeId: 11, operationalSiteId: 41 })],
    })));
  });

  it('TC-CUS-FACTORY-SEARCH-02 searches the factory code and saves the selected factory ID', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    await choose('Khách hàng', '7');
    const factory = screen.getByRole('combobox', { name: 'Nhà máy' });
    fireEvent.focus(factory);
    fireEvent.keyDown(factory, { key: 'ArrowDown' });
    fireEvent.change(factory, { target: { value: '  nm01  ' } });
    const option = await screen.findByRole('option', { name: /Nhà máy Long Minh/ });
    // The code still MATCHES the query but is no longer rendered in the option:
    // the search chain bloated every row of the dropdown (20260917_13).
    expect(option).not.toHaveTextContent('NM01');
    expect(factory).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [expect.objectContaining({ operationalSiteId: 41, routeId: 11 })],
    })));
  });

  it('TC-CUS-FACTORY-SEARCH-05 clears each previous factory and its derived route when customer changes', async () => {
    mocks.bootstrap.mockResolvedValue({
      ...bootstrap,
      customers: [...bootstrap.customers, { id: 8, name: 'Khách hàng khác' }],
    });
    mocks.sites.mockImplementation((id: number) => Promise.resolve(id === 7 ? sites : []));
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    await choose('Khách hàng', '7');
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(screen.getAllByRole('combobox', { name: 'Nhà máy' })).toHaveLength(2);
    await choose('Khách hàng', '8');
    for (const factory of screen.getAllByRole('combobox', { name: 'Nhà máy' })) {
      expect(factory).toHaveValue('');
    }
    for (const route of screen.getAllByRole('combobox', { name: 'Tuyến đường' })) {
      expect(route).toHaveValue('');
      expect(route).not.toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [
        expect.objectContaining({ operationalSiteId: null, routeId: null }),
        expect.objectContaining({ operationalSiteId: null, routeId: null }),
      ],
    })));
  });

  it('TC-CUS-FACTORY-SEARCH-07 preserves the factory catalog and selection when the same customer is selected again', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    await choose('Khách hàng', '7');
    await choose('Nhà máy', '41');
    await choose('Khách hàng', '7');

    const factory = screen.getByRole('combobox', { name: /^Nhà máy/ });
    expect(factory).toHaveValue('Nhà máy Long Minh');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toBeDisabled();
    // Reopen and select again to prove the catalog still exists, rather
    // than only asserting a stale selected label that survives an empty list.
    await choose('Nhà máy', '41');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [expect.objectContaining({ operationalSiteId: 41, routeId: 11 })],
    })));
  });

  it('TC-CUS-FACTORY-SEARCH-08 clears the LCL factory-derived route when customer changes', async () => {
    mocks.bootstrap.mockResolvedValue({
      ...bootstrap,
      customers: [...bootstrap.customers, { id: 8, name: 'Khách hàng khác' }],
    });
    mocks.sites.mockImplementation((id: number) => Promise.resolve(id === 7 ? sites : []));
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await choose('Khách hàng', '7');
    await choose('Nhà máy', '41');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toHaveValue('Cát Lái — Sóng Thần');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toBeDisabled();

    await choose('Khách hàng', '8');
    expect(screen.getByRole('combobox', { name: /^Nhà máy/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 8, cargoMode: 'LCL', operationalSiteId: null, routeId: null,
    }), expect.any(String)));
  });

  it.each(['FCL', 'LCL'])('TC-CUS-FACTORY-SEARCH-08 preserves a manually selected %s route when customer changes', async (mode) => {
    mocks.bootstrap.mockResolvedValue({
      ...bootstrap,
      customers: [...bootstrap.customers, { id: 8, name: 'Khách hàng khác' }],
      routes: [...bootstrap.routes, { id: 12, name: 'Cái Mép — Mỹ Phước' }],
    });
    mocks.sites.mockImplementation((id: number) => Promise.resolve(id === 7
      ? [{ ...sites[0], routeId: null }]
      : []));
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    if (mode === 'LCL') fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await choose('Khách hàng', '7');
    await choose('Nhà máy', '41');
    await choose('Tuyến đường', '12');

    await choose('Khách hàng', '8');
    expect(screen.getByRole('combobox', { name: /^Nhà máy/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toHaveValue('Cái Mép — Mỹ Phước');
    expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    if (mode === 'LCL') {
      await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledWith(expect.objectContaining({
        customerId: 8, operationalSiteId: null, routeId: 12,
      }), expect.any(String)));
    } else {
      await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
        containers: [expect.objectContaining({ operationalSiteId: null, routeId: 12 })],
      })));
    }
  });

  it('shows a resting container value as table text and activates its editor from the full cell', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    const input = screen.getByLabelText('Số container') as HTMLInputElement;
    const cell = input.closest('td');
    expect(cell).not.toBeNull();
    expect(within(cell!).getByText('Nhập số container')).toBeTruthy();

    fireEvent.click(cell!);
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    fireEvent.blur(input);
    expect(within(cell!).getByText('MSCU6639870')).toBeTruthy();
  });

  it('restores the value that a container text cell had when Escape cancels editing', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    const input = screen.getByLabelText('Số container') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    fireEvent.blur(input);

    act(() => input.focus());
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'MSCU0000000' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('MSCU6639870');
    expect(input).not.toHaveFocus();
  });

  it('commits a container text cell and returns to display mode on Enter', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    const input = screen.getByLabelText('Số container') as HTMLInputElement;
    const cell = input.closest('td');
    act(() => input.focus());
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'MSCU6639870' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('MSCU6639870');
    expect(input).not.toHaveFocus();
    expect(within(cell!).getByText('MSCU6639870')).toBeTruthy();
  });

  it('renders every populated container field as a compact localized table value', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    await choose('Khách hàng', '7');
    await choose('Loại container', '31');
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    const row = within(table).getAllByRole('row')[1];
    const factory = within(row).getByRole('combobox', { name: 'Nhà máy' });
    fireEvent.focus(factory);
    fireEvent.keyDown(factory, { key: 'ArrowDown' });
    const factoryOption = await waitFor(() => {
      const match = document.querySelector<HTMLElement>('[role="option"][id$="-option-41"]');
      if (!match) throw new Error('Không tìm thấy nhà máy 41');
      return match;
    });
    fireEvent.click(factoryOption);
    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000.5' } });
    fireEvent.change(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Ngày — Ngày giờ đóng trả'), { target: { value: '20/08/2026' } });
    fireEvent.blur(screen.getByLabelText('Ngày — Ngày giờ đóng trả'));

    const displayedValue = (text: string) => within(row).getByText(text, { selector: '.csc-container-cell__display' });
    expect(displayedValue('40HC')).toHaveAttribute('title', '40HC — Container 40 feet cao');
    expect(displayedValue('Cảng Cát Lái')).toBeTruthy();
    expect(displayedValue('Cảng ICD Sóng Thần')).toBeTruthy();
    expect(displayedValue('Nhà máy Long Minh')).toBeTruthy();
    expect(displayedValue('12.000,5')).toBeTruthy();
    expect(screen.getByLabelText('Giờ — Ngày giờ đóng trả')).toHaveValue('09:30');
    expect(screen.getByLabelText('Ngày — Ngày giờ đóng trả')).toHaveValue('20/08/2026');
    expect(screen.getByLabelText('Giờ — Ngày giờ đóng trả').closest('td')).toHaveClass('csc-container-cell--persistent');
  });

  it('shows each container type code once in the selector', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    // Loại container is a SearchableField (combobox) since 2026-09-06 so the
    // catalog can be extended inline from the create-shipment form.
    const combobox = screen.getByRole('combobox', { name: /Loại container/ });
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    const option = await waitFor(() => {
      const match = document.querySelector<HTMLElement>('[role="option"][id$="-option-31"]');
      if (!match) throw new Error('Không tìm thấy loại container 31');
      return match;
    });

    expect(option).toHaveTextContent('40HC');
    expect(option).not.toHaveTextContent('Container 40 feet cao');
    expect(option.textContent?.match(/40HC/g)).toHaveLength(1);
  });

  it('adds the requested number of container rows with a default of one', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Ngày — Ngày giờ đóng trả'), { target: { value: '20/08/2026' } });

    const addCount = screen.getByRole('spinbutton', { name: 'Số container cần thêm' });
    expect((addCount as HTMLInputElement).value).toBe('1');
    fireEvent.change(addCount, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));

    expect(screen.getAllByLabelText('Số container')).toHaveLength(4);
    expect(screen.getAllByLabelText('Trọng lượng (kg)').map((field) => (field as HTMLInputElement).value)).toEqual(['12000', '12000', '12000', '12000']);
    expect(screen.getAllByLabelText('Giờ — Ngày giờ đóng trả').map((field) => (field as HTMLInputElement).value)).toEqual(['09:30', '09:30', '09:30', '09:30']);
    expect(screen.getAllByLabelText('Ngày — Ngày giờ đóng trả').map((field) => (field as HTMLInputElement).value)).toEqual(Array(4).fill('20/08/2026'));

    fireEvent.change(addCount, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Thêm container' })).toBeDisabled();
  });

  // TC-CUS-CREATE-019: Quy cách đóng gói is a free-text field after the
  // 2026-09-06 customer request — not a hardcoded {Pallet, Roll, Carton}
  // dropdown. Pin both the LCL visibility and the wire payload below.
  it('exposes Quy cách đóng gói as a free-text input on the LCL form', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Hình thức xuất nhập khẩu', 'IMPORT');
    fireEvent.change(screen.getByLabelText(/^Số Bill\/Booking/), { target: { value: 'BL-LCL-FREE' } });

    // Switch to LCL so the Quy cách field appears (it lives in the LCL form).
    fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await screen.findByRole('heading', { name: 'Điểm vận hành & tuyến' });

    const packageType = screen.getByLabelText('Quy cách đóng gói');
    expect(packageType.tagName).toBe('INPUT');
    expect((packageType as HTMLInputElement).type).toBe('text');
    // No leftover hardcoded option list — the field is plain text.
    expect(packageType.getAttribute('role')).not.toBe('combobox');
    expect(packageType.getAttribute('aria-haspopup')).toBeNull();

    // Free text accepts any value the customer has on their shipping line.
    fireEvent.change(packageType, { target: { value: 'Thùng carton 5 lớp' } });
    expect((packageType as HTMLInputElement).value).toBe('Thùng carton 5 lớp');
  });

  // TC-CUS-CREATE-020: Loại container gets a "+ Thêm" sibling so CUS can
  // extend the container-type catalog inline from the create-shipment form
  // without bouncing out to /config/container-types.
  it('creates a new container type from the FCL cell add button and selects it into the row', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    // Find the Loại container cell, then its sibling "Thêm" button.
    const typeCell = screen.getByRole('combobox', { name: /Loại container/ }).closest('td')!;
    const addButton = within(typeCell as HTMLElement).getByRole('button', { name: 'Thêm loại container' });
    fireEvent.click(addButton);

    const dialog = await screen.findByRole('dialog', { name: 'Thêm loại container' });

    // react-aria in jsdom can produce label/input id mismatches that defeat
    // getByLabelText inside a custom Modal mock. Target the input by walking
    // the label's `for` attribute instead — that path is stable. We match
    // the label text by prefix because required fields append a "*" marker
    // inside an aria-hidden span.
    function setFieldByLabel(container: HTMLElement, labelText: string, value: string) {
      const label = Array.from(container.querySelectorAll('label')).find((el) => el.textContent?.trim().startsWith(labelText));
      if (!label) throw new Error(`Không tìm thấy label "${labelText}"`);
      const id = label.getAttribute('for');
      const input = id ? document.getElementById(id) : null;
      if (!input) throw new Error(`Không tìm thấy input cho label "${labelText}"`);
      fireEvent.change(input, { target: { value } });
    }
    setFieldByLabel(dialog, 'Mã loại container', '45HC');
    setFieldByLabel(dialog, 'Tên loại container', "Container 45' High Cube");

    mocks.createContainerType.mockResolvedValueOnce({
      id: 99,
      code: '45HC',
      name: "Container 45' High Cube",
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm loại container' }));

    await waitFor(() => expect(mocks.createContainerType).toHaveBeenCalledWith({
      code: '45HC',
      name: "Container 45' High Cube",
      notes: undefined,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm loại container' })).toBeNull());

    // The new row is auto-selected into the cell that asked for it.
    const typeCombobox = screen.getByRole('combobox', { name: /Loại container/ }) as HTMLInputElement;
    expect(typeCombobox.value).toBe('45HC');
  });

  it('uses the container records as the only FCL quantity control', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    expect(screen.queryByLabelText('Số lượng cont')).toBeNull();
    const table = screen.getByRole('table', { name: 'Danh sách container' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'STT',
      'Số container',
      'Loại container',
      'Nhà máy',
      'Tuyến đường',
      'Cảng nâng',
      'Cảng hạ',
      'Trọng lượng (kg)',
      'Ngày giờ đóng trả',
      'Thao tác',
    ]);
    expect(screen.getAllByLabelText('Số container')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(screen.getAllByLabelText('Số container')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('confirms before deleting a populated container record', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });

    fireEvent.change(screen.getByLabelText('Trọng lượng (kg)'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));

    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 2' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xóa container?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(screen.getAllByLabelText('Số container')).toHaveLength(2);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xóa container?' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 2' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Xóa container?' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Xóa container' }));
    expect(screen.getAllByLabelText('Số container')).toHaveLength(1);
  });

  it('refuses a partially typed appointment instead of submitting an undated or old value', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    fireEvent.change(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { target: { value: '13:3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    expect(mocks.quickCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Giờ — Ngày giờ đóng trả')).toHaveValue('13:3');
    expect(screen.getByLabelText('Giờ — Ngày giờ đóng trả')).toBeInvalid();
  });

  it('persists an FCL appointment as the shipment dispatch-date authority', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Hình thức xuất nhập khẩu', 'IMPORT');
    await choose('Nhà máy', '41');
    fireEvent.change(screen.getByLabelText(/^Số Bill\/Booking/), { target: { value: 'BL-FCL' } });
    await choose('Loại container', '31');
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    fireEvent.change(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Ngày — Ngày giờ đóng trả'), { target: { value: '15/08/2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({
      containers: [expect.objectContaining({
        containerNumber: null,
        customerAppointmentAt: '2026-08-15T09:30:00+07:00',
      })],
    })));
    expect(mocks.quickCreate.mock.calls[0][0]).toMatchObject({ tradeDirection: 'IMPORT' });
    expect(mocks.quickCreate.mock.calls[0][0].expectedDeliveryDate).toBeUndefined();
    expect(await screen.findByTestId('shipment-list')).toBeTruthy();
  });

  it.each([false, true])('VID-CUS-SELECT-02 saves cleared or replacement IDs without stale selections (replace=%s)', async (replace) => {
    mocks.bootstrap.mockResolvedValue({ ...bootstrap, routes: [...bootstrap.routes, { id: 12, name: 'Tuyến thay thế' }], ports: [...bootstrap.ports, { id: 23, name: 'Cảng nâng thay thế' }, { id: 24, name: 'Cảng hạ thay thế' }] });
    mocks.sites.mockResolvedValue([...sites, { ...sites[0], id: 43, name: 'Nhà máy thay thế', routeId: null }]);
    renderPage();
    await screen.findByRole('heading', { name: 'Nhận diện lô' });
    await choose('Khách hàng', '7');
    await choose('Hình thức xuất nhập khẩu', 'IMPORT');
    fireEvent.change(screen.getByLabelText(/^Số Bill\/Booking/), { target: { value: 'BL-REPLACE-CATALOG' } });
    await choose('Loại container', '31');
    await choose('Nhà máy', '41');
    expect(screen.getByRole('combobox', { name: 'Tuyến đường' })).toBeDisabled();
    await choose('Cảng nâng', '21');
    await choose('Cảng hạ', '22');
    for (const label of ['Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ']) {
      const field = screen.getByRole('combobox', { name: label });
      fireEvent.change(field, { target: { value: '' } });
      fireEvent.blur(field);
      expect(field).toHaveValue('');
    }
    expect(screen.getByRole('combobox', { name: 'Tuyến đường' })).not.toBeDisabled();
    if (replace) {
      for (const [label, id] of [['Nhà máy', '43'], ['Tuyến đường', '12'], ['Cảng nâng', '23'], ['Cảng hạ', '24']]) {
        fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: 'thay thế' } });
        await choose(label, id);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    const expected = replace
      ? { operationalSiteId: 43, routeId: 12, pickupPortId: 23, dropoffPortId: 24 }
      : { operationalSiteId: null, routeId: null, pickupPortId: null, dropoffPortId: null };
    await waitFor(() => expect(mocks.saveContainers).toHaveBeenCalledWith(90, expect.objectContaining({ containers: [expect.objectContaining(expected)] })));
    expect(await screen.findByTestId('shipment-list')).toBeTruthy();
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

  it.each([
    { mode: 'FCL', siteType: 'FACTORY', label: 'Nhà máy', action: 'Thêm nhà máy' },
    { mode: 'LCL', siteType: 'FACTORY', label: 'Nhà máy', action: 'Thêm nhà máy' },
    { mode: 'LCL', siteType: 'WAREHOUSE', label: 'Kho lấy hàng', action: 'Thêm kho' },
  ])('TC-CUS-FACTORY-SEARCH-09 immediately selects a created $mode $siteType before catalog reload', async ({ mode, siteType, label, action }) => {
    const created = { ...sites[0], id: 43, code: 'NEW43', name: 'Điểm vận hành mới', shortName: 'Điểm mới', siteType, routeId: siteType === 'FACTORY' ? 11 : null };
    mocks.createSite.mockResolvedValue(created);
    mocks.sites.mockResolvedValueOnce(sites).mockImplementation(() => new Promise(() => {}));
    renderPage();
    await screen.findByRole('heading', { name: 'Thông tin hàng' });
    if (mode === 'LCL') fireEvent.click(screen.getByRole('radio', { name: 'Hàng lẻ' }));
    await choose('Khách hàng', '7');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${action}`) }));
    const dialog = await screen.findByRole('dialog', { name: new RegExp(`^${action}`) });
    fireEvent.change(within(dialog).getByLabelText('Mã điểm vận hành'), { target: { value: created.code } });
    fireEvent.change(within(dialog).getByLabelText('Tên đầy đủ'), { target: { value: created.name } });
    fireEvent.change(within(dialog).getByLabelText('Tên ngắn'), { target: { value: created.shortName } });
    fireEvent.change(within(dialog).getByLabelText('Địa chỉ'), { target: { value: created.address } });
    if (siteType === 'FACTORY') {
      fireEvent.click(within(dialog).getByRole('button', { name: /Tuyến đường/ }));
      fireEvent.click(await screen.findByRole('option', { name: 'Cát Lái — Sóng Thần' }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: action }));
    await waitFor(() => expect(mocks.createSite).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7, siteType })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('combobox', { name: new RegExp(`^${label}`) })).toHaveValue(created.shortName);
    if (siteType === 'FACTORY') {
      expect(screen.getByRole('combobox', { name: /^Tuyến đường/ })).toHaveValue('Cát Lái — Sóng Thần');
    }
  });
});
