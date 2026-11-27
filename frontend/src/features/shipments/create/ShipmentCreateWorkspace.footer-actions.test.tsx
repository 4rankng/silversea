import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// HOT-01 (CR-011.2): visible button labels on the fixed footer omit
// "(cuối trang)" ("Huỷ", "Lưu nháp", "Tạo lô hàng"), while accessible
// aria-labels still distinguish the head and footer twin bars.
const FOOTER_LABELS = ['Huỷ', 'Lưu nháp', 'Tạo lô hàng'];
const HEAD_LABELS = ['Huỷ', 'Lưu nháp', 'Tạo lô hàng'];

/** Two history entries so the Huỷ → discard path has a place to land. */
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

/** The worksheet's own last element must be the repeated cluster — that is the
 *  whole ask: a clerk at the last field does not scroll back up. */
function expectFooterCluster() {
  const footer = document.querySelector<HTMLElement>('.csc-form-actions')!;
  expect(footer).toBeTruthy();
  const form = document.querySelector('form.csc-workspace')!;
  expect(form.lastElementChild).toBe(footer);
  expect(Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(FOOTER_LABELS);
}

async function enterFclWithCatalogCustomer() {
  renderWorkspace();
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeChecked());
}

/** The recorded quickCreate call produced by clicking `buttonName` in a fresh
 *  FCL worksheet — the two clusters are compared through this. */
async function draftCallFor(buttonName: string) {
  await enterFclWithCatalogCustomer();
  quickCreateShipment.mockClear();
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
  const call = quickCreateShipment.mock.calls[0];
  cleanup();
  return call;
}

describe('SIL-510 — the ONE action bar: viewport-fixed footer of the worksheet (ex-FB-108 twin)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    quickCreateShipment.mockResolvedValue({ id: 501, version: 1, initialDeclarationId: null });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it.each([
    ['hàng cont', /Hàng FCL/],
    ['hàng lẻ', /Hàng lẻ/],
  ])('mounts the head + footer twin bars on the %s worksheet (both modes)', async (_mode, radio) => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    if (!screen.getByRole('radio', { name: radio }).getAttribute('aria-checked')) {
      fireEvent.click(screen.getByRole('radio', { name: radio }));
    }
    await waitFor(() => expectFooterCluster());

    // SIL-917 (KB §3.2.7): the HEAD cluster rides the topline with the plain
    // names; the footer twin carries the "(cuối trang)" labels.
    const topline = document.querySelector('.csc-topline')!;
    expect(Array.from(topline.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(HEAD_LABELS);
    expect(screen.getByRole('button', { name: 'Tạo lô hàng' }).closest('.csc-topline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo lô hàng (cuối trang)' }).closest('.csc-form-actions')).toBeTruthy();
  });

  it('saves the draft from the fixed footer bar (partial-create payload)', async () => {
    // A create navigates away, so the intent gets its own mount — the payload
    // is the contract.
    const call = await draftCallFor('Lưu nháp');
    expect(call[0]).toEqual(expect.objectContaining({ customerId: 1, cargoMode: 'FCL' }));
    expect(call[1]).toEqual(expect.any(String));
  });

  it('runs the full-intake validation from the fixed footer bar (per-field paint, SIL-627)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng' }));
    // The bar's create is the full-intake intent, not the partial one: the
    // missing list paints per-field (SIL-627 retired the summary banner) and
    // the click never falls through to a create call.
    await waitFor(() => {
      const paint = document.querySelectorAll(
        '.csc-container-cell--error, [data-uui-control][aria-invalid="true"], input[aria-invalid="true"], .csc-searchable-field--error',
      );
      expect(paint.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
    expect(document.querySelector('.csc-validation-summary')).toBeNull();
    expect(quickCreateShipment).not.toHaveBeenCalled();
    // The customer field carries the same message the old panel listed.
    expect(document.querySelector('[data-field="shipment-customer"]')?.textContent).toContain('Chọn khách hàng.');
  });

  it('renders a failed save as the inline submit-error alert (SIL-627: the banner is gone, the server surface stays)', async () => {
    // The deleted ShipmentCreateSummary owned the only render-level assertion
    // for this surface; the inline `.csc-submit-error` div inherits the job.
    await enterFclWithCatalogCustomer();
    quickCreateShipment.mockClear();
    quickCreateShipment.mockRejectedValueOnce(new Error('Lỗi máy chủ thử lại'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('csc-submit-error');
    expect(alert.textContent).toContain('Lỗi máy chủ thử lại');
    expect(document.querySelector('.csc-validation-summary')).toBeNull();
  });

  it('discards and leaves from the bar Huỷ', async () => {
    await enterFclWithCatalogCustomer();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(await screen.findByText('Bỏ tạo lô hàng?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và quay lại' }));

    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('locks the bar while a save is in flight', async () => {
    await enterFclWithCatalogCustomer();

    let release: (() => void) | undefined;
    quickCreateShipment.mockReturnValueOnce(new Promise<{ id: number; version: number; initialDeclarationId: null }>((resolve) => {
      release = () => resolve({ id: 502, version: 1, initialDeclarationId: null });
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    // One shared `saving` state: BOTH bars report the progress copy and every
    // button on them is disabled with it, so nothing looks actionable.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Đang lưu…' })).toHaveLength(2));
    screen.getAllByRole('button', { name: 'Đang lưu…' }).forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ (cuối trang)' })).toBeDisabled();

    release!();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeEnabled());
  });
});