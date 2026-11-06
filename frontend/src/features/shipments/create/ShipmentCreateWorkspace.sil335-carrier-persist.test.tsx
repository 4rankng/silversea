import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, createShippingLine, quickCreateShipment, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  createShippingLine: vi.fn(),
  quickCreateShipment: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  createShippingLine,
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * SIL-335 (owner ruling 06/11 "ten hang tau go tay must be saved to db") —
 * the FREE-TYPED combobox path (no ✎ dialog; the QA repro: admin typed
 * "R4B-CARRIER-1" straight into Hãng tàu on Tạo lô hàng) must persist the
 * name into the shared SHIPPING_LINE catalog on save, so the suggestion list
 * offers it again next time. Create and edit share the ONE save seam
 * (SIL-171: edit IS this workspace in edit mode), so the create-path pins
 * cover both. The pencil path's own persist stays pinned in
 * shipping-line-persist.test.tsx.
 */
describe('typed carrier name persists to the shared catalog on save (SIL-335)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    createShippingLine.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listOperationalSites.mockResolvedValue([]);
    listSharedWarehouseSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 501, version: 1, initialDeclarationId: null });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      ports: [],
      shippingLines: [{ name: 'MSC' }, { name: 'Maersk' }],
    });
  });

  async function typeCarrierAndSave(name: string) {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // DRAFT needs the customer pick before the save passes validation (same
    // fill law the footer-actions suite uses).
    fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeChecked());
    // SIL-335 wiring: the carrier field live-commits typed text through
    // onCustomValue — one fireEvent.change is the whole interaction.
    fireEvent.change(screen.getByRole('combobox', { name: /^Hãng tàu/ }), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(quickCreateShipment).toHaveBeenCalled());
  }

  it('a new name typed into the combobox reaches the catalog on save (create path)', async () => {
    createShippingLine.mockResolvedValue({ id: 55, name: 'R4B-CARRIER-1', created: true });
    await typeCarrierAndSave('R4B-CARRIER-1');
    expect(createShippingLine).toHaveBeenCalledWith('R4B-CARRIER-1');
  });

  it('a name the catalog already lists skips the redundant persist', async () => {
    await typeCarrierAndSave('MSC');
    expect(createShippingLine).not.toHaveBeenCalled();
  });

  it('a failed catalog persist warns but never blocks the lot save', async () => {
    createShippingLine.mockRejectedValue(new Error('catalog down'));
    await typeCarrierAndSave('R4B-CARRIER-2');
    expect(quickCreateShipment).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Không lưu được hãng tàu "R4B-CARRIER-2" vào danh mục chung — lô hàng vẫn được lưu.')).toBeTruthy();
  });
});
