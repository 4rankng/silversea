import { configure, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  quickCreate: vi.fn(),
  sites: vi.fn(),
  sharedWarehouseSites: vi.fn(),
  saveContainers: vi.fn(),
  updateShipment: vi.fn(),
  getShipmentDetail: vi.fn(),
  // The as-you-type duplicate lookup is debounced and promise-based — it
  // must always resolve or every keystroke chain hangs.
  checkDuplicate: vi.fn().mockResolvedValue([]),
  createShippingLine: vi.fn(async (name: string) => ({ id: 9, name, created: true })),
}));

vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap: mocks.bootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  quickCreateShipment: mocks.quickCreate,
  listOperationalSites: mocks.sites,
  listSharedWarehouseSites: mocks.sharedWarehouseSites,
  saveShipmentContainers: mocks.saveContainers,
  updateShipment: mocks.updateShipment,
  getShipmentDetail: mocks.getShipmentDetail,
  createShippingLine: mocks.createShippingLine,
}));
vi.mock('../../../api/shipmentDuplicateClient', () => ({
  checkShipmentReferenceDuplicate: mocks.checkDuplicate,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

const FCL_DRAFT_KEY = 'sil.shipment-create-draft.v1:FCL';
const LCL_DRAFT_KEY = 'sil.shipment-create-draft.v1:LCL';
const RESTORABLE_KEY = 'sil.shipment-create-draft.v1:restorable';

const bootstrap = {
  customers: [{ id: 7, name: 'KH A' }],
  routes: [{ id: 11, name: 'Cát Lái — Sóng Thần' }],
  ports: [{ id: 21, name: 'Cảng Cát Lái' }],
  containerTypes: [{ id: 31, code: '40HC', name: 'Container 40 feet cao' }],
  cargoTypes: [{ id: 32, code: 'LCL', name: 'Hàng lẻ' }],
  externalCarriers: [],
};

/** The QA repro surface: the app sidebar navigates through
 *  requestAppNavigation; a plain router Link exercises the guard's link
 *  layer the same way (intercept → ask → proceed or stay). */
function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/shipments', '/shipments/new']}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <nav><Link to="/elsewhere">Tổng quan lô hàng</Link></nav>
          <Routes>
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
            <Route path="/shipments/new" element={<ShipmentCreateWorkspace />} />
            <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
            <Route path="/elsewhere" element={<div data-testid="elsewhere" />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The direction field is a house RAC select: its hidden native select does
 *  not carry the option list until the popover opens, so the tests drive it
 *  through the same trigger → option flow the page harness uses. */
async function chooseImportDirection() {
  const trigger = screen
    .getAllByRole('button', { name: /Hình thức xuất nhập khẩu/ })
    .find((button) => button.getAttribute('aria-haspopup') === 'listbox');
  fireEvent.click(trigger!);
  const option = await waitFor(() => {
    const match = document.querySelector<HTMLElement>('[role="option"][id$="-option-IMPORT"]');
    if (!match) throw new Error('Không tìm thấy lựa chọn Nhập khẩu');
    return match;
  });
  fireEvent.click(option);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
}

async function typeImportBill(value: string) {
  await chooseImportDirection();
  const bill = screen.getByLabelText(/^Số Bill\/Booking/) as HTMLInputElement;
  fireEvent.change(bill, { target: { value } });
  return bill;
}

function seedDraft(key: string, form: Record<string, unknown>, savedAt: number) {
  window.sessionStorage.setItem(key, JSON.stringify({
    v: 1,
    savedAt,
    form: { cargoMode: key.endsWith('FCL') ? 'FCL' : 'LCL', ...form },
    containers: [],
    customerNotes: '',
  }));
}

// The debounce (300ms) and the heavy workspace import chain need the house
// async budget (card 2026-09-30_237 idiom).
configure({ asyncUtilTimeout: 15000 });

describe('ShipmentCreateWorkspace leave guard + sessionStorage draft (UX-03)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    window.sessionStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.bootstrap.mockResolvedValue(bootstrap);
    mocks.sites.mockResolvedValue([]);
    mocks.sharedWarehouseSites.mockResolvedValue([]);
    mocks.quickCreate.mockResolvedValue({ id: 90, version: 1 });
    mocks.saveContainers.mockResolvedValue({ shipmentVersion: 2, items: [], upsertedIds: [], changeMode: 'DIRECT', changeRequestId: null });
    mocks.updateShipment.mockResolvedValue({ id: 90, version: 2 });
    mocks.getShipmentDetail.mockResolvedValue({ shipment: { id: 90, version: 1 } });
    mocks.checkDuplicate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it('a dirty form intercepts a sidebar navigation with the draft dialog and Keep editing preserves the fields', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    const bill = await typeImportBill('QA-S6-DRAFT-UX');

    fireEvent.click(screen.getByRole('link', { name: 'Tổng quan lô hàng' }));

    // The three-way ask: Keep editing / Lưu nháp / discard — the QA ask.
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ tạo lô hàng?' });
    expect(within(dialog).getByRole('button', { name: 'Tiếp tục nhập' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Lưu nháp' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Bỏ thay đổi và rời trang' })).toBeTruthy();
    expect(screen.queryByTestId('elsewhere')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục nhập' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bỏ tạo lô hàng?' })).toBeNull());
    // Resume keeps everything typed, including the derived direction gate
    // (the bill field stays enabled, and its Nhập-phased placeholder proves
    // the restored Hình thức XNK drives it).
    expect(bill.value).toBe('QA-S6-DRAFT-UX');
    expect(bill).not.toBeDisabled();
    expect(bill).toHaveAttribute('placeholder', 'Nhập số Bill (hàng Nhập)');
  });

  it('discarding from the dialog navigates on and clears the stored draft', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    await typeImportBill('QA-S6-DRAFT-UX');
    await waitFor(() => expect(window.sessionStorage.getItem(LCL_DRAFT_KEY)).toContain('QA-S6-DRAFT-UX'));

    fireEvent.click(screen.getByRole('link', { name: 'Tổng quan lô hàng' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ tạo lô hàng?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ thay đổi và rời trang' }));

    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeTruthy());
    expect(window.sessionStorage.getItem(LCL_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBeNull();
  });

  it('a pristine form navigates directly — no dialog, no stored draft', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('link', { name: 'Tổng quan lô hàng' }));

    expect(await screen.findByTestId('elsewhere')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bỏ tạo lô hàng?' })).toBeNull();
    expect(window.sessionStorage.getItem(FCL_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LCL_DRAFT_KEY)).toBeNull();
  });

  it('a successful draft save clears the guard and the storage, landing on the created lot', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await typeImportBill('QA-S6-DRAFT-UX');
    await waitFor(() => expect(window.sessionStorage.getItem(FCL_DRAFT_KEY)).toContain('QA-S6-DRAFT-UX'));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(mocks.quickCreate).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('shipment-detail')).toBeTruthy();
    expect(window.sessionStorage.getItem(FCL_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LCL_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBeNull();
  });

  it('refresh restores the FCL draft with the direction gate rebuilt', async () => {
    seedDraft(FCL_DRAFT_KEY, { tradeDirection: 'IMPORT', blNumber: 'QA-S6-DRAFT-UX' }, 1000);
    window.sessionStorage.setItem(RESTORABLE_KEY, '1');

    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // The gate is the observable: the restored Hình thức XNK re-enables the
    // bill field (the QA defect was a disabled field until a re-pick).
    const bill = screen.getByLabelText(/^Số Bill\/Booking/) as HTMLInputElement;
    expect(bill.value).toBe('QA-S6-DRAFT-UX');
    expect(bill).not.toBeDisabled();
    expect(bill).toHaveAttribute('placeholder', 'Nhập số Bill (hàng Nhập)');
    // The marker is one-shot: the restored session re-arms it only through a
    // fresh beforeunload.
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBeNull();
  });

  it('the newest mode key wins — a fresher LCL draft restores into the LCL form', async () => {
    seedDraft(FCL_DRAFT_KEY, { blNumber: 'OLD-FCL' }, 1000);
    seedDraft(LCL_DRAFT_KEY, { tradeDirection: 'EXPORT', bookingRef: 'BK-GUARD' }, 2000);
    window.sessionStorage.setItem(RESTORABLE_KEY, '1');

    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(screen.getByRole('radio', { name: /Hàng lẻ/ })).toBeChecked();
    const reference = screen.getByLabelText(/^Số Bill\/Booking/) as HTMLInputElement;
    expect(reference.value).toBe('BK-GUARD');
    // The Xuất-phased placeholder proves the restored EXPORT direction.
    expect(reference).toHaveAttribute('placeholder', 'Nhập số Booking (hàng Xuất)');
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBeNull();
  });

  it('beforeunload marks the draft restorable only while the form is dirty', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent(window, new Event('beforeunload'));
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    await typeImportBill('QA-S6-DRAFT-UX');
    fireEvent(window, new Event('beforeunload'));
    expect(window.sessionStorage.getItem(RESTORABLE_KEY)).toBe('1');
  });
});
