import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
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
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
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

    // 181026200700 (D.4) + SIL-587: the LCL schedule is ONE always-visible
    // datetime field — the marks contract reads it without any reveal step.
    // SIL-637 (id 741) removed it from the VISIBLE-mark set; SIL-639 (id
    // 743, owner 31/10) supersedes that and restores the visible inline
    // label, so the band field carries its asterisk again.
    const required = ['shipment-route', 'shipment-operational-site', 'shipment-pickup-warehouse', 'shipment-package-type', 'shipment-package-count', 'shipment-cargo-weight', 'shipment-lcl-closing-at'];
    for (const fieldId of required) {
      await waitFor(() => {
        expect(document.querySelector(`[data-field-id="${fieldId}"]`)).toBeTruthy();
      });
      expect(document.querySelector(`[data-field-id="${fieldId}"]`)!.textContent, fieldId).toContain('*');
    }
    // SIL-639: the restored inline label names the field and carries the
    // mark — the input/validation contract stays untouched.
    expect(document.querySelector('[data-field-id="shipment-lcl-closing-at"]')!.textContent).toContain('Ngày giờ đóng trả');
    // CBM is optional for LCL (helpdesk 2026-10-13) — the missing asterisk is
    // the contract.
    expect(document.querySelector('[data-field-id="shipment-cargo-volume"]')!.textContent).not.toContain('*');
  });

  it('labels the LCL schedule field "Ngày giờ đóng trả" (SIL-587) — visible inline label restored by SIL-639', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // SIL-587 (id 687, khách 29/10 — supersedes the 2026-10-13 "Ngày giao
    // hàng" copy): hàng lẻ's single schedule field is a DATETIME, pinned
    // here alongside the marks contract (the field renders only on the LCL
    // path). SIL-637 (id 741) retired the VISIBLE label; SIL-639 (id 743,
    // owner 31/10) restores it inline (label trái, control phải — same row
    // as "Loại hàng *"), while the [data-split-datetime] group's aria-label
    // and the segment inputs stay untouched.
    const field = await waitFor(() => {
      const node = document.querySelector('[data-field-id="shipment-lcl-closing-at"]');
      expect(node).toBeTruthy();
      return node!;
    });
    expect(field.querySelector('[data-split-datetime]')?.getAttribute('aria-label')).toBe('Ngày giờ đóng trả');
    const label = field.querySelector('.split-datetime__label');
    expect(label, 'SIL-639 restores the visible inline label').toBeTruthy();
    expect(label!.textContent).toContain('Ngày giờ đóng trả');
    expect(label!.textContent).toContain('*');
    expect(field.textContent).not.toContain('Ngày giao hàng');
    expect(field.querySelectorAll('input[data-seg="hh"]').length).toBe(1);
    expect(field.querySelectorAll('input[data-seg="yyyy"]').length).toBe(1);
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
