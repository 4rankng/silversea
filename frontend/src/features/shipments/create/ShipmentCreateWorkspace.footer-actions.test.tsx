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

const FOOTER_LABELS = ['Huỷ (cuối trang)', 'Lưu nháp (cuối trang)', 'Tạo lô hàng (cuối trang)'];

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
  expect(Array.from(footer.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(FOOTER_LABELS);
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

describe('FB-108 card 171026115830 — the action cluster repeated at the foot of the worksheet', { timeout: 20000 }, () => {
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
  ])('mounts the cluster at the end of the %s worksheet (both modes)', async (_mode, radio) => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    if (!screen.getByRole('radio', { name: radio }).getAttribute('aria-checked')) {
      fireEvent.click(screen.getByRole('radio', { name: radio }));
    }
    await waitFor(() => expectFooterCluster());

    // The topline cluster is untouched and keeps the plain accessible names —
    // the two clusters must never collide for a screen reader.
    const topline = document.querySelector('.csc-topline')!;
    expect(Array.from(topline.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')).filter(Boolean)).toEqual([]);
    expect(screen.getByRole('button', { name: 'Tạo lô hàng' }).closest('.csc-topline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo lô hàng (cuối trang)' }).closest('.csc-form-actions')).toBeTruthy();
  });

  it('saves the draft from the footer exactly like the topline (same payload)', async () => {
    // A create navigates away, so each intent gets its own mount — the payload
    // is the contract, not the second click on a page that has left.
    const fromFooter = await draftCallFor('Lưu nháp (cuối trang)');
    const fromTopline = await draftCallFor('Lưu nháp');

    // The idempotency key is minted per attempt, so it is the payload that must
    // match — every field of it does.
    expect(fromFooter[0]).toEqual(fromTopline[0]);
    expect(fromFooter[0]).toEqual(expect.objectContaining({ customerId: 1, cargoMode: 'FCL' }));
    expect(fromFooter[1]).toEqual(expect.any(String));
    expect(fromTopline[1]).toEqual(expect.any(String));
  });

  it('runs the same full-intake validation from the footer as from the topline', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng (cuối trang)' }));
    const alert = await screen.findByText(/^Cần bổ sung \d+ thông tin$/);
    // The footer create is the full-intake intent, not the partial one: it
    // reports the whole missing list and never falls through to a create call.
    expect(alert.textContent).toMatch(/^Cần bổ sung [2-9]\d* thông tin$/);
    expect(quickCreateShipment).not.toHaveBeenCalled();

    // A validation failure never enters `saving`, so the topline cluster keeps
    // its names and reports the very same list for the same lot.
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lô hàng', hidden: true }));
    await waitFor(() => expect(screen.getAllByText(/^Cần bổ sung \d+ thông tin$/)).toHaveLength(1));
    expect(screen.getByText(/^Cần bổ sung \d+ thông tin$/).textContent).toBe(alert.textContent);
    // The same lot, the same fields, the same copy — the two clusters reach the
    // same validation, not a footer-only subset.
    expect(document.querySelector('.csc-validation-summary')!.textContent).toContain('Chọn khách hàng.');
    expect(quickCreateShipment).not.toHaveBeenCalled();
  });

  it('discards and leaves from the footer Huỷ the way the topline Huỷ does', async () => {
    await enterFclWithCatalogCustomer();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ (cuối trang)' }));
    expect(await screen.findByText('Bỏ tạo lô hàng?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và quay lại' }));

    await waitFor(() => expect(screen.getByTestId('shipment-list')).toBeTruthy());
  });

  it('locks both clusters together while a save is in flight', async () => {
    await enterFclWithCatalogCustomer();

    let release: (() => void) | undefined;
    quickCreateShipment.mockReturnValueOnce(new Promise<{ id: number; version: number; initialDeclarationId: null }>((resolve) => {
      release = () => resolve({ id: 502, version: 1, initialDeclarationId: null });
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp (cuối trang)' }));
    // One shared `saving` state: the topline cluster reports the same progress
    // copy and is disabled with it, so neither copy looks actionable.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Đang lưu… (cuối trang)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ (cuối trang)' })).toBeDisabled();

    release!();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu nháp (cuối trang)' })).toBeEnabled());
  });
});