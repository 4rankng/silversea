import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
}));

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

/** QA1-007: the visible required mark (dấu *) on every field must equal the
 *  CREATE validation set in getShipmentCreateReadiness() — no asterisk on an
 *  unenforced field, no enforced field without one. Ad-hoc lots waive the
 *  catalog prerequisites (MasterDataNhaMay §4.1), so those asterisks are
 *  conditional on the Lệnh chạy ngoài toggle; the appointment mark is not. */
describe('shipment create required-asterisk contract (QA1-007)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('marks every enforced FCL field and no optional one (catalog lot)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    expect(document.querySelector('[data-field-id="shipment-customer"]')!.textContent).toContain('*');
    expect(document.querySelector('[data-field-id="shipment-trade-direction"]')!.textContent).toContain('*');
    expect(document.querySelector('[data-field-id="shipment-booking-ref"]')!.textContent).toContain('*');

    const cellLabel = (label: string) => document.querySelector<HTMLElement>(`[data-label="${label}"]`);
    expect(cellLabel('Loại container *')).toBeTruthy();
    expect(cellLabel('Nhà máy *')).toBeTruthy();
    expect(cellLabel('Tuyến đường *')).toBeTruthy();
    expect(cellLabel('Cảng nâng *')).toBeTruthy();
    expect(cellLabel('Cảng hạ *')).toBeTruthy();
    expect(cellLabel('Ngày giờ đóng trả *')).toBeTruthy();
    // Unenforced columns carry no mark.
    expect(cellLabel('Số container')).toBeTruthy();
    expect(cellLabel('Trọng lượng (kg)')).toBeTruthy();
  });

  it('marks every enforced LCL field and keeps optional CBM unmarked', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    const required = ['shipment-route', 'shipment-operational-site', 'shipment-pickup-warehouse', 'shipment-package-type', 'shipment-package-count', 'shipment-cargo-weight', 'shipment-expected-delivery'];
    for (const fieldId of required) {
      await waitFor(() => {
        expect(document.querySelector(`[data-field-id="${fieldId}"]`)).toBeTruthy();
      });
      expect(document.querySelector(`[data-field-id="${fieldId}"]`)!.textContent, fieldId).toContain('*');
    }
    // CBM is optional for LCL (helpdesk 2026-10-13) — the missing asterisk is
    // the contract.
    expect(document.querySelector('[data-field-id="shipment-cargo-volume"]')!.textContent).not.toContain('*');
  });

  it('labels the LCL delivery-date field "Ngày giao hàng" — never "Ngày giao dự kiến"', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // Helpdesk 2026-10-13 (ops Tiếp Vu): LCL copy for the delivery date is
    // "Ngày giao hàng". The field renders only on the LCL path, so the label
    // is pinned here alongside the marks contract.
    const field = await waitFor(() => {
      const node = document.querySelector('[data-field-id="shipment-expected-delivery"]');
      expect(node).toBeTruthy();
      return node!;
    });
    expect(field.textContent).toContain('Ngày giao hàng');
    expect(field.textContent).not.toContain('dự kiến');
  });

  it('drops the ad-hoc-waived marks when Lệnh chạy ngoài is on and keeps the rest', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));

    const cellLabel = (label: string) => document.querySelector<HTMLElement>(`[data-label="${label}"]`);
    // Catalog prerequisites waived for ad-hoc: factory/route/ports lose the mark…
    expect(cellLabel('Nhà máy')).toBeTruthy();
    expect(cellLabel('Tuyến đường')).toBeTruthy();
    expect(cellLabel('Cảng nâng')).toBeTruthy();
    expect(cellLabel('Cảng hạ')).toBeTruthy();
    expect(cellLabel('Nhà máy *')).toBeNull();
    expect(cellLabel('Tuyến đường *')).toBeNull();
    // …while data-safety marks stay.
    expect(cellLabel('Loại container *')).toBeTruthy();
    expect(cellLabel('Ngày giờ đóng trả *')).toBeTruthy();
  });

  it('LCL ad-hoc waives the catalog marks (route and warehouse)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lệnh chạy ngoài' }));
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    await waitFor(() => {
      expect(document.querySelector('[data-field-id="shipment-route"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-field-id="shipment-route"]')!.textContent).not.toContain('*');
    // The warehouse AND the factory are catalog prerequisites too (both belong
    // to a customer / a customer's site list), so an ad-hoc lot carries no
    // mark — matching the waived shipment-pickup-warehouse /
    // shipment-operational-site issues in getShipmentCreateReadiness.
    expect(document.querySelector('[data-field-id="shipment-pickup-warehouse"]')!.textContent).not.toContain('*');
    expect(document.querySelector('[data-field-id="shipment-operational-site"]')!.textContent).not.toContain('*');
  });
});
