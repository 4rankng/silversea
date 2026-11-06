// SIL-691 (FB-007, id 803 — QA 06/11): the HÀNG LẺ "Nhà máy" picker must
// show the factory's contact phone in the suggestion option (secondary line)
// and stay searchable by phone, matching the FCL container-row picker's
// FB-007-round-16 law. The detail dialog (OperationalSiteDetailsDialog)
// already renders "Số điện thoại" from the same operational_sites.contact_phone
// (DRI-01) — this test pins the picker half; the dialog half is covered by
// OperationalSiteDetailsDialog's own rendering (row hidden only when the
// value is empty — no invented phone for phone-less masters).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getBootstrap,
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
} = vi.hoisted(() => ({
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

const ASKEY_SITE = {
  id: 5,
  siteType: 'FACTORY',
  code: 'ASKEY-1',
  shortName: 'ASKEY-Xưởng 1',
  name: 'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM',
  address: 'Khu công nghiệp Long Hậu',
  contactPhone: '0912345678',
};

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

async function enterLclMode() {
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  await waitFor(() => expect(listOperationalSites).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
  await waitFor(() => expect(document.querySelector('[data-field-id="shipment-operational-site"]')).toBeTruthy());
}

describe('SIL-691 — Nhà máy (Hàng lẻ) hiện SĐT ở gợi ý và tìm được theo SĐT', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 691, version: 1 });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A', shortName: 'KH A' }],
      routes: [],
      ports: [],
      containerTypes: [],
      cargoTypes: [],
      shippingLines: [],
    });
  });

  it('renders the contact phone as the option secondary line', async () => {
    listOperationalSites.mockResolvedValue([ASKEY_SITE]);
    renderWorkspace();
    await enterLclMode();

    const siteInput = document.querySelector<HTMLInputElement>(
      '[data-field-id="shipment-operational-site"] input',
    )!;
    siteInput.focus();
    fireEvent.change(siteInput, { target: { value: 'ASKEY' } });

    const option = await screen.findByRole('option', { name: /ASKEY-Xưởng 1/ });
    expect(option.textContent).toContain('0912345678');
  });

  it('finds the factory by typing its phone number', async () => {
    listOperationalSites.mockResolvedValue([ASKEY_SITE]);
    renderWorkspace();
    await enterLclMode();

    const siteInput = document.querySelector<HTMLInputElement>(
      '[data-field-id="shipment-operational-site"] input',
    )!;
    siteInput.focus();
    fireEvent.change(siteInput, { target: { value: '0912345678' } });

    expect(await screen.findByRole('option', { name: /ASKEY-Xưởng 1/ })).toBeTruthy();
  });

  it('renders no secondary line and never "undefined" for a phone-less factory', async () => {
    listOperationalSites.mockResolvedValue([{ ...ASKEY_SITE, contactPhone: null }]);
    renderWorkspace();
    await enterLclMode();

    const siteInput = document.querySelector<HTMLInputElement>(
      '[data-field-id="shipment-operational-site"] input',
    )!;
    siteInput.focus();
    fireEvent.change(siteInput, { target: { value: 'ASKEY' } });

    const option = await screen.findByRole('option', { name: /ASKEY-Xưởng 1/ });
    expect(option.textContent?.replace(/\s+/g, ' ').trim()).not.toMatch(/undefined/);
    expect(option.textContent).not.toContain('0912345678');
  });
});

afterEach(cleanup);
